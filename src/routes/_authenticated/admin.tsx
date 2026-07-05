import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  component: () => (
    <div className="flex-1 p-8 overflow-y-auto">
      <Link to="/chat" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-4 w-4" /> Torna alla chat
      </Link>
      <h1 className="text-2xl font-semibold mb-4">Amministrazione</h1>
      <p className="text-muted-foreground">Pannello admin — in costruzione (utenti, documenti, audit).</p>
    </div>
  ),
});
