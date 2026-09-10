import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDocumentUrl } from "@/lib/documents.functions";
import ReactMarkdown from "react-markdown";
import {
  Send,
  Loader2,
  FileText,
  ExternalLink,
  Sparkles,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

type Source = {
  document_id: string;
  title: string;
  filename: string;
  doc_type: string;
  categoria?: string;
  page_number: number | null;
};

type Reliability = { label: string; score: number };

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  reliability?: Reliability | null;
  streaming?: boolean;
};

export const Route = createFileRoute("/_authenticated/chat/$threadId")({
  validateSearch: (s: Record<string, unknown>) => ({
    auto: typeof s.auto === "string" ? s.auto : undefined,
  }),
  component: ThreadPage,
});

function ThreadPage() {
  const { threadId } = Route.useParams();
  const search = useSearch({ from: "/_authenticated/chat/$threadId" });
  const qc = useQueryClient();
  const openDoc = useServerFn(getDocumentUrl);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoRan = useRef(false);

  const { data: initial, isLoading } = useQuery({
    queryKey: ["thread-messages", threadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("id,role,content,sources,reliability,reliability_score,created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        sources: (m.sources as unknown as Source[] | null) ?? [],
        reliability: m.reliability
          ? { label: m.reliability, score: m.reliability_score ?? 0 }
          : null,
      }));
    },
  });

  useEffect(() => {
    if (initial) setMessages(initial);
  }, [initial]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(
    async (userText: string, existingId?: string) => {
      setBusy(true);
      // If we already have this user message in DB (e.g. home-page seed), skip insert
      let userMsg: Message;
      if (existingId) {
        userMsg = { id: existingId, role: "user", content: userText };
      } else {
        const { data, error } = await supabase
          .from("chat_messages")
          .insert({ thread_id: threadId, role: "user", content: userText })
          .select("id")
          .single();
        if (error) {
          toast.error(error.message);
          setBusy(false);
          return;
        }
        userMsg = { id: data.id, role: "user", content: userText };
        setMessages((m) => [...m, userMsg]);
      }

      const placeholderId = "streaming-" + Date.now();
      setMessages((m) => [
        ...m,
        { id: placeholderId, role: "assistant", content: "", streaming: true },
      ]);

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error("Sessione scaduta");

        // Build the full message history to send to the model
        const history = [...messages, userMsg].map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ threadId, messages: history }),
        });
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `Errore ${res.status}`);
        }

        const sources: Source[] = res.headers.get("X-Caf-Sources")
          ? (JSON.parse(decodeURIComponent(res.headers.get("X-Caf-Sources")!)) as Source[])
          : [];
        const reliability: Reliability | null = res.headers.get("X-Caf-Reliability")
          ? (JSON.parse(
              decodeURIComponent(res.headers.get("X-Caf-Reliability")!),
            ) as Reliability)
          : null;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setMessages((m) =>
            m.map((msg) =>
              msg.id === placeholderId ? { ...msg, content: acc } : msg,
            ),
          );
        }

        setMessages((m) =>
          m.map((msg) =>
            msg.id === placeholderId
              ? { ...msg, streaming: false, sources, reliability }
              : msg,
          ),
        );
        qc.invalidateQueries({ queryKey: ["threads"] });
        qc.invalidateQueries({ queryKey: ["thread-messages", threadId] });
      } catch (err) {
        setMessages((m) => m.filter((x) => x.id !== placeholderId));
        toast.error(err instanceof Error ? err.message : "Errore di rete");
      } finally {
        setBusy(false);
      }
    },
    [messages, threadId, qc],
  );

  // Auto-run: home page created a thread with a seed user message. Reply once.
  useEffect(() => {
    if (autoRan.current) return;
    if (!initial || search.auto !== "1") return;
    const last = initial[initial.length - 1];
    if (last?.role === "user" && initial.filter((m) => m.role === "assistant").length === 0) {
      autoRan.current = true;
      // Small delay to let messages state settle
      setTimeout(() => sendMessage(last.content, last.id), 0);
    }
  }, [initial, search.auto, sendMessage]);

  async function handleOpenDoc(document_id: string, page: number | null) {
    try {
      const { url } = await openDoc({ data: { document_id, page } });
      window.open(url, "_blank", "noopener");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore apertura documento");
    }
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto w-full px-4 py-6 space-y-6">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground py-16">
              Nessun messaggio ancora.
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} onOpenDoc={handleOpenDoc} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const t = input.trim();
          if (!t || busy) return;
          setInput("");
          sendMessage(t);
        }}
        className="border-t border-border bg-background/80 backdrop-blur"
      >
        <div className="max-w-3xl mx-auto w-full px-4 py-3">
          <div className="relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  (e.currentTarget.form as HTMLFormElement).requestSubmit();
                }
              }}
              rows={2}
              maxLength={4000}
              placeholder="Fai una domanda…"
              className="w-full bg-surface border border-border rounded-2xl px-4 py-3 pr-14 text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="absolute right-2 bottom-2 p-2.5 rounded-xl bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition"
              aria-label="Invia"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground text-center mt-2">
            CAF AI può commettere errori. Verifica le informazioni presso le fonti ufficiali.
          </p>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({
  msg,
  onOpenDoc,
}: {
  msg: Message;
  onOpenDoc: (id: string, page: number | null) => void;
}) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-primary text-primary-foreground rounded-2xl rounded-tr-md px-4 py-2.5">
          <div className="whitespace-pre-wrap text-[15px]">{msg.content}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-8 h-8 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
        <Sparkles className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="prose prose-sm prose-invert max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-li:my-0.5">
          {msg.content ? (
            <ReactMarkdown>{msg.content}</ReactMarkdown>
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Sto consultando l'archivio…
            </div>
          )}
        </div>

        {!msg.streaming && msg.reliability && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ReliabilityBadge r={msg.reliability} />
            {(!msg.sources || msg.sources.length === 0) && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-warning/15 text-warning border border-warning/30">
                <ShieldAlert className="h-3 w-3" />
                Nessuna fonte interna — verificare con fonti ufficiali
              </span>
            )}
          </div>
        )}

        {!msg.streaming && msg.sources && msg.sources.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Fonti utilizzate
            </div>
            <ul className="space-y-1.5">
              {msg.sources.map((s, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface border border-border text-sm"
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <div className="truncate font-medium flex items-center gap-2">
                        {s.categoria === "circolari" && (
                          <span className="shrink-0 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-success/15 text-success border border-success/30">
                            Circolare
                          </span>
                        )}
                        <span className="truncate">{s.title}</span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {s.filename}
                        {s.page_number ? ` — pagina ${s.page_number}` : ""}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => onOpenDoc(s.document_id, s.page_number)}
                    className="shrink-0 inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Apri
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function ReliabilityBadge({ r }: { r: Reliability }) {
  const color =
    r.score >= 80
      ? "bg-success/15 text-success border-success/30"
      : r.score >= 55
        ? "bg-primary/15 text-primary border-primary/30"
        : "bg-warning/15 text-warning border-warning/30";
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${color}`}>
      Affidabilità: {r.label} ({r.score}%)
    </span>
  );
}
