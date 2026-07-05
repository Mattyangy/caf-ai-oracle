/**
 * RAG (Retrieval-Augmented Generation) helpers — server only.
 * Searches the internal archive first, builds context, then hands off to the AI model.
 *
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
  filename: string;
  page_number: number | null;
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

/**
 * Full-text search over document_chunks, ordered by relevance.
 * Returns the top N hits with document metadata joined.
 */
export async function searchArchive(question: string, limit = 6): Promise<SearchHit[]> {
  const supabase = adminClient();
  const tsQuery = buildQuery(question);

  const { data: rows, error } = await supabase
    .from("document_chunks")
    .select("id, document_id, page_number, content, documents(title, filename, doc_type)")
    .textSearch("content_tsv", tsQuery, { config: "italian", type: "websearch" })
    .limit(limit);

  if (error || !rows) return [];

  return rows.map((r) => {
    const doc = r.documents as { title: string; filename: string; doc_type: string } | null;
    return {
      chunk_id: r.id,
      document_id: r.document_id,
      document_title: doc?.title ?? "Documento",
      document_type: doc?.doc_type ?? "documento",
      filename: doc?.filename ?? "",
      page_number: r.page_number,
      content: r.content,
      rank: 0,
    };
  });
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

Rispondi comunque usando le tue conoscenze generali in materia fiscale, previdenziale e assistenziale, indicando CHIARAMENTE nella risposta che la risposta non è supportata da documentazione interna e invitando l'operatore a verificarla presso le fonti ufficiali (Agenzia delle Entrate, INPS, normativa vigente).

Rispondi in italiano, in modo chiaro, completo e professionale. Struttura la risposta con paragrafi ben leggibili e, dove utile, elenchi puntati.`;
  }

  const context = hits
    .map((h, i) => {
      const page = h.page_number ? ` — pagina ${h.page_number}` : "";
      return `[Fonte ${i + 1}] ${h.document_title}${page} (${h.document_type})\n${h.content.slice(0, 1500)}`;
    })
    .join("\n\n---\n\n");

  return `Sei CAF AI, un assistente operativo per operatori di CAF e Patronato in Italia. Data odierna: ${now}.

Ho consultato l'archivio interno e ho trovato i seguenti estratti pertinenti:

===== ARCHIVIO INTERNO =====
${context}
============================

Istruzioni:
1. Usa PRIORITARIAMENTE le informazioni dell'archivio interno per costruire la risposta.
2. Se le informazioni sono parziali, puoi integrarle con le tue conoscenze generali, ma segnala chiaramente cosa proviene dall'archivio e cosa è integrazione.
3. Se le fonti non rispondono alla domanda, dillo esplicitamente e rispondi con conoscenza generale invitando a verificare presso fonti ufficiali.
4. Non citare i numeri [Fonte N] nel corpo della risposta: le fonti verranno mostrate a parte.
5. Rispondi in italiano, in modo chiaro e professionale, con paragrafi e — dove utile — elenchi puntati.
6. Alla fine, aggiungi una riga con "RIEPILOGO:" e una sintesi in 1-2 frasi.`;
}

/**
 * Estimate answer reliability based on how many high-quality hits were found.
 * This is a technical estimate, not a certification.
 */
export function estimateReliability(hits: SearchHit[]): { label: string; score: number } {
  if (hits.length === 0) return { label: "Bassa", score: 25 };
  if (hits.length === 1) return { label: "Media", score: 55 };
  if (hits.length <= 3) return { label: "Alta", score: 80 };
  return { label: "Molto alta", score: 95 };
}

export function buildSourcesPayload(hits: SearchHit[]) {
  // Dedupe by document
  const seen = new Set<string>();
  const sources: Array<{
    document_id: string;
    title: string;
    filename: string;
    doc_type: string;
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
      page_number: h.page_number,
    });
  }
  return sources;
}
