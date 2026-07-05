import { createFileRoute } from "@tanstack/react-router";
import logoAsset from "@/assets/caf-ai-logo.jpg.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CAF AI" },
      { name: "description", content: "CAF AI — assistente operativo per CAF e Patronato." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 text-center">
      <img
        src={logoAsset.url}
        alt="CAF AI"
        className="w-64 max-w-full h-auto drop-shadow-2xl"
      />
      <h1 className="text-4xl font-semibold tracking-tight text-foreground">
        CAF AI
      </h1>
      <p className="max-w-md text-muted-foreground">
        Assistente operativo per CAF e Patronato.
      </p>
    </div>
  );
}
