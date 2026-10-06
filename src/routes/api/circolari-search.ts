/**
 * Dedicated circular search endpoint.
 * Searches ONLY the "circolari" archive category and streams a short,
 * always-cited answer. The matching extracts (document, page, line range)
 * travel in the X-Caf-Hits response header so the UI can render
 * "Apri PDF alla pagina" / "Stampa" buttons immediately.
 * The client keeps only the extracts the answer actually cites ([1], [2]…).
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

        const body = (await request.json()) as {
          question?: string;
          attachment?: { names?: string[]; transcript?: string } | null;
        };
        const question = (body.question ?? "").trim();
        if (!question) return new Response("Bad Request", { status: 400 });

        const hits = await searchCircolari(question, 8);

        const allHits = hits.map((h, i) => ({
          n: i + 1,
          document_id: h.document_id,
          title: h.document_title,
          filename: h.filename,
          doc_type: h.document_type,
          page_number: h.page_number,
          line_start: h.line_start,
          line_end: h.line_end,
          excerpt: h.content.slice(0, 600),
        }));

        const system = body.attachment?.transcript
          ? `${buildCircolariPrompt(hits)}

===== DOCUMENTO ALLEGATO DALL'OPERATORE (${(body.attachment.names ?? []).join(", ")}) =====
Testo numerato [p<pagina> r<riga>]. Usalo per confrontarlo con le circolari e cita pagina e riga.
${body.attachment.transcript.slice(0, 300_000)}`
          : buildCircolariPrompt(hits);

        const provider = getAiProvider();
        const result = streamText({
          model: provider.chatModel(),
          system,
          messages: [{ role: "user", content: question }],
          ...(provider.chatProviderOptions
            ? { providerOptions: provider.chatProviderOptions }
            : {}),
        });
        return result.toTextStreamResponse({
          headers: {
            "X-Caf-Hits": encodeURIComponent(JSON.stringify(allHits)),
            "Access-Control-Expose-Headers": "X-Caf-Hits",
          },
        });
      },
    },
  },
});
