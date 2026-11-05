/**
 * OCR endpoint for scanned PDFs / photos: receives page images (data URLs)
 * and returns the transcribed text per page. Nothing is stored.
 */
import { createFileRoute } from "@tanstack/react-router";
import { generateText } from "ai";
import { requireApprovedUser } from "@/lib/api-auth.server";
import { createGeminiProvider } from "@/lib/ai/lovable.server";

export const Route = createFileRoute("/api/ocr")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireApprovedUser(request);
        if (!auth.ok) return auth.response;
        const { images } = (await request.json()) as { images?: string[] };
        if (!images?.length || images.length > 20) {
          return new Response("Bad Request", { status: 400 });
        }
        const model = createGeminiProvider().chatModel("google/gemini-3.8-flash");
        const pages = await Promise.all(
          images.map(async (img) => {
            try {
              const { text } = await generateText({
                model,
                messages: [
                  {
                    role: "user",
                    content: [
                      {
                        type: "text",
                        text: "Trascrivi fedelmente TUTTO il testo di questa pagina, riga per riga, nell'ordine di lettura. Restituisci solo il testo, senza commenti.",
                      },
                      { type: "image", image: img },
                    ],
                  },
                ],
              });
              return text;
            } catch {
              return "";
            }
          }),
        );
        return Response.json({ pages });
      },
    },
  },
});
