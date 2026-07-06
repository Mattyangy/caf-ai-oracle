/**
 * Lovable AI Gateway implementation of the AiProvider interface.
 * Server-only: reads LOVABLE_API_KEY from env.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { AiProvider } from "./provider";

const DEFAULT_MODEL = "google/gemini-2.5-flash";

export function createLovableProvider(): AiProvider {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY is missing");

  const gateway = createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: {
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
  });

  return {
    name: "lovable",
    defaultChatModel: DEFAULT_MODEL,
    chatModel(modelId?: string) {
      return gateway(modelId ?? DEFAULT_MODEL);
    },
  };
}
