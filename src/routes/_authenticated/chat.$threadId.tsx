import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/chat/$threadId")({
  component: () => (
    <div className="flex-1 flex items-center justify-center p-8 text-muted-foreground">
      Vista conversazione — in costruzione. Torna alla lista dalla sidebar.
    </div>
  ),
});
