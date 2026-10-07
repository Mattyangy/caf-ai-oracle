/**
 * Streaming chat endpoint.
 * - Validates the caller via the Supabase bearer token
 * - Runs a full-text search over the archive (searchArchive)
 * - Builds the augmented prompt (buildSystemPrompt)
 * - Streams the AI answer back to the client
 * - Persists the assistant message with sources + reliability after stream ends
 *
 * The AI provider is retrieved through getAiProvider(), which is the ONLY
 * coupling with a specific vendor. Swap providers in src/lib/ai/index.server.ts.
 */
import { createFileRoute } from "@tanstack/react-router";
import { streamText, type ModelMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  buildSystemPrompt,
  buildSourcesPayload,
  estimateReliability,
  searchArchive,
} from "@/lib/rag.server";
import { getAiProvider } from "@/lib/ai/index.server";
import { filterUsed, parseUsedSources } from "@/lib/used-sources";

type ChatMessage = { role: "user" | "assistant"; content: string };
type ChatBody = {
  threadId?: string;
  messages?: ChatMessage[];
  /** Documents attached by the operator, extracted in the browser. Never stored. */
  attachment?: { names?: string[]; transcript?: string } | null;
};

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!token) return new Response("Unauthorized", { status: 401 });

        const url = process.env.SUPABASE_URL!;
        const anon = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const userClient = createClient<Database>(url, anon, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        });

        const { data: userData, error: userErr } = await userClient.auth.getUser(token);
        if (userErr || !userData.user) return new Response("Unauthorized", { status: 401 });
        const userId = userData.user.id;

        // Ensure profile is approved
        const { data: profile } = await userClient
          .from("profiles")
          .select("status")
          .eq("id", userId)
          .maybeSingle();
        if (!profile || profile.status !== "approved") {
          return new Response("Account non ancora approvato.", { status: 403 });
        }

        const body = (await request.json()) as ChatBody;
        const threadId = body.threadId;
        const messages = body.messages ?? [];
        if (!threadId || messages.length === 0) {
          return new Response("Bad Request", { status: 400 });
        }

        // Confirm the thread belongs to this user
        const { data: thread } = await userClient
          .from("chat_threads")
          .select("id,user_id")
          .eq("id", threadId)
          .maybeSingle();
        if (!thread || thread.user_id !== userId) {
          return new Response("Forbidden", { status: 403 });
        }

        // Last user message drives the retrieval
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        const question = (lastUser?.content ?? "").trim();

        // 1) Retrieve from archive
        const hits = question ? await searchArchive(question, 6) : [];
        const sources = buildSourcesPayload(hits);
        const reliability = estimateReliability(hits);
        const attachedText = (body.attachment?.transcript ?? "").slice(0, 400_000);
        const systemPrompt = attachedText
          ? `${buildSystemPrompt(hits)}

===== DOCUMENTI ALLEGATI DALL'OPERATORE (${(body.attachment?.names ?? []).join(", ")}) =====
Il testo è numerato nel formato [p<pagina> r<riga>].
${attachedText}
=====================
Se la domanda riguarda i documenti allegati, rispondi basandoti su di essi e cita sempre pagina e riga (es. "pagina 2, righe 14-17").`
          : buildSystemPrompt(hits);

        // 2) Stream the answer from the configured AI provider (default: ChatGPT)
        const modelMessages: ModelMessage[] = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));
        const provider = getAiProvider();

        const result = streamText({
          model: provider.chatModel(),
          system: systemPrompt,
          messages: modelMessages,
          ...(provider.chatProviderOptions
            ? { providerOptions: provider.chatProviderOptions }
            : {}),
          onFinish: async ({ text }) => {
            try {
              // Keep only the sources the model declared as actually used.
              const { clean, used } = parseUsedSources(text);
              const usedSources = filterUsed(sources, used);
              const usedReliability =
                used === null
                  ? reliability
                  : estimateReliability(hits.filter((_, i) => used.includes(i + 1)));
              const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
                auth: { persistSession: false, autoRefreshToken: false },
              });
              await admin.from("chat_messages").insert({
                thread_id: threadId,
                role: "assistant",
                content: clean,
                sources:
                  usedSources as unknown as Database["public"]["Tables"]["chat_messages"]["Insert"]["sources"],
                reliability: usedReliability.label,
                reliability_score: usedReliability.score,
              });
              await admin
                .from("chat_threads")
                .update({ updated_at: new Date().toISOString() })
                .eq("id", threadId);
            } catch (err) {
              console.error("Persist assistant message failed", err);
            }
          },
        });

        return result.toTextStreamResponse({
          headers: {
            "X-Caf-Sources": encodeURIComponent(JSON.stringify(sources)),
            "X-Caf-Reliability": encodeURIComponent(JSON.stringify(reliability)),
            "Access-Control-Expose-Headers": "X-Caf-Sources, X-Caf-Reliability",
          },
        });
      },
    },
  },
});
