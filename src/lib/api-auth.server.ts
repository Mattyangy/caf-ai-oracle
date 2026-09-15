/**
 * Shared bearer-token authentication for the HTTP API routes
 * (/api/chat, /api/circolari-search, /api/analizza).
 *
 * Returns the authenticated user id when the caller has an approved profile,
 * otherwise a ready-to-return Response.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type AuthResult =
  | { ok: true; userId: string; supabase: ReturnType<typeof createClient<Database>> }
  | { ok: false; response: Response };

export async function requireApprovedUser(request: Request): Promise<AuthResult> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { ok: false, response: new Response("Unauthorized", { status: 401 }) };

  const supabase = createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );

  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData.user) {
    return { ok: false, response: new Response("Unauthorized", { status: 401 }) };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("status")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!profile || profile.status !== "approved") {
    return {
      ok: false,
      response: new Response("Account non ancora approvato.", { status: 403 }),
    };
  }

  return { ok: true, userId: userData.user.id, supabase };
}
