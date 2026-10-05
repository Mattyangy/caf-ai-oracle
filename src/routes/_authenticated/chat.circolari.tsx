/**
 * "Ricerca circolari" — home-style screen. AI search restricted to the
 * circolari archive, with PDF / page / line references and Apri / Stampa.
 * Optional attached documents are added as extra context (never stored).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import { BookOpen, ExternalLink, Printer } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getDocumentUrl } from "@/lib/documents.functions";
import {
  HomeComposer,
  WelcomeHeader,
  docsToTranscript,
  useAiEngine,
  type AttachedDoc,
} from "@/components/HomeComposer";

type Hit = {
  n: number;
  document_id: string;
  title: string;
  filename: string;
  doc_type: string;
  page_number: number | null;
  line_start: number | null;
  line_end: number | null;
  excerpt: string;
};

type Result = { question: string; answer: string; hits: Hit[]; done: boolean };

export const Route = createFileRoute("/_authenticated/chat/circolari")({
  head: () => ({
    meta: [
      { title: "Ricerca circolari — CAF AI" },
      {
        name: "description",
        content: "Cerca nelle circolari caricate con l'intelligenza artificiale e apri il PDF alla pagina e riga esatta.",
      },
      { property: "og:title", content: "Ricerca circolari — CAF AI" },
      { property: "og:description", content: "Ricerca AI nelle circolari con riferimento a pagina e riga." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CircolariPage,
});

const SUGGESTIONS = [
  "Detrazione spese sanitarie per familiari a carico",
  "Requisiti bonus ristrutturazione 2026",
  "Termini di presentazione del modello 730",
  "Assegno unico: casi di decadenza",
];

function formatLines(hit: Hit): string {
  if (!hit.line_start || !hit.line_end) return "";
  return hit.line_start === hit.line_end ? ` · riga ${hit.line_start}` : ` · righe ${hit.line_start}-${hit.line_end}`;
}

function CircolariPage() {
  const openDoc = useServerFn(getDocumentUrl);
  const [docs, setDocs] = useState<AttachedDoc[]>([]);
  const [engine, setEngine] = useAiEngine();
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [results]);

  function patchLast(p: Partial<Result>) {
    setResults((r) => r.map((x, i) => (i === r.length - 1 ? { ...x, ...p } : x)));
  }

  async function runSearch(q: string) {
    setBusy(true);
    const attached = docs;
    setResults((r) => [...r, { question: q, answer: "", hits: [], done: false }]);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sessione scaduta");
      const res = await fetch("/api/circolari-search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          question: q,
          engine,
          attachment: attached.length
            ? { names: attached.map((d) => d.name), transcript: docsToTranscript(attached) }
            : null,
        }),
      });
      if (!res.ok || !res.body) throw new Error((await res.text()) || `Errore ${res.status}`);
      const raw = res.headers.get("X-Caf-Hits");
      if (raw) patchLast({ hits: JSON.parse(decodeURIComponent(raw)) as Hit[] });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        patchLast({ answer: text });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore nella ricerca");
    } finally {
      patchLast({ done: true });
      setBusy(false);
    }
  }

  async function open(hit: Hit, print: boolean, n: number) {
    try {
      if (hit.doc_type === "pdf") {
        // In-app viewer: right page, referenced lines highlighted and numbered.
        const qs = new URLSearchParams({
          doc: hit.document_id,
          page: String(hit.page_number ?? 1),
          ls: String(hit.line_start ?? 0),
          le: String(hit.line_end ?? 0),
          n: String(n),
        });
        const win = window.open(`/pdf?${qs}`, "_blank");
        if (print && win) setTimeout(() => { try { win.print(); } catch { /* noop */ } }, 3000);
        return;
      }
      const { url } = await openDoc({ data: { document_id: hit.document_id, page: hit.page_number ?? null } });
      window.open(url, "_blank");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Documento non disponibile");
    }
  }

  const composer = (
    <HomeComposer
      autoFocus
      header={
        results.length === 0 ? (
          <WelcomeHeader icon={<BookOpen className="h-7 w-7 text-primary" />} title="Ricerca circolari">
            Scrivi cosa cerchi: l'AI consulta solo le circolari caricate e ti indica PDF, pagina e
            righe, con i pulsanti Apri e Stampa. Puoi allegare un documento da confrontare.
          </WelcomeHeader>
        ) : undefined
      }
      placeholder="Es. detrazione spese sanitarie familiari a carico"
      suggestions={results.length === 0 ? SUGGESTIONS : undefined}
      busy={busy}
      docs={docs}
      onDocsChange={setDocs}
      engine={engine}
      onEngineChange={setEngine}
      onSubmit={runSearch}
    />
  );

  if (results.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-10 overflow-y-auto">
        <div className="w-full max-w-2xl">{composer}</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto w-full px-4 py-6 space-y-8">
          {results.map((r, idx) => (
            <div key={idx} className="space-y-3">
              <div className="flex justify-end">
                <div className="max-w-[85%] bg-primary text-primary-foreground rounded-2xl rounded-tr-md px-4 py-2.5 text-[15px]">
                  {r.question}
                </div>
              </div>
              <div className="prose prose-sm prose-invert max-w-none">
                {r.answer ? <ReactMarkdown>{r.answer}</ReactMarkdown> : <span className="text-muted-foreground text-sm">Sto cercando nelle circolari…</span>}
              </div>
              {r.done && r.hits.length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Nessuna circolare pertinente trovata. Se non ne hai ancora caricate, aggiungile da
                  Amministrazione → Archivio AI scegliendo la categoria «circolari».
                </div>
              )}
              {r.hits.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Riferimenti nelle circolari ({r.hits.length})
                  </div>
                  {r.hits.map((hit, i) => (
                    <div key={i} className="rounded-xl border border-border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-[11px] font-bold">{hit.n}</span>
                            <span className="truncate">{hit.title}</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {hit.filename}
                            {hit.page_number ? ` · pagina ${hit.page_number}` : ""}
                            {formatLines(hit)}
                          </div>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <button onClick={() => open(hit, false, hit.n)} className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-surface">
                            <ExternalLink className="h-3.5 w-3.5" /> Apri
                          </button>
                          <button onClick={() => open(hit, true, hit.n)} className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-surface">
                            <Printer className="h-3.5 w-3.5" /> Stampa
                          </button>
                        </div>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">…{hit.excerpt}…</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
