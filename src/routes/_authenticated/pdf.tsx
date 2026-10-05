/**
 * In-app PDF viewer: opens a stored document at the given page, highlights
 * the referenced lines (same line reconstruction as pdf-extract.ts) and marks
 * them with the result number shown in the search results.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { ChevronLeft, ChevronRight, Loader2, Printer } from "lucide-react";
import { getDocumentUrl } from "@/lib/documents.functions";

const searchSchema = z.object({
  doc: fallback(z.string(), "").default(""),
  page: fallback(z.number().int(), 1).default(1),
  ls: fallback(z.number().int(), 0).default(0),
  le: fallback(z.number().int(), 0).default(0),
  n: fallback(z.number().int(), 0).default(0),
});

export const Route = createFileRoute("/_authenticated/pdf")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Documento — CAF AI" },
      { name: "description", content: "Visualizza la circolare alla pagina e riga di riferimento." },
      { property: "og:title", content: "Documento — CAF AI" },
      { property: "og:description", content: "Circolare con riga evidenziata e numerata." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PdfViewer,
});

type Item = { str: string; transform: number[]; width: number; height: number };
type Row = { y: number; minX: number; maxX: number; h: number };

/** Same clustering as itemsToLines, but keeping geometry. */
function rowsOf(items: Item[]): Row[] {
  const rows: Row[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = Math.round(it.transform[5] ?? 0);
    const x = it.transform[4] ?? 0;
    const h = it.height || Math.abs(it.transform[3] ?? 10);
    const row = rows.find((r) => Math.abs(r.y - y) <= 3);
    if (row) {
      row.minX = Math.min(row.minX, x);
      row.maxX = Math.max(row.maxX, x + it.width);
      row.h = Math.max(row.h, h);
    } else rows.push({ y, minX: x, maxX: x + it.width, h });
  }
  return rows.sort((a, b) => b.y - a.y);
}

function PdfViewer() {
  const { doc, page: startPage, ls, le, n } = Route.useSearch();
  const getUrl = useServerFn(getDocumentUrl);
  const [pdf, setPdf] = useState<any>(null);
  const [page, setPage] = useState(startPage);
  const [error, setError] = useState("");
  const [marks, setMarks] = useState<Array<{ left: number; top: number; width: number; height: number }>>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!doc) return;
    (async () => {
      try {
        const { url } = await getUrl({ data: { document_id: doc, page: null } });
        const pdfjs = await import("pdfjs-dist");
        const workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
        const buf = await (await fetch(url)).arrayBuffer();
        setPdf(await pdfjs.getDocument({ data: buf }).promise);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Documento non disponibile");
      }
    })();
  }, [doc, getUrl]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      const p = await pdf.getPage(page);
      const viewport = p.getViewport({ scale: 1.5 });
      const canvas = canvasRef.current!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await p.render({ canvasContext: canvas.getContext("2d")!, viewport, canvas }).promise;
      if (cancelled) return;
      if (page !== startPage || !ls) return setMarks([]);
      const rows = rowsOf((await p.getTextContent()).items as Item[]);
      const picked = rows.slice(ls - 1, (le || ls));
      setMarks(
        picked.map((r) => {
          const [x1, y1] = viewport.convertToViewportPoint(r.minX, r.y + r.h);
          const [x2, y2] = viewport.convertToViewportPoint(r.maxX, r.y - r.h * 0.3);
          return { left: x1 - 4, top: y1, width: x2 - x1 + 8, height: y2 - y1 };
        }),
      );
      setTimeout(() => markRef.current?.scrollIntoView({ block: "center" }), 50);
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, page, startPage, ls, le]);

  const total = pdf?.numPages ?? 0;

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-background px-4 py-2 print:hidden">
        <div className="text-sm">
          {n > 0 && <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">{n}</span>}
          Pagina {page}{total ? ` di ${total}` : ""}
          {ls ? ` · ${le && le !== ls ? `righe ${ls}-${le}` : `riga ${ls}`}` : ""}
        </div>
        <div className="flex gap-1.5">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="p-1.5 rounded-md border border-border disabled:opacity-40" aria-label="Pagina precedente"><ChevronLeft className="h-4 w-4" /></button>
          <button disabled={!total || page >= total} onClick={() => setPage(page + 1)} className="p-1.5 rounded-md border border-border disabled:opacity-40" aria-label="Pagina successiva"><ChevronRight className="h-4 w-4" /></button>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-border"><Printer className="h-3.5 w-3.5" /> Stampa</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {error ? (
          <p className="text-center text-sm text-destructive">{error}</p>
        ) : !pdf ? (
          <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : null}
        <div className="relative mx-auto w-fit shadow-lg">
          <canvas ref={canvasRef} className="block max-w-none" />
          {marks.map((m, i) => (
            <div key={i} ref={i === 0 ? markRef : undefined} className="absolute rounded-sm bg-warning/35 ring-2 ring-warning" style={m}>
              {i === 0 && n > 0 && (
                <span className="absolute -left-8 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">{n}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
