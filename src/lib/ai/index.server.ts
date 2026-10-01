/**
 * AI provider selector.
 *
 * Each engine id (see ./models.ts) maps to one AiProvider implementation.
 * To add a vendor (Anthropic, direct OpenAI key, …) implement AiProvider in
 * this folder and register it here. No caller needs to be modified.
 */
import type { AiProvider } from "./provider";
import { createOpenAiProvider } from "./openai.server";
import { createGeminiProvider } from "./lovable.server";
import { DEFAULT_ENGINE, isAiEngineId } from "./models";

export function getAiProvider(engine?: unknown): AiProvider {
  const id = isAiEngineId(engine) ? engine : DEFAULT_ENGINE;
  return id === "gemini" ? createGeminiProvider() : createOpenAiProvider();
}
