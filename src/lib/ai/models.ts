/**
 * Client-safe list of the AI engines the operator can choose from.
 * The server maps each id to a provider in src/lib/ai/index.server.ts.
 */
export type AiEngineId = "chatgpt" | "gemini";

export const AI_ENGINES: { id: AiEngineId; label: string; description: string }[] = [
  { id: "chatgpt", label: "ChatGPT", description: "OpenAI — ragionamento accurato" },
  { id: "gemini", label: "Gemini", description: "Google — risposte rapide" },
];

export const DEFAULT_ENGINE: AiEngineId = "chatgpt";

export function isAiEngineId(v: unknown): v is AiEngineId {
  return v === "chatgpt" || v === "gemini";
}
