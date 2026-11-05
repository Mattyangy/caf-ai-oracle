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
 * Full-text search over document_chunks, ordered by relevance (ts_rank_cd).
 * Uses the `search_chunks` SQL function: words are OR-ed and ranked, so
 * natural-language questions still find the most relevant extracts.
 * `onlyCategoria` restricts the search to a single archive category.
 */
async function search(
  supabase: SupabaseClient<Database>,
  question: string,
  limit: number,
  onlyCategoria?: string,
  relevanceText: string = question,
): Promise<SearchHit[]> {
  const { data, error } = await supabase.rpc("search_chunks", {
    _query: question.replace(/[^\p{L}\p{N}\s]/gu, " "),
    _categoria: onlyCategoria ?? undefined,
    _limit: limit,
  });
  if (error || !data) {
    if (error) console.error("search_chunks failed", error);
    return [];
  }
  const terms = keyTerms(relevanceText);
  return data
    .filter((r) => isRelevant(r.content + " " + r.title, terms))
    .map((r) => ({
      chunk_id: r.id,
      document_id: r.document_id,
      document_title: r.title,
      document_type: r.doc_type,
      categoria: r.categoria,
      filename: r.filename,
      page_number: r.page_number,
      line_start: r.line_start,
      line_end: r.line_end,
      content: r.content,
      rank: r.rank,
    }));
}

const STOP = new Set(
  ("come cosa quale quali quando dove perché perche sono essere della delle dello degli nella nelle nel per con che chi una uno questo questa quello quella deve devo posso puoi può puo fare anche alla alle agli dal dalla dai tra fra più piu molto sulla sulle sul non hanno ha ho cosè qual " +
    // generic words that appear everywhere in fiscal guides and match anything
    "funziona funzionano serve servono servire documenti documento documentazione domanda domande quest anno anni calcola calcolare calcolo spetta spettano ottenere avere richiedere richiesta presentare procedura cosa informazioni sapere vorrei bisogna occorre necessario oggi").split(/\s+/),
);

/** Meaningful words of the question (≥4 letters, no stopwords), stemmed to 5 chars. */
function keyTerms(q: string): string[] {
  const words = q.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/);
  return [...new Set(words.filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.slice(0, 5)))];
}

/** An extract is relevant only if it contains most of the key words (min 2 when possible). */
function isRelevant(text: string, terms: string[]): boolean {
  if (terms.length === 0) return false;
  const t = text.toLowerCase();
  const found = terms.filter((w) => t.includes(w)).length;
  const needed = terms.length === 1 ? 1 : Math.max(2, Math.ceil(terms.length * 0.6));
  return found >= needed;
}

/**
 * Search the archive, giving absolute priority to the "circolari" category.
 * Any remaining slots are filled with hits from the rest of the archive.
 */
export async function searchArchive(question: string, limit = 10): Promise<SearchHit[]> {
  const supabase = adminClient();
  const { corrected, keywords } = await understandQuestion(question);
  const queries = [...new Set([corrected, `${corrected} ${keywords}`, question])];

  const seen = new Set<string>();
  const out: SearchHit[] = [];
  const add = (hits: SearchHit[]) => {
    for (const h of hits) {
      if (!seen.has(h.chunk_id)) {
        seen.add(h.chunk_id);
        out.push(h);
      }
    }
  };
  // Circolari first, then the rest of the archive.
  for (const q of queries) add(await search(supabase, q, limit, "circolari", corrected));
  for (const q of queries) add(await search(supabase, q, limit, undefined, corrected));
  return out.slice(0, limit);
}

/**
 * Understand a possibly misspelled question: fix typos and add search keywords
 * (synonyms, acronyms). Only rewrites the query; never answers it.
 */
