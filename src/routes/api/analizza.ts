/**
 * Temporary document analysis endpoint.
 *
 * The client extracts the text of the uploaded file in the browser and sends
 * a numbered transcript ([p<pagina> r<riga>] ...) together with a question.
 * NOTHING is stored: no storage upload, no database row. The answer is a
 * Sì / No / Non chiaro verdict plus citations with page and line.
 */
import { createFileRoute } from "@tanstack/react-router";
import { streamText, type ModelMessage } from "ai";
import { requireApprovedUser } from "@/lib/api-auth.server";
import { getAiProvider } from "@/lib/ai/index.server";

type Body = {
  question?: string;
  transcript?: string;
  filename?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
};

export const Route = createFileRoute("/api/analizza")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireApprovedUser(request);
        if (!auth.ok) return auth.response;

        const body = (await request.json()) as Body;
        const question = (body.question ?? "").trim();
        const transcript = (body.transcript ?? "").trim();
        if (!question || !transcript) {
          return new Response("Bad Request", { status: 400 });
        }

        const system = `Sei CAF AI, assistente per operatori di CAF e Patronato.
Analizzi un documento caricato temporaneamente dall'operatore ("${body.filename ?? "documento"}").
Il testo è numerato nel formato [p<pagina> r<riga>].

===== DOCUMENTO =====
${transcript}
=====================

Istruzioni obbligatorie:
1. Inizia la risposta con una riga "VERDETTO: Sì" oppure "VERDETTO: No" oppure "VERDETTO: Non chiaro".
2. Poi spiega in italiano, in modo breve e operativo, il motivo.
3. Cita SEMPRE i punti del documento usati, indicando pagina e riga (es. "pagina 2, righe 14-17") e riportando tra virgolette la frase rilevante.
4. Usa esclusivamente il contenuto del documento. Se l'informazione non c'è, il verdetto è "Non chiaro" e devi dirlo esplicitamente.
5. Non inventare clausole, importi o riferimenti normativi non presenti nel testo.`;

        const messages: ModelMessage[] = [
          ...(body.history ?? []).map((m) => ({ role: m.role, content: m.content })),
          { role: "user" as const, content: question },
        ];

        const provider = getAiProvider();
        const result = streamText({
          model: provider.chatModel(),
          system,
          messages,
          ...(provider.chatProviderOptions
            ? { providerOptions: provider.chatProviderOptions }
            : {}),
        });

        return result.toTextStreamResponse();
      },
    },
  },
});
