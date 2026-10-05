import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  HomeComposer,
  WelcomeHeader,
  docsToTranscript,
  useAiEngine,
  attachKey,
  type AttachedDoc,
} from "@/components/HomeComposer";

export const Route = createFileRoute("/_authenticated/chat/")({
  validateSearch: (search: Record<string, unknown>) => ({
    n: typeof search.n === "number" ? search.n : 0,
  }),
  component: ChatHome,
});

const SUGGESTIONS = [
  "Come si calcola l'ISEE 2026 per un nucleo con un figlio disabile?",
  "Quali documenti servono per la domanda di invalidità civile?",
  "Come funziona il Bonus Asilo Nido quest'anno?",
  "Requisiti per l'Assegno di Inclusione (ADI) 2026?",
];

function ChatHome() {
  // Remount on every "Nuova chat" click so draft text and attachments reset.
  const { n } = Route.useSearch();
  return <ChatHomeInner key={n} />;
}

function ChatHomeInner() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [docs, setDocs] = useState<AttachedDoc[]>([]);
  const [engine, setEngine] = useAiEngine();

  async function submit(question: string) {
    if (!user || busy) return;
    setBusy(true);
    const attached = docs;
    try {
      const title = question.slice(0, 60) + (question.length > 60 ? "…" : "");
      const { data: thread, error } = await supabase
        .from("chat_threads")
        .insert({ user_id: user.id, title })
        .select("id")
        .single();
      if (error) throw error;

      await supabase.from("chat_messages").insert({
        thread_id: thread.id,
        role: "user",
        content: question,
      });

      if (attached.length > 0) {
        sessionStorage.setItem(
          attachKey(thread.id),
          JSON.stringify({
            names: attached.map((d) => d.name),
            transcript: docsToTranscript(attached),
          }),
        );
      }

      navigate({
        to: "/chat/$threadId",
        params: { threadId: thread.id },
        search: { auto: "1" } as never,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    } finally {
      setBusy(false);
    }
  }

  const firstName = profile?.full_name?.split(" ")[0] || "";

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-10 overflow-y-auto">
      <div className="w-full max-w-2xl">
        <HomeComposer
          autoFocus
          header={
            <WelcomeHeader
              icon={<Sparkles className="h-7 w-7 text-primary" />}
              title={
                <>
                  Ciao {firstName} <span className="inline-block animate-wave">👋</span>
                </>
              }
            >
              Sono <span className="text-primary font-medium">CAF AI</span>, il tuo assistente
              operativo. Scrivi la tua domanda: cercherò tra circolari, normativa, FAQ e casi
              risolti. Puoi anche allegare documenti con la graffetta e scegliere tra ChatGPT e
              Gemini.
            </WelcomeHeader>
          }
          placeholder="Scrivi la tua domanda…"
          suggestions={SUGGESTIONS}
          busy={busy}
          docs={docs}
          onDocsChange={setDocs}
          engine={engine}
          onEngineChange={setEngine}
          onSubmit={submit}
        />
      </div>

      <style>{`
        @keyframes wave { 0%,60%,100% { transform: rotate(0); } 10%,30% { transform: rotate(14deg); } 20% { transform: rotate(-8deg); } 40%,50% { transform: rotate(14deg); } }
        .animate-wave { animation: wave 2.4s ease-in-out infinite; transform-origin: 70% 70%; display: inline-block; }
      `}</style>
    </div>
  );
}
