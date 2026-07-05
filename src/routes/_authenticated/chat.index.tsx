import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "@tanstack/react-router";
import { Sparkles, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/chat/")({
  component: ChatHome,
});

const SUGGESTIONS = [
  "Come si calcola l'ISEE 2026 per un nucleo con un figlio disabile?",
  "Quali documenti servono per la domanda di invalidità civile?",
  "Come funziona il Bonus Asilo Nido quest'anno?",
  "Requisiti per il Reddito di Cittadinanza / ADI 2026?",
];

function ChatHome() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(text?: string) {
    const question = (text ?? input).trim();
    if (!question || !user || busy) return;
    setBusy(true);
    try {
      // Create thread with derived title
      const title = question.slice(0, 60) + (question.length > 60 ? "…" : "");
      const { data: thread, error } = await supabase
        .from("chat_threads")
        .insert({ user_id: user.id, title })
        .select("id")
        .single();
      if (error) throw error;

      // Store the user message immediately; the thread page will fetch it.
      await supabase.from("chat_messages").insert({
        thread_id: thread.id,
        role: "user",
        content: question,
      });

      navigate({
        to: "/chat/$threadId",
        params: { threadId: thread.id },
        search: { auto: "1" } as never,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    } finally {
      setBusy(false);
    }
  }

  const firstName = profile?.full_name?.split(" ")[0] || "";

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-10 overflow-y-auto">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-10">
          <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/30">
            <Sparkles className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-3xl font-semibold text-foreground mb-3">
            Ciao {firstName} <span className="inline-block animate-wave">👋</span>
          </h1>
          <p className="text-muted-foreground leading-relaxed max-w-lg mx-auto">
            Sono <span className="text-primary font-medium">CAF AI</span>, il tuo assistente operativo.
            <br />
            Scrivi la tua domanda: cercherò automaticamente tra circolari, normativa, FAQ, casi risolti e documentazione interna per fornirti la risposta più accurata possibile.
            Se utilizzo documenti del tuo archivio, ti indicherò sempre la fonte.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="relative"
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={3}
            maxLength={4000}
            placeholder="Scrivi la tua domanda…"
            className="w-full bg-surface border border-border rounded-2xl px-4 py-3 pr-14 text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="absolute right-2 bottom-2 p-2.5 rounded-xl bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition"
            aria-label="Invia"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>

        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => submit(s)}
              disabled={busy}
              className="text-left text-sm p-3 rounded-xl bg-surface/60 border border-border hover:border-primary/50 hover:bg-surface transition text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes wave { 0%,60%,100% { transform: rotate(0); } 10%,30% { transform: rotate(14deg); } 20% { transform: rotate(-8deg); } 40%,50% { transform: rotate(14deg); } }
        .animate-wave { animation: wave 2.4s ease-in-out infinite; transform-origin: 70% 70%; display: inline-block; }
      `}</style>
    </div>
  );
}
