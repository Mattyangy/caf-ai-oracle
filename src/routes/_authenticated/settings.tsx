import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/settings")({
  component: () => (
    <div className="flex-1 p-8 overflow-y-auto">
      <h1 className="text-2xl font-semibold mb-4">Impostazioni</h1>
      <p className="text-muted-foreground">In costruzione.</p>
    </div>
  ),
});
