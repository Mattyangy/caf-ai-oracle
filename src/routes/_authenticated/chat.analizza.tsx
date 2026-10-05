/**
 * "Analizza documenti" — home-style screen: attach one or more files with the
 * paperclip, ask a question, get a Sì/No/Non chiaro verdict with page/line
 * citations. Files are read in the browser and NEVER stored.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { FileSearch, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  HomeComposer,
  WelcomeHeader,
  docsToTranscript,
  useAiEngine,
  type AttachedDoc,
} from "@/components/HomeComposer";

type QA = { question: string; answer: string };

export const Route = createFileRoute("/_authenticated/chat/analizza")({
  head: () => ({
    meta: [
      { title: "Analizza documenti — CAF AI" },
      {
        name: "description",
        content: "Allega uno o più documenti e chiedi all'AI cosa contengono: risposta con pagina e riga.",
      },
      { property: "og:title", content: "Analizza documenti — CAF AI" },
      { property: "og:description", content: "Analisi temporanea di documenti con risposte citate." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AnalizzaPage,
});

const SUGGESTIONS = [
  "In questo contratto è prevista la cedolare secca?",
  "Qual è il canone annuo e la durata del contratto?",
  "Ci sono familiari a carico indicati nel documento?",
  "Riassumi i punti principali del documento",
];

function AnalizzaPage() {
  const [docs, setDocs] = useState<AttachedDoc[]>([]);
  const [engine, setEngine] = useAiEngine();
  const [history, setHistory] = useState<QA[]>([]);
  const [pending, setPending] = useState<QA | null>(null);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, pending]);

  function changeDocs(next: AttachedDoc[]) {
    setDocs(next);
    // A different set of documents starts a fresh analysis.
    setHistory([]);
  }

  async function ask(q: string) {
    setBusy(true);
    setPending({ question: q, answer: "" });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sessione scaduta");
      const res = await fetch("/api/analizza", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          question: q,
          engine,
          transcript: docsToTranscript(docs),
          filename: docs.map((d) => d.name).join(", "),
          history: history.flatMap((h) => [
            { role: "user" as const, content: h.question },
            { role: "assistant" as const, content: h.answer },
          ]),
        }),
      });
      if (!res.ok || !res.body) throw new Error((await res.text()) || `Errore ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setPending({ question: q, answer: text });
      }
      setHistory((h) => [...h, { question: q, answer: text }]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore nell'analisi");
    } finally {
      setPending(null);
      setBusy(false);
    }
  }

  const started = history.length > 0 || pending;

  const composer = (
    <HomeComposer
      autoFocus
      keepDocs
      requireDocs
      header={
        !started ? (
          <WelcomeHeader icon={<FileSearch className="h-7 w-7 text-primary" />} title="Analizza documenti">
            Allega con la graffetta uno o più documenti (PDF, MD, TXT) e chiedi cosa contengono, es.
            «in questo contratto c'è la cedolare secca?». Riceverai un verdetto con pagina e riga.
          </WelcomeHeader>
        ) : undefined
      }
      placeholder={docs.length ? "Fai una domanda sui documenti allegati…" : "Allega prima un documento con la graffetta…"}
      suggestions={!started ? SUGGESTIONS : undefined}
      busy={busy}
      docs={docs}
      onDocsChange={changeDocs}
      engine={engine}
      onEngineChange={setEngine}
      onSubmit={ask}
    />
  );

  if (!started) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-10 overflow-y-auto">
        <div className="w-full max-w-2xl">
          {composer}
          <p className="mt-4 text-xs text-muted-foreground flex items-center justify-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" /> Nessun file viene salvato: l'analisi è temporanea.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto w-full px-4 py-6 space-y-6">
          {[...history, ...(pending ? [pending] : [])].map((h, i) => (
            <QaBlock key={i} {...h} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
      <div className="border-t border-border bg-background/80 backdrop-blur">
        <div className="max-w-3xl mx-auto w-full px-4 py-3">{composer}</div>
      </div>
    </div>
  );
}

function QaBlock({ question, answer }: QA) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-primary text-primary-foreground rounded-2xl rounded-tr-md px-4 py-2.5 whitespace-pre-wrap text-[15px]">
          {question}
        </div>
      </div>
      <div className="prose prose-sm prose-invert max-w-none">
        {answer ? <ReactMarkdown>{answer}</ReactMarkdown> : <span className="text-muted-foreground text-sm">Sto analizzando i documenti…</span>}
      </div>
    </div>
  );
}
