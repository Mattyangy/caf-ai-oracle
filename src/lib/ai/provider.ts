/**
 * AI Provider abstraction.
 *
 * The rest of the application MUST depend only on this interface, never on a
 * specific provider (OpenAI/ChatGPT, Gemini, Anthropic). To swap provider:
 *   1. Add a new implementation of `AiProvider` under src/lib/ai/<vendor>.server.ts
 *   2. Change the export in src/lib/ai/index.server.ts
 * No other file should need edits.
 */
import type { LanguageModel } from "ai";

export type AiProvider = {
  /** Identifier for logging / debugging. */
  readonly name: string;
  /** Returns a LanguageModel instance ready for streamText / generateText. */
  chatModel(modelId?: string): LanguageModel;
  /** Default model id for chat completions. */
  readonly defaultChatModel: string;
  /**
   * Vendor-specific options forwarded to streamText({ providerOptions }).
   * Optional: providers that need none simply omit it.
   */
  readonly chatProviderOptions?: Record<
    string,
    Record<string, string | number | boolean | string[]>
  >;
};
