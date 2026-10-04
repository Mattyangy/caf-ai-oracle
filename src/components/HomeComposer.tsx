/**
 * Shared "home style" composer: greeting header, textarea, attach-documents
 * button, AI engine selector (ChatGPT / Gemini) and suggestion chips.
 * Used by the chat home, "Analizza documenti" and "Ricerca circolari".
 * Attached files are read in the browser and NEVER uploaded to storage.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Paperclip, Send, Loader2, FileText, X } from "lucide-react";
import { toast } from "sonner";
import { extractFile, pagesToTranscript } from "@/lib/pdf-extract";
import { DEFAULT_ENGINE, isAiEngineId, type AiEngineId } from "@/lib/ai/models";

export type AttachedDoc = { name: string; transcript: string; pageCount: number | null };

/** sessionStorage key holding documents attached to a chat thread (never stored server-side). */
export const attachKey = (threadId: string) => `caf-attach-${threadId}`;

const ENGINE_KEY = "caf-ai-engine";

/** Persisted engine choice shared across pages. */
export function useAiEngine(): [AiEngineId, (e: AiEngineId) => void] {
  const [engine, setEngine] = useState<AiEngineId>(DEFAULT_ENGINE);
  useEffect(() => {
    const v = localStorage.getItem(ENGINE_KEY);
    if (isAiEngineId(v)) setEngine(v);
  }, []);
  return [
    engine,
    (e) => {
      localStorage.setItem(ENGINE_KEY, e);
      setEngine(e);
    },
  ];
}

/** Join attached docs into one numbered transcript for the AI. */
export function docsToTranscript(docs: AttachedDoc[]): string {
  return docs
    .map((d) => `########## DOCUMENTO: ${d.name} ##########\n${d.transcript}`)
    .join("\n\n");
}

type Props = {
  header?: ReactNode;
  placeholder: string;
  suggestions?: string[];
  busy: boolean;
  /** When true the send button stays disabled until at least one doc is attached. */
  requireDocs?: boolean;
  /** Keep attached docs after sending (analysis follow-ups). */
  keepDocs?: boolean;
  docs: AttachedDoc[];
  onDocsChange: (docs: AttachedDoc[]) => void;
  engine?: AiEngineId;
  onEngineChange?: (e: AiEngineId) => void;
  onSubmit: (text: string) => void;
  autoFocus?: boolean;
};

export function HomeComposer({
  header,
  placeholder,
  suggestions,
  busy,
  requireDocs,
  keepDocs,
  docs,
  onDocsChange,
  engine,
  onEngineChange,
  onSubmit,
  autoFocus,
}: Props) {
  const [input, setInput] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) taRef.current?.focus();
  }, [autoFocus]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setExtracting(true);
    const added: AttachedDoc[] = [];
    try {
      for (const file of Array.from(files)) {
        if (!/\.(pdf|md|txt)$/i.test(file.name)) {
          toast.error(`${file.name}: formati supportati PDF, MD, TXT`);
          continue;
        }
        setProgress(`Lettura di ${file.name}…`);
        const res = await extractFile(file, (p, total) =>
          setProgress(`${file.name}: pagina ${p} di ${total}…`),
        );
        if (res.chunks.length === 0) {
          toast.error(`${file.name}: nessun testo estratto (PDF scansionato?)`);
          continue;
        }
        added.push({
          name: file.name,
          transcript: pagesToTranscript(res.pages),
          pageCount: res.pageCount,
        });
      }
      if (added.length) onDocsChange([...docs, ...added]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore lettura file");
    } finally {
      setExtracting(false);
      setProgress("");
    }
  }

  const canSend = !busy && !extracting && !!input.trim() && (!requireDocs || docs.length > 0);

  function send(text?: string) {
    const t = (text ?? input).trim();
    if (!t || busy || extracting) return;
    if (requireDocs && docs.length === 0) {
      toast.error("Allega prima almeno un documento");
      return;
    }
    onSubmit(t);
    setInput("");
    if (!keepDocs) onDocsChange([]);
  }

  return (
    <div className="w-full">
      {header}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="bg-surface border border-border rounded-2xl focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30 transition"
      >
        {docs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {docs.map((d) => (
              <span
                key={d.name}
                className="inline-flex items-center gap-1.5 max-w-[240px] text-xs px-2 py-1 rounded-lg bg-primary/10 border border-primary/30 text-foreground"
              >
                <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="truncate">{d.name}</span>
                {d.pageCount ? (
                  <span className="text-muted-foreground shrink-0">{d.pageCount}p</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => onDocsChange(docs.filter((x) => x.name !== d.name))}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Rimuovi ${d.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={3}
          maxLength={4000}
          placeholder={placeholder}
          className="w-full bg-transparent px-4 py-3 text-foreground placeholder:text-muted-foreground resize-none focus:outline-none"
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              accept=".pdf,.md,.txt,application/pdf,text/markdown,text/plain"
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={extracting}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-background/60 transition disabled:opacity-50"
              aria-label="Allega documenti"
            >
              {extracting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
              <span className="hidden sm:inline truncate max-w-[220px]">
                {extracting ? progress || "Lettura…" : "Allega"}
              </span>
            </button>
            <span className="text-[11px] text-muted-foreground">ChatGPT + Gemini</span>
          </div>
          <button
            type="submit"
            disabled={!canSend}
            className="p-2.5 rounded-xl bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition"
            aria-label="Invia"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </form>

      {suggestions && suggestions.length > 0 && (
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              disabled={busy || (requireDocs && docs.length === 0)}
              className="text-left text-sm p-3 rounded-xl bg-surface/60 border border-border hover:border-primary/50 hover:bg-surface transition text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Greeting block styled like the chat home. */
export function WelcomeHeader({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="text-center mb-8">
      <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/30">
        {icon}
      </div>
      <h1 className="text-3xl font-semibold text-foreground mb-3">{title}</h1>
      <p className="text-muted-foreground leading-relaxed max-w-lg mx-auto">{children}</p>
    </div>
  );
}
