import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CafAiLogo } from "@/components/CafAiLogo";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Supabase places a recovery token in the URL hash; the client parses it
    // automatically and emits a PASSWORD_RECOVERY event. We just wait until a
    // session exists (either from the hash or a previous one).
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("La password deve essere di almeno 8 caratteri");
      return;
    }
    if (password !== confirm) {
      toast.error("Le password non coincidono");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password aggiornata. Ora puoi accedere.");
      await supabase.auth.signOut();
      navigate({ to: "/auth" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore imprevisto");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-4 py-10 bg-background relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_oklch(0.72_0.18_240/0.12),transparent_60%)]" />
      <div className="relative w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <CafAiLogo className="scale-125" />
          <p className="mt-4 text-sm text-muted-foreground text-center">
            Imposta una nuova password
          </p>
        </div>

        <div className="bg-surface/80 backdrop-blur border border-border rounded-2xl p-6 shadow-2xl">
          {!ready ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Verifica del link in corso…
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-foreground mb-1.5 block">
                  Nuova password
                </span>
                <input
                  type="password"
                  required
                  minLength={8}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-[oklch(0.14_0.005_260)] border border-border rounded-lg px-3.5 py-2.5 outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
                  autoComplete="new-password"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-foreground mb-1.5 block">
                  Conferma password
                </span>
                <input
                  type="password"
                  required
                  minLength={8}
                  maxLength={128}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full bg-[oklch(0.14_0.005_260)] border border-border rounded-lg px-3.5 py-2.5 outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
                  autoComplete="new-password"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground font-medium py-2.5 hover:opacity-90 transition disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Aggiorna password
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
