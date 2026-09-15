/**
 * Client-side PDF/Markdown text extraction with line tracking.
 *
 * Shared by:
 *  - Amministrazione → Archivio AI (upload + re-indicizzazione)
 *  - Analizza documento (analisi temporanea, nessun salvataggio)
 *
 * Lines are reconstructed by grouping pdf.js text items with a similar Y
 * coordinate, so every chunk can report "pagina N, righe A-B".
 */

export type ExtractedChunk = {
  page_number: number | null;
  chunk_index: number;
  content: string;
  line_start: number | null;
  line_end: number | null;
};

export type ExtractedPage = {
  page_number: number;
  /** Lines of the page, in reading order (index 0 = riga 1). */
  lines: string[];
};

export type ExtractionResult = {
  chunks: ExtractedChunk[];
  pageCount: number | null;
  pages: ExtractedPage[];
};

/** Roughly this many characters per chunk keeps full-text relevance high. */
const CHUNK_SIZE = 1200;

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Group lines into chunks of ~CHUNK_SIZE characters, keeping the line range.
 * `startLine` is 1-based.
 */
function chunkLines(
  lines: string[],
  pageNumber: number | null,
  startIndex: number,
): ExtractedChunk[] {
  const out: ExtractedChunk[] = [];
  let buffer: string[] = [];
  let bufferStart = 1;
  let length = 0;
  let index = startIndex;

  const flush = (endLine: number) => {
    const content = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (content) {
      out.push({
        page_number: pageNumber,
        chunk_index: index++,
        content,
        line_start: bufferStart,
        line_end: endLine,
      });
    }
    buffer = [];
    length = 0;
  };

  lines.forEach((line, i) => {
    if (buffer.length === 0) bufferStart = i + 1;
    buffer.push(line);
    length += line.length + 1;
    if (length >= CHUNK_SIZE) flush(i + 1);
  });
  if (buffer.length > 0) flush(lines.length);

  return out;
}

/** Split a plain-text/markdown file into chunks with line ranges. */
export async function extractMarkdown(file: File): Promise<ExtractionResult> {
  const text = await file.text();
  const lines = text.split(/\r?\n/);
  return {
    chunks: chunkLines(lines, null, 0),
    pageCount: null,
    pages: [{ page_number: 1, lines }],
  };
}

type PdfTextItem = { str: string; transform: number[] };

/** Rebuild visual lines from pdf.js text items by clustering on the Y axis. */
function itemsToLines(items: PdfTextItem[]): string[] {
  const rows: Array<{ y: number; parts: Array<{ x: number; str: string }> }> = [];
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const y = Math.round(item.transform[5] ?? 0);
    const x = item.transform[4] ?? 0;
    // Tolerance of 3pt merges super/subscript-ish jitter into one visual line.
    const row = rows.find((r) => Math.abs(r.y - y) <= 3);
    if (row) row.parts.push({ x, str: item.str });
    else rows.push({ y, parts: [{ x, str: item.str }] });
  }
  return rows
    .sort((a, b) => b.y - a.y) // top-to-bottom
    .map((r) =>
      r.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((l) => l.length > 0);
}

/** Extract a PDF page by page, keeping page and line numbers. */
export async function extractPdf(
  file: File | ArrayBuffer,
  onPage?: (page: number, total: number) => void,
): Promise<ExtractionResult> {
  const pdfjs = await import("pdfjs-dist");
  const workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

  const buffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;

  const chunks: ExtractedChunk[] = [];
  const pages: ExtractedPage[] = [];
  let chunkIndex = 0;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    onPage?.(pageNum, pdf.numPages);
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const lines = itemsToLines(content.items as unknown as PdfTextItem[]);
    pages.push({ page_number: pageNum, lines });
    const pageChunks = chunkLines(lines, pageNum, chunkIndex);
    chunkIndex += pageChunks.length;
    chunks.push(...pageChunks);
  }

  return { chunks, pageCount: pdf.numPages, pages };
}

/** Extract any supported file (PDF or Markdown/text). */
export async function extractFile(
  file: File,
  onPage?: (page: number, total: number) => void,
): Promise<ExtractionResult & { docType: "pdf" | "markdown" }> {
  const isPdf = file.name.toLowerCase().endsWith(".pdf");
  if (isPdf) return { ...(await extractPdf(file, onPage)), docType: "pdf" };
  return { ...(await extractMarkdown(file)), docType: "markdown" };
}

/** Flatten extracted pages into a numbered transcript for AI analysis. */
export function pagesToTranscript(pages: ExtractedPage[], maxChars = 120_000): string {
  const out: string[] = [];
  let total = 0;
  for (const page of pages) {
    out.push(`===== PAGINA ${page.page_number} =====`);
    page.lines.forEach((line, i) => {
      const entry = `[p${page.page_number} r${i + 1}] ${line}`;
      total += entry.length;
      if (total <= maxChars) out.push(entry);
    });
    if (total > maxChars) {
      out.push("… (documento troncato per lunghezza)");
      break;
    }
  }
  return out.join("\n");
}
