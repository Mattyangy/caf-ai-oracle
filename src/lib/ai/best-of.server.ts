/**
 * "Best of" strategy: asks ChatGPT and Gemini the same question in parallel,
 * then a fast judge model picks the better answer. If one engine fails the
 * other answer is used. Callers stay provider-agnostic.
 */
import { generateText, type ModelMessage } from "ai";
import { getAiProvider } from "./index.server";
import { createGeminiProvider } from "./lovable.server";

const JUDGE_MODEL = "google/gemini-3.1-flash-lite";

async function ask(engine: "chatgpt" | "gemini", system: string, messages: ModelMessage[]) {
  const p = getAiProvider(engine);
  const r = await generateText({
    model: p.chatModel(),
    system,
    messages,
    ...(p.chatProviderOptions ? { providerOptions: p.chatProviderOptions } : {}),
  });
  return r.text.trim();
}

export async function bestOfAnswer(system: string, messages: ModelMessage[]): Promise<string> {
  const [a, b] = await Promise.allSettled([
    ask("chatgpt", system, messages),
    ask("gemini", system, messages),
  ]);
  const gpt = a.status === "fulfilled" ? a.value : "";
  const gem = b.status === "fulfilled" ? b.value : "";
  if (!gpt && !gem) throw new Error("Nessun motore AI ha risposto");
  if (!gpt) return gem;
  if (!gem) return gpt;

  const question = [...messages].reverse().find((m) => m.role === "user");
  try {
    const judge = await generateText({
      model: createGeminiProvider().chatModel(JUDGE_MODEL),
      system:
        "Sei un revisore esperto di materia fiscale, previdenziale e assistenziale italiana. " +
        "Confronta due risposte rispetto alle istruzioni e alle fonti fornite. Preferisci la risposta più corretta, " +
        "fedele alle fonti, con citazioni precise (documento, pagina, riga) e operativa. Rispondi SOLO con la lettera A o B.",
      prompt: `ISTRUZIONI E FONTI:\n${system.slice(0, 60_000)}\n\nDOMANDA:\n${
        typeof question?.content === "string" ? question.content : ""
      }\n\nRISPOSTA A:\n${gpt}\n\nRISPOSTA B:\n${gem}\n\nQuale è migliore? (A o B)`,
    });
    return judge.text.trim().toUpperCase().startsWith("B") ? gem : gpt;
  } catch {
    return gpt;
  }
}

/** Plain-text Response compatible with the existing streaming readers. */
export function textResponse(text: string, headers: Record<string, string> = {}) {
  return new Response(text, {
    headers: { "Content-Type": "text/plain; charset=utf-8", ...headers },
  });
}
