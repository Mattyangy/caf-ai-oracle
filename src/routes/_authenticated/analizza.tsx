/**
 * "Analizza documento" — temporary analysis of a file uploaded by the operator.
 * The text is extracted in the browser and sent to the AI with the question.
 * The file is NEVER stored: no storage upload, no database row.
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
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

type QA = { question: string; answer: string };

export const Route = createFileRoute("/_authenticated/analizza")({
  head: () => ({
    meta: [
      { title: "Analizza documento — CAF AI" },
      {
        name: "description",
        content:
          "Carica un contratto o un documento e chiedi all'AI cosa contiene: risposta con pagina e riga.",
      },
      { property: "og:title", content: "Analizza documento — CAF AI" },
      {
        property: "og:description",
        content: "Analisi temporanea di un documento con risposte citate.",
      },
    ],
  }),
  component: AnalizzaPage,
});

function AnalizzaPage() {
  const [file, setFile] = useState<File | null>(null);
  const [transcript, setTranscript] = useState("");
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [history, setHistory] = useState<QA[]>([]);
  const [busy, setBusy] = useState(false);

  async function handleFile(f: File | null) {
    setFile(f);
    setTranscript("");
    setAnswer("");
    setHistory([]);
    if (!f) return;
    const ok = /\.(pdf|md|txt)$/i.test(f.name);
    if (!ok) return toast.error("Formati supportati: PDF, MD, TXT");

    setExtracting(true);
    try {
      const res = await extractFile(f, (p, total) =>
        setProgress(`Lettura pagina ${p} di ${total}…`),
      );
      if (res.chunks.length === 0) throw new Error("Nessun testo estratto dal file");
      setTranscript(pagesToTranscript(res.pages));
      setPageCount(res.pageCount);
      toast.success("Documento pronto per l'analisi");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore lettura file");
      setFile(null);
    } finally {
      setExtracting(false);
      setProgress("");
    }
  }

  async function ask() {
    const q = question.trim();
    if (!q || !transcript) return;
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
          transcript,
          filename: file?.name,
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

        <h1 className="text-2xl font-semibold mb-1">Analizza documento</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Carica un contratto o un altro documento e fai una domanda sul suo contenuto
          (es. «in questo contratto c'è la cedolare secca?»). Il file non viene salvato.
        </p>

        <div className="rounded-xl border border-border p-4 space-y-3 mb-6">
          <div className="flex items-center gap-2 text-sm font-medium">
            <UploadCloud className="h-4 w-4 text-primary" />
            Documento da analizzare (PDF, MD o TXT)
          </div>
          <input
            type="file"
            accept=".pdf,.md,.txt,application/pdf,text/markdown,text/plain"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:cursor-pointer"
          />
          {extracting && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {progress || "Lettura…"}
            </div>
          )}
          {transcript && !extracting && (
            <div className="flex items-center gap-2 text-xs text-success">
              <ShieldCheck className="h-3.5 w-3.5" />
              {file?.name} pronto{pageCount ? ` · ${pageCount} pagine` : ""} · non salvato
              in archivio
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
            disabled={!transcript}
            placeholder="Es. in questo contratto è prevista la cedolare secca?"
            className="flex-1 bg-surface border border-border rounded-lg px-3 py-2.5 text-sm disabled:opacity-50"
          />
          <button
            onClick={ask}
            disabled={busy || !transcript || !question.trim()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Chiedi
          </button>
        </div>

        {(answer || history.length > 0) && (
          <div className="space-y-4">
            {history.map((h, i) => (
              <QaCard key={i} question={h.question} answer={h.answer} />
            ))}
            {busy && answer && <QaCard question={question} answer={answer} />}
          </div>
        )}

        {!transcript && !extracting && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            <FileSearch className="h-6 w-6 mx-auto mb-2 opacity-60" />
            Carica un documento per iniziare l'analisi.
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
