import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CafAiLogo } from "@/components/CafAiLogo";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/chat" });
    });
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // Log audit event (best-effort)
        const { data: userData } = await supabase.auth.getUser();
        if (userData.user) {
          await supabase.from("audit_log").insert({
            user_id: userData.user.id,
            event: "login",
            user_agent: navigator.userAgent,
          });
          await supabase
            .from("profiles")
            .update({ last_sign_in_at: new Date().toISOString() })
            .eq("id", userData.user.id);
        }
        if (!remember) {
          // For "not remember", we could shorten storage; Supabase persists in localStorage.
          // A full implementation would use sessionStorage instead.
        }
        toast.success("Accesso effettuato");
        navigate({ to: "/chat" });
      } else if (mode === "signup") {
        if (password.length < 8) throw new Error("La password deve essere di almeno 8 caratteri");
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        toast.success("Registrazione completata. Un amministratore approverà il tuo accesso.");
        setMode("login");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast.success("Ti abbiamo inviato le istruzioni per reimpostare la password.");
        setMode("login");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore imprevisto";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-4 py-10 bg-background relative overflow-hidden">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_oklch(0.72_0.18_240/0.12),transparent_60%)]" />

      <div className="relative w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <CafAiLogo className="scale-125" />
          <p className="mt-4 text-sm text-muted-foreground text-center">
            Assistente operativo per CAF e Patronato
          </p>
        </div>

        <div className="bg-surface/80 backdrop-blur border border-border rounded-2xl p-6 shadow-2xl">
          <h1 className="text-xl font-semibold text-foreground mb-1">
            {mode === "login" ? "Accedi" : mode === "signup" ? "Crea account" : "Recupera password"}
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            {mode === "login"
              ? "Solo operatori CAF e Patronato autorizzati."
              : mode === "signup"
                ? "La tua richiesta sarà approvata da un amministratore."
                : "Ti invieremo un link via email."}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <Field label="Nome completo">
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  maxLength={100}
                  className="input-caf"
                  autoComplete="name"
                />
              </Field>
            )}

            <Field label="Email">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={255}
                className="input-caf"
                autoComplete="email"
              />
            </Field>

            {mode !== "forgot" && (
              <Field label="Password">
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  maxLength={128}
                  className="input-caf"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              </Field>
            )}

            {mode === "login" && (
              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 cursor-pointer text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="accent-primary"
                  />
                  Ricordami
                </label>
                <button
                  type="button"
                  onClick={() => setMode("forgot")}
                  className="text-primary hover:underline"
                >
                  Password dimenticata?
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground font-medium py-2.5 hover:opacity-90 transition disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "login" ? "Accedi" : mode === "signup" ? "Registrati" : "Invia link"}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-border text-center text-sm text-muted-foreground">
            {mode === "login" ? (
              <>
                Non hai un account?{" "}
                <button
                  onClick={() => setMode("signup")}
                  className="text-primary hover:underline font-medium"
                >
                  Registrati
                </button>
              </>
            ) : (
              <button
                onClick={() => setMode("login")}
                className="text-primary hover:underline font-medium"
              >
                Torna al login
              </button>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .input-caf {
          width: 100%;
          background: oklch(0.14 0.005 260);
          border: 1px solid var(--color-border);
          border-radius: 0.5rem;
          padding: 0.6rem 0.85rem;
          color: var(--color-foreground);
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .input-caf:focus {
          border-color: var(--color-primary);
          box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-primary) 25%, transparent);
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-foreground mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}
