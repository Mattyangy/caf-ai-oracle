/**
 * Server functions for archivio_ai management.
 * The archive is organised in categories: faq, casi, circolari, guide,
 * manuali, normativa, agenzia, inps (per user spec). FAQ and "casi" are
 * expected to be edited manually as .md files uploaded here — no DB
 * duplication of their content beyond the search index.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const ARCHIVE_CATEGORIES = [
  "faq",
  "casi",
  "circolari",
  "guide",
  "manuali",
  "normativa",
  "agenzia",
  "inps",
] as const;
export type ArchiveCategory = (typeof ARCHIVE_CATEGORIES)[number];

const ChunkSchema = z.object({
  page_number: z.number().int().positive().nullable(),
  chunk_index: z.number().int().nonnegative(),
  content: z.string().min(1),
  /** 1-based line range inside the page (PDF) or the file (Markdown). */
  line_start: z.number().int().positive().nullable().optional(),
  line_end: z.number().int().positive().nullable().optional(),
});

const IngestSchema = z.object({
  title: z.string().min(1).max(300),
  filename: z.string().min(1).max(300),
  categoria: z.enum(ARCHIVE_CATEGORIES),
  doc_type: z.enum(["pdf", "markdown"]),
  storage_path: z.string().min(1),
  page_count: z.number().int().nonnegative().nullable(),
  chunks: z.array(ChunkSchema).min(1).max(2000),
});

/**
 * Persist a document plus its chunks. Admin-only.
 * Called by the client after it has:
 *   1) uploaded the raw file to the "documents" storage bucket
 *   2) extracted text into chunks (client-side for PDF via pdfjs, or raw MD)
 */
export const ingestDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => IngestSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Solo un amministratore può caricare documenti.");

    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .insert({
        title: data.title,
        filename: data.filename,
        doc_type: data.doc_type,
        categoria: data.categoria,
        storage_path: data.storage_path,
        page_count: data.page_count,
        status: "indexed",
        uploaded_by: userId,
        indexed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (docErr || !doc) throw new Error(docErr?.message ?? "Errore inserimento documento");

    // Batch insert chunks (Postgres accepts sizable arrays; the client already
    // capped at 2000 per document).
    const rows = data.chunks.map((c) => ({
      document_id: doc.id,
      page_number: c.page_number,
      chunk_index: c.chunk_index,
      content: c.content,
      line_start: c.line_start ?? null,
      line_end: c.line_end ?? null,
    }));

    // Insert in batches of 200 to stay well within request size limits.
    for (let i = 0; i < rows.length; i += 200) {
      const slice = rows.slice(i, i + 200);
      const { error } = await supabase.from("document_chunks").insert(slice);
      if (error) throw new Error("Errore indicizzazione: " + error.message);
    }

    return { document_id: doc.id, chunks: rows.length };
  });

/** Delete a document (admin only). Chunks are removed by FK cascade. */
export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Non autorizzato");

    const { data: doc } = await supabase
      .from("documents")
      .select("storage_path")
      .eq("id", data.id)
      .maybeSingle();

    if (doc?.storage_path) {
      await supabase.storage.from("documents").remove([doc.storage_path]);
    }
    const { error } = await supabase.from("documents").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Signed URL for the "Apri documento" button. Any approved operator can request it. */
export const getDocumentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ document_id: z.string().uuid(), page: z.number().int().positive().nullable().optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: doc, error } = await supabase
      .from("documents")
      .select("storage_path, filename, doc_type")
      .eq("id", data.document_id)
      .maybeSingle();
    if (error || !doc || !doc.storage_path) {
      throw new Error("Documento non disponibile");
    }
    const { data: signed, error: sErr } = await supabase.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 60 * 10);
    if (sErr || !signed) throw new Error("Impossibile generare il link.");
    let url = signed.signedUrl;
    if (doc.doc_type === "pdf" && data.page) {
      url += `#page=${data.page}`;
    }
    return { url, filename: doc.filename };
  });
