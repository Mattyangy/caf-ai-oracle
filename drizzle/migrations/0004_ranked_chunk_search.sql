CREATE OR REPLACE FUNCTION public.search_chunks(_query text, _categoria text DEFAULT NULL, _limit int DEFAULT 8)
RETURNS TABLE (
  id uuid, document_id uuid, page_number int, line_start int, line_end int, content text,
  title text, filename text, doc_type text, categoria text, rank real
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  WITH q AS (
    SELECT to_tsquery('italian', string_agg(w, ' | ')) AS tsq
    FROM (
      SELECT DISTINCT regexp_replace(w, '[^[:alnum:]]', '', 'g') AS w
      FROM regexp_split_to_table(lower(_query), '\s+') AS w
    ) t
    WHERE length(w) >= 3
  )
  SELECT c.id, c.document_id, c.page_number, c.line_start, c.line_end, c.content,
         d.title, d.filename, d.doc_type::text, d.categoria::text,
         ts_rank_cd(c.content_tsv, q.tsq) AS rank
  FROM q, public.document_chunks c
  JOIN public.documents d ON d.id = c.document_id
  WHERE q.tsq IS NOT NULL
    AND c.content_tsv @@ q.tsq
    AND (_categoria IS NULL OR d.categoria::text = _categoria)
  ORDER BY rank DESC
  LIMIT _limit;
$$;
REVOKE ALL ON FUNCTION public.search_chunks(text, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_chunks(text, text, int) TO service_role;