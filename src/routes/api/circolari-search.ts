/**
 * Dedicated circular search endpoint.
 * Searches ONLY the "circolari" archive category and streams a short,
 * always-cited answer. The matching extracts (document, page, line range)
 * travel in the X-Caf-Hits response header so the UI can render
 * "Apri PDF alla pagina" / "Stampa" buttons immediately.
 */
import { createFileRoute } from "@tanstack/react-router";
import { streamText } from "ai";
import { requireApprovedUser } from "@/lib/api-auth.server";
import { buildCircolariPrompt, searchCircolari } from "@/lib/rag.server";
import { getAiProvider } from "@/lib/ai/index.server";

export const Route = createFileRoute("/api/circolari-search")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireApprovedUser(request);
        if (!auth.ok) return auth.response;

        const body = (await request.json()) as { question?: string };
        const question = (body.question ?? "").trim();
        if (!question) return new Response("Bad Request", { status: 400 });

        const hits = await searchCircolari(question, 8);

        const payload = hits.map((h) => ({
          document_id: h.document_id,
          title: h.document_title,
          filename: h.filename,
          doc_type: h.document_type,
          page_number: h.page_number,
          line_start: h.line_start,
          line_end: h.line_end,
          excerpt: h.content.slice(0, 600),
        }));

        const provider = getAiProvider();
        const result = streamText({
          model: provider.chatModel(),
          system: buildCircolariPrompt(hits),
          messages: [{ role: "user", content: question }],
          ...(provider.chatProviderOptions
            ? { providerOptions: provider.chatProviderOptions }
            : {}),
        });

        return result.toTextStreamResponse({
          headers: {
            "X-Caf-Hits": encodeURIComponent(JSON.stringify(payload)),
            "Access-Control-Expose-Headers": "X-Caf-Hits",
          },
        });
      },
    },
  },
});
