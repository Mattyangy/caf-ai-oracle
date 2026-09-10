/**
 * ChatGPT (OpenAI) implementation of the AiProvider interface.
 *
 * The models are reached through the Lovable AI Gateway, so no personal OpenAI
 * key is required. To use a direct OpenAI account instead, change baseURL to
 * "https://api.openai.com/v1", pass `apiKey: process.env.OPENAI_API_KEY` and
 * drop the Lovable headers — nothing else in the app changes.
 */
import { createOpenAI } from "@ai-sdk/openai";
import type { AiProvider } from "./provider";

/** ChatGPT model used for the answers. */
const DEFAULT_MODEL = "openai/gpt-6-astra";

export function createOpenAiProvider(): AiProvider {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY is missing");

  const openai = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey: key,
    headers: {
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
  });

  return {
    name: "openai",
    defaultChatModel: DEFAULT_MODEL,
    chatModel(modelId?: string) {
      // Responses API: required for OpenAI chat models on the gateway.
      return openai.responses(modelId ?? DEFAULT_MODEL);
    },
    chatProviderOptions: {
      openai: {
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
      },
    },
  };
}