export async function understandQuestion(
  question: string,
): Promise<{ corrected: string; keywords: string }> {
  try {
    const { generateText } = await import("ai");
    const { createGeminiProvider } = await import("./ai/lovable.server");
    const { text } = await generateText({
      model: createGeminiProvider().chatModel("google/gemini-3.1-flash-lite"),
      system:
        "Sei un correttore di domande per operatori CAF/Patronato (fisco, ISEE, INPS, 730, bonus). " +
        "Correggi errori di battitura e interpreta la domanda. Rispondi SOLO con due righe:\n" +
        "DOMANDA: <domanda corretta in italiano>\nPAROLE: <5-10 parole chiave e sinonimi utili per cercare nei documenti, separate da spazio>",
      prompt: question,
    });
    const corrected = /DOMANDA:\s*(.+)/i.exec(text)?.[1]?.trim() || question;
    const keywords = /PAROLE:\s*(.+)/i.exec(text)?.[1]?.trim() || "";
    return { corrected, keywords };
  } catch (err) {
    console.error("understandQuestion failed", err);
    return { corrected: question, keywords: "" };
  }
}

/**
 * Search ONLY the "circolari" category — used by the dedicated
 * "Ricerca circolari" page, which must never mix in other sources.
 */
export async function searchCircolari(question: string, limit = 8): Promise<SearchHit[]> {
  return search(adminClient(), question, limit, "circolari");
}

/** Used when the archive has nothing relevant: never answer from outside knowledge. */
const NOT_FOUND_PROMPT = `Sei CAF AI. Nell'archivio interno (FAQ, circolari, guide, documenti caricati) non è stato trovato nessun documento pertinente alla domanda.
Rispondi SOLO con: "Nell'archivio (FAQ, circolari e documenti caricati) non ho trovato una risposta sicura a questa domanda. Carica il documento pertinente nell'Archivio AI oppure riformula la domanda."
Non aggiungere nessun'altra informazione e non usare conoscenze esterne.`;

/** Prompt for the dedicated circular-search answer (short, always cited). */
export function buildCircolariPrompt(hits: SearchHit[]): string {
  if (hits.length === 0) {
    return NOT_FOUND_PROMPT;
  }

  const context = hits
    .map((h, i) => {
      const page = h.page_number ? `pagina ${h.page_number}` : "pagina n/d";
      const lines =
        h.line_start && h.line_end
          ? h.line_start === h.line_end
            ? `, riga ${h.line_start}`
            : `, righe ${h.line_start}-${h.line_end}`
          : "";
      return `[Estratto ${i + 1}] ${h.document_title} — ${page}${lines}\n${h.content.slice(0, 1500)}`;
    })
    .join("\n\n---\n\n");

  return `Sei CAF AI, assistente per operatori di CAF e Patronato. Rispondi SOLO sulla base delle circolari qui riportate.

===== CIRCOLARI TROVATE =====
${context}
=============================

Istruzioni:
1. Rispondi in italiano, in modo sintetico e operativo (massimo 10 righe).
2. Cita sempre la circolare, la pagina e le righe da cui proviene ogni informazione (es. "Circolare X, pagina 3, righe 12-18").
3. Se le circolari non rispondono alla domanda, scrivi solo: "Nell'archivio non ho trovato documenti che rispondono a questa domanda." Non usare MAI conoscenze esterne.
5. Chiudi con una riga "VERIFICA:" che riporta tra virgolette la frase esatta del documento che conferma la risposta, con documento e pagina.
4. Numera ogni informazione con il numero dell'estratto tra parentesi quadre, es. [1], [2], seguito da circolare, pagina e righe. Se ci sono più risposte, elencale numerate. Cita SOLO gli estratti che rispondono davvero alla domanda: non citare estratti non pertinenti.`;
}

/**
 * Build the augmented prompt that the model sees.
 * The system prompt is explicit about how to use the context and how to signal
 * missing information — this drives the "affidabilità" scoring.
 */
