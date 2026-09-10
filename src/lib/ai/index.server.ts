/**
 * AI provider selector.
 *
 * To switch AI vendor globally (OpenAI / Gemini / Anthropic / etc.), implement
 * a new AiProvider in this folder and change the single line below. No caller
 * needs to be modified.
 */
import type { AiProvider } from "./provider";
import { createOpenAiProvider } from "./openai.server";

export function getAiProvider(): AiProvider {
  return createOpenAiProvider();
}
