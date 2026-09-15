import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "CAF AI — Assistente per CAF e Patronato" },
      {
        name: "description",
        content:
          "CAF AI è l'assistente intelligente per operatori di CAF e Patronato: risposte fiscali e previdenziali basate sulle circolari del tuo archivio.",
      },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "CAF AI — Assistente per CAF e Patronato" },
      {
        property: "og:description",
        content:
          "Assistente AI per operatori CAF e Patronato, con ricerca prioritaria nelle circolari caricate e riferimenti a pagina e documento.",
      },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HomeRedirect,
});

function HomeRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      navigate({ to: data.user ? "/chat" : "/auth", replace: true });
    });
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}
