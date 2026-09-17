/**
 * "Analizza documento" — temporary analysis of one or more files uploaded by
 * the operator. The text is extracted in the browser and sent to the AI with
 * the question. Files are NEVER stored: no storage upload, no database row.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { extractFile, pagesToTranscript } from "@/lib/pdf-extract";
import ReactMarkdown from "react-markdown";
import {
  ArrowLeft,
  UploadCloud,
  Loader2,
  Send,
  FileSearch,
  FileText,
  X,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

type QA = { question: string; answer: string };
type LoadedDoc = { name: string; transcript: string; pageCount: number | null };

export const Route = createFileRoute("/_authenticated/analizza")({
  head: () => ({
    meta: [
      { title: "Analizza documenti — CAF AI" },
      {
        name: "description",
        content:
          "Carica uno o più documenti e chiedi all'AI cosa contengono: risposta con pagina e riga.",
      },
      { property: "og:title", content: "Analizza documenti — CAF AI" },
      {
        property: "og:description",
        content: "Analisi temporanea di documenti con risposte citate.",
      },
    ],
  }),
  component: AnalizzaPage,
});

/** Join every loaded document into a single numbered transcript. */
function buildTranscript(docs: LoadedDoc[]): string {
  return docs
    .map((d) => `########## DOCUMENTO: ${d.name} ##########\n${d.transcript}`)
    .join("\n\n");
}

function AnalizzaPage() {
  const [docs, setDocs] = useState<LoadedDoc[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [history, setHistory] = useState<QA[]>([]);
  const [busy, setBusy] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setExtracting(true);
    const added: LoadedDoc[] = [];
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
          toast.error(`${file.name}: nessun testo estratto`);
          continue;
        }
        added.push({
          name: file.name,
          transcript: pagesToTranscript(res.pages),
          pageCount: res.pageCount,
        });
      }
      if (added.length > 0) {
        setDocs((d) => [...d, ...added]);
        setAnswer("");
        setHistory([]);
        toast.success(
          added.length === 1
            ? "Documento pronto per l'analisi"
            : `${added.length} documenti pronti per l'analisi`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore lettura file");
    } finally {
      setExtracting(false);
      setProgress("");
    }
  }

  function removeDoc(name: string) {
    setDocs((d) => d.filter((x) => x.name !== name));
    setAnswer("");
    setHistory([]);
  }

  async function ask() {
    const q = question.trim();
    if (!q || docs.length === 0) return;
    setBusy(true);
    setAnswer("");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sessione scaduta");

      const res = await fetch("/api/analizza", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          question: q,
          transcript: buildTranscript(docs),
          filename: docs.map((d) => d.name).join(", "),
          history: history.flatMap((h) => [
            { role: "user" as const, content: h.question },
            { role: "assistant" as const, content: h.answer },
          ]),
        }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text());

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setAnswer(text);
      }
      setHistory((h) => [...h, { question: q, answer: text }]);
      setQuestion("");
      setAnswer("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore nell'analisi");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-6 py-6">
        <Link
          to="/chat"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> Torna alla chat
        </Link>

        <h1 className="text-2xl font-semibold mb-1">Analizza documenti</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Carica uno o più documenti (contratti, certificazioni…) e fai una domanda sul
          loro contenuto, es. «in questo contratto c'è la cedolare secca?». I file non
          vengono salvati in archivio.
        </p>

        <div className="rounded-xl border border-border p-4 space-y-3 mb-6">
          <div className="flex items-center gap-2 text-sm font-medium">
            <UploadCloud className="h-4 w-4 text-primary" />
            Documenti da analizzare (PDF, MD o TXT — anche più di uno)
          </div>
          <input
            type="file"
            multiple
            accept=".pdf,.md,.txt,application/pdf,text/markdown,text/plain"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:cursor-pointer"
          />
          {extracting && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {progress || "Lettura…"}
            </div>
          )}
          {docs.length > 0 && (
            <div className="space-y-1.5">
              {docs.map((d) => (
                <div
                  key={d.name}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-xs"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="truncate">{d.name}</span>
                    {d.pageCount ? (
                      <span className="text-muted-foreground shrink-0">
                        · {d.pageCount} pagine
                      </span>
                    ) : null}
                  </span>
                  <button
                    onClick={() => removeDoc(d.name)}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                    aria-label={`Rimuovi ${d.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2 text-xs text-success pt-1">
                <ShieldCheck className="h-3.5 w-3.5" />
                Nessun file viene salvato: l'analisi è temporanea.
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 mb-6">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) ask();
            }}
            disabled={docs.length === 0}
            placeholder="Es. in questo contratto è prevista la cedolare secca?"
            className="flex-1 bg-surface border border-border rounded-lg px-3 py-2.5 text-sm disabled:opacity-50"
          />
          <button
            onClick={ask}
            disabled={busy || docs.length === 0 || !question.trim()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Chiedi
          </button>
        </div>

        {(history.length > 0 || answer) && (
          <div className="space-y-4">
            {history.map((h, i) => (
              <QaCard key={i} question={h.question} answer={h.answer} />
            ))}
            {answer && <QaCard question={question} answer={answer} />}
          </div>
        )}

        {docs.length === 0 && !extracting && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            <FileSearch className="h-6 w-6 mx-auto mb-2 opacity-60" />
            Carica uno o più documenti per iniziare l'analisi.
          </div>
        )}
      </div>
    </div>
  );
}

function QaCard({ question, answer }: QA) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="text-sm font-medium mb-2">{question}</div>
      <div className="prose prose-invert prose-sm max-w-none">
        <ReactMarkdown>{answer}</ReactMarkdown>
      </div>
    </div>
  );
}
