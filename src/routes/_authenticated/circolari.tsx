/**
 * "Ricerca circolari" — AI search restricted to the circolari archive.
 * Returns a short cited answer plus the exact extracts (PDF, page, lines)
 * with buttons to open the PDF at the right page or to print it.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getDocumentUrl } from "@/lib/documents.functions";
import ReactMarkdown from "react-markdown";
import {
  ArrowLeft,
  Search,
  Loader2,
  FileText,
  ExternalLink,
  Printer,
} from "lucide-react";
import { toast } from "sonner";

type Hit = {
  document_id: string;
  title: string;
  filename: string;
  doc_type: string;
  page_number: number | null;
  line_start: number | null;
  line_end: number | null;
  excerpt: string;
};

export const Route = createFileRoute("/_authenticated/circolari")({
  head: () => ({
    meta: [
      { title: "Ricerca circolari — CAF AI" },
      {
        name: "description",
        content:
          "Cerca nelle circolari caricate con l'intelligenza artificiale e apri il PDF alla pagina e alla riga esatta.",
      },
      { property: "og:title", content: "Ricerca circolari — CAF AI" },
      {
        property: "og:description",
        content: "Ricerca AI nelle circolari con riferimento a pagina e riga.",
      },
    ],
  }),
  component: CircolariPage,
});

function formatLines(hit: Hit): string {
  if (!hit.line_start || !hit.line_end) return "";
  return hit.line_start === hit.line_end
    ? ` · riga ${hit.line_start}`
    : ` · righe ${hit.line_start}-${hit.line_end}`;
}

function CircolariPage() {
  const openDoc = useServerFn(getDocumentUrl);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);

  async function runSearch() {
    const q = question.trim();
    if (!q) return;
    setBusy(true);
    setAnswer("");
    setHits([]);
    setSearched(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sessione scaduta");

      const res = await fetch("/api/circolari-search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text());

      const raw = res.headers.get("X-Caf-Hits");
      if (raw) setHits(JSON.parse(decodeURIComponent(raw)) as Hit[]);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setAnswer(text);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore nella ricerca");
    } finally {
      setBusy(false);
    }
  }

  async function open(hit: Hit, print: boolean) {
    try {
      const { url } = await openDoc({
        data: { document_id: hit.document_id, page: hit.page_number ?? null },
      });
      const win = window.open(url, "_blank", "noopener");
      if (print && win) {
        // Some browsers block programmatic printing of a cross-origin PDF;
        // in that case the document simply opens and the operator uses Ctrl+P.
        setTimeout(() => {
          try {
            win.print();
          } catch {
            /* ignore */
          }
        }, 1500);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Documento non disponibile");
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

        <h1 className="text-2xl font-semibold mb-1">Ricerca circolari</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Cerca solo tra le circolari caricate nell'archivio. Per ogni risultato trovi
          il PDF, la pagina e le righe di riferimento.
        </p>

        <div className="flex gap-2 mb-6">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) runSearch();
            }}
            placeholder="Es. detrazione spese sanitarie familiari a carico"
            className="flex-1 bg-surface border border-border rounded-lg px-3 py-2.5 text-sm"
          />
          <button
            onClick={runSearch}
            disabled={busy || !question.trim()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Cerca
          </button>
        </div>

        {answer && (
          <div className="rounded-xl border border-border p-4 mb-6">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Risposta AI
            </div>
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown>{answer}</ReactMarkdown>
            </div>
          </div>
        )}

        {searched && !busy && hits.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nessuna circolare pertinente trovata.
          </div>
        )}

        {hits.length > 0 && (
          <div className="space-y-3">
            <div className="text-sm font-medium text-muted-foreground">
              Riferimenti nelle circolari ({hits.length})
            </div>
            {hits.map((hit, i) => (
              <div key={i} className="rounded-xl border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <FileText className="h-4 w-4 text-primary shrink-0" />
                      <span className="truncate">{hit.title}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {hit.filename}
                      {hit.page_number ? ` · pagina ${hit.page_number}` : ""}
                      {formatLines(hit)}
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => open(hit, false)}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-surface"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Apri
                    </button>
                    <button
                      onClick={() => open(hit, true)}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-surface"
                    >
                      <Printer className="h-3.5 w-3.5" /> Stampa
                    </button>
                  </div>
                </div>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                  …{hit.excerpt}…
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
