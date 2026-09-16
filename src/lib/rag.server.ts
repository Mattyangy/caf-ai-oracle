/**
 * RAG (Retrieval-Augmented Generation) helpers — server only.
 * Searches the internal archive first, builds context, then hands off to the AI model.
 *
 * Retrieval priority (per business requirement):
 *   1. "circolari" — official circulars uploaded by the admin
 *   2. every other archive category
 * The search logic is intentionally separated from the AI call so the AI provider
 * can be swapped without touching retrieval.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type SearchHit = {
  chunk_id: string;
  document_id: string;
  document_title: string;
  document_type: string;
  categoria: string;
  filename: string;
  page_number: number | null;
  /** 1-based line range of the extract inside the page. */
  line_start: number | null;
  line_end: number | null;
  content: string;
  rank: number;
};

/**
 * Build a service-role Supabase client for privileged reads (RAG needs to bypass
 * the caller's RLS since chunks might be scoped differently in the future).
 */
function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/**
 * Convert a natural-language question into a Postgres websearch tsquery.
 * We keep it simple and let the built-in "italian" dictionary handle stemming.
 */
function buildQuery(question: string): string {
  return question
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 12)
    .join(" & ") || question;
}

type ChunkRow = {
  id: string;
  document_id: string;
  page_number: number | null;
  line_start: number | null;
  line_end: number | null;
  content: string;
  documents: {
    title: string;
    filename: string;
    doc_type: string;
    categoria: string;
  } | null;
};

function toHits(rows: ChunkRow[]): SearchHit[] {
  return rows.map((r) => ({
    chunk_id: r.id,
    document_id: r.document_id,
    document_title: r.documents?.title ?? "Documento",
    document_type: r.documents?.doc_type ?? "documento",
    categoria: r.documents?.categoria ?? "documento",
    filename: r.documents?.filename ?? "",
    page_number: r.page_number,
    line_start: r.line_start,
    line_end: r.line_end,
    content: r.content,
    rank: 0,
  }));
}

/**
 * Full-text search over document_chunks, ordered by relevance.
 * `onlyCategoria` restricts the search to a single archive category.
 */
async function search(
  supabase: SupabaseClient<Database>,
  tsQuery: string,
  limit: number,
  onlyCategoria?: string,
): Promise<SearchHit[]> {
  let q = supabase
    .from("document_chunks")
    .select(
      "id, document_id, page_number, content, documents!inner(title, filename, doc_type, categoria)",
    )
    .textSearch("content_tsv", tsQuery, { config: "italian", type: "websearch" });

  if (onlyCategoria) q = q.eq("documents.categoria", onlyCategoria);

  const { data: rows, error } = await q.limit(limit);
  if (error || !rows) return [];
  return toHits(rows as unknown as ChunkRow[]);
}

/**
 * Search the archive, giving absolute priority to the "circolari" category.
 * Any remaining slots are filled with hits from the rest of the archive.
 */
export async function searchArchive(question: string, limit = 6): Promise<SearchHit[]> {
  const supabase = adminClient();
  const tsQuery = buildQuery(question);

  const circolari = await search(supabase, tsQuery, limit, "circolari");
  if (circolari.length >= limit) return circolari;

  const others = await search(supabase, tsQuery, limit);
  const seen = new Set(circolari.map((h) => h.chunk_id));
  const rest = others.filter((h) => !seen.has(h.chunk_id));

  return [...circolari, ...rest].slice(0, limit);
}

/**
 * Build the augmented prompt that the model sees.
 * The system prompt is explicit about how to use the context and how to signal
 * missing information — this drives the "affidabilità" scoring.
 */
export function buildSystemPrompt(hits: SearchHit[]): string {
  const now = new Date().toLocaleDateString("it-IT");
  if (hits.length === 0) {
    return `Sei CAF AI, un assistente operativo per operatori di CAF e Patronato in Italia. Data odierna: ${now}.

Nessun documento pertinente è stato trovato nell'archivio interno per questa domanda.

Rispondi comunque usando le tue conoscenze generali in materia fiscale, previdenziale e assistenziale, indicando CHIARAMENTE nella risposta che la risposta NON è supportata da alcuna circolare o documento interno e invitando l'operatore a verificarla presso le fonti ufficiali (Agenzia delle Entrate, INPS, normativa vigente).

Rispondi in italiano, in modo chiaro, completo e professionale. Struttura la risposta con paragrafi ben leggibili e, dove utile, elenchi puntati.`;
  }

  const context = hits
    .map((h, i) => {
      const page = h.page_number ? ` — pagina ${h.page_number}` : "";
      const tipo = h.categoria === "circolari" ? "CIRCOLARE" : h.categoria.toUpperCase();
      return `[Fonte ${i + 1}] (${tipo}) ${h.document_title}${page}\n${h.content.slice(0, 1500)}`;
    })
    .join("\n\n---\n\n");

  const hasCircolari = hits.some((h) => h.categoria === "circolari");

  return `Sei CAF AI, un assistente operativo per operatori di CAF e Patronato in Italia. Data odierna: ${now}.

Ho consultato l'archivio interno (dando priorità alle circolari caricate) e ho trovato i seguenti estratti pertinenti:

===== ARCHIVIO INTERNO =====
${context}
============================

Istruzioni:
1. Usa PRIORITARIAMENTE le informazioni delle CIRCOLARI, poi gli altri documenti dell'archivio.
2. ${
    hasCircolari
      ? 'Apri la risposta con una riga del tipo: "Fonte: circolare interna — <titolo della circolare>, pagina <n>." e specifica sempre, nel testo, quando un\'informazione proviene da una circolare.'
      : "Nell'archivio NON sono presenti circolari pertinenti: dillo esplicitamente all'inizio della risposta."
  }
3. Se le informazioni sono parziali, puoi integrarle con le tue conoscenze generali, ma segnala chiaramente cosa proviene dall'archivio e cosa è integrazione.
4. Se le fonti non rispondono alla domanda, dillo esplicitamente e rispondi con conoscenza generale invitando a verificare presso fonti ufficiali.
5. Non citare i numeri [Fonte N] nel corpo della risposta: le fonti verranno mostrate a parte.
6. Rispondi in italiano, in modo chiaro e professionale, con paragrafi e — dove utile — elenchi puntati.
7. Alla fine, aggiungi una riga con "RIEPILOGO:" e una sintesi in 1-2 frasi.`;
}

/**
 * Estimate answer reliability. Hits coming from circolari weigh more, since
 * they are the official internal source.
 */
export function estimateReliability(hits: SearchHit[]): { label: string; score: number } {
  if (hits.length === 0) return { label: "Bassa", score: 25 };
  const circolari = hits.filter((h) => h.categoria === "circolari").length;
  if (circolari >= 2) return { label: "Molto alta", score: 95 };
  if (circolari === 1) return { label: "Alta", score: 85 };
  if (hits.length === 1) return { label: "Media", score: 55 };
  if (hits.length <= 3) return { label: "Alta", score: 75 };
  return { label: "Alta", score: 80 };
}

export function buildSourcesPayload(hits: SearchHit[]) {
  // Dedupe by document + page
  const seen = new Set<string>();
  const sources: Array<{
    document_id: string;
    title: string;
    filename: string;
    doc_type: string;
    categoria: string;
    page_number: number | null;
  }> = [];
  for (const h of hits) {
    const key = `${h.document_id}:${h.page_number ?? "-"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      document_id: h.document_id,
      title: h.document_title,
      filename: h.filename,
      doc_type: h.document_type,
      categoria: h.categoria,
      page_number: h.page_number,
    });
  }
  return sources;
}