export function buildSystemPrompt(hits: SearchHit[]): string {
  const now = new Date().toLocaleDateString("it-IT");
  if (hits.length === 0) {
    return `${NOT_FOUND_PROMPT}\nUltima riga: "FONTI USATE: nessuna".`;
  }

  const context = hits
    .map((h, i) => {
      const page = h.page_number ? ` — pagina ${h.page_number}` : "";
      const tipo = h.categoria === "circolari" ? "CIRCOLARE" : h.categoria.toUpperCase();
      return `[Fonte ${i + 1}] (${tipo}) ${h.document_title}${page}\n${h.content.slice(0, 1500)}`;
    })
    .join("\n\n---\n\n");

  return `Sei CAF AI, un assistente operativo per operatori di CAF e Patronato in Italia. Data odierna: ${now}.

Ho consultato l'archivio interno (circolari, FAQ, guide…) e ho trovato questi estratti, che POTREBBERO NON essere pertinenti:

===== ARCHIVIO INTERNO =====
${context}
============================

Istruzioni:
0. La domanda può contenere errori di battitura: interpretala nel senso più sensato per un operatore CAF (es. "isse" = ISEE) e rispondi a quello.
1. Valuta se ogni estratto riguarda l'argomento della domanda (stessa prestazione/agevolazione). Un estratto che condivide solo qualche parola NON è pertinente: ignoralo. Se gli estratti pertinenti rispondono anche solo in parte, NON rifiutare: ragiona combinando TUTTI gli estratti pertinenti e dai la risposta più completa possibile (requisiti, condizioni, casi, scadenze, documenti), indicando chiaramente cosa l'archivio non specifica.
2. Se almeno un estratto è pertinente, apri la risposta con una riga: "Fonte: <titolo del documento>, pagina <n>." (se è una circolare scrivi "Fonte: circolare interna — <titolo>, pagina <n>.") e basa la risposta su quegli estratti, priorità alle CIRCOLARI.
3. Se NESSUN estratto è pertinente, scrivi solo: "Nell'archivio (FAQ, circolari e documenti caricati) non ho trovato una risposta sicura a questa domanda. Carica il documento pertinente nell'Archivio AI." e NON rispondere con altre informazioni.
4. Usa ESCLUSIVAMENTE il contenuto degli estratti: vietato usare conoscenze esterne, generali o di internet, vietato dedurre importi, date o requisiti non scritti. Ragiona passo per passo solo sul testo.
4b. Prima del riepilogo aggiungi una riga "VERIFICA:" che riporta tra virgolette la frase esatta del documento che conferma la risposta, con documento e pagina.
5. Non citare i numeri [Fonte N] nel corpo della risposta.
6. Rispondi in italiano, in modo chiaro e professionale, con paragrafi e — dove utile — elenchi puntati.
7. Aggiungi una riga con "RIEPILOGO:" e una sintesi in 1-2 frasi.
8. ULTIMA riga obbligatoria, da sola: "FONTI USATE: " seguito dai numeri delle fonti effettivamente usate (es. "FONTI USATE: 1, 3"), oppure "FONTI USATE: nessuna".`;
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
  // Dedupe by document + page; `refs` keeps every [Fonte N] number merged here
  // so the client can show only the sources the model declared as used.
  const byKey = new Map<string, number>();
  const sources: Array<{
    document_id: string;
    title: string;
    filename: string;
    doc_type: string;
    categoria: string;
    page_number: number | null;
    line_start: number | null;
    line_end: number | null;
    refs: number[];
  }> = [];
  hits.forEach((h, i) => {
    const key = `${h.document_id}:${h.page_number ?? "-"}`;
    const existing = byKey.get(key);
    if (existing !== undefined) {
      sources[existing].refs.push(i + 1);
      return;
    }
    byKey.set(key, sources.length);
    sources.push({
      document_id: h.document_id,
      title: h.document_title,
      filename: h.filename,
      doc_type: h.document_type,
      categoria: h.categoria,
      page_number: h.page_number,
      line_start: h.line_start,
      line_end: h.line_end,
      refs: [i + 1],
    });
  });
  return sources;
}
