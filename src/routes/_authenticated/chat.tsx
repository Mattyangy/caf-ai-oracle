import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CafAiLogo } from "@/components/CafAiLogo";
import { useAuth } from "@/hooks/useAuth";
import {
  MessageSquarePlus,
  Settings,
  LogOut,
  Loader2,
  MoreVertical,
  Pencil,
  Trash2,
  Search,
  ShieldCheck,
  Menu,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/chat")({
  component: ChatLayout,
});

type Thread = { id: string; title: string; updated_at: string };

function ChatLayout() {
  const { user, profile, isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  const { data: threads = [] } = useQuery({
    queryKey: ["threads", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_threads")
        .select("id,title,updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as Thread[];
    },
  });

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/auth" });
    else if (profile && profile.status !== "approved") {
      // stay in layout but render pending banner via component below
    }
  }, [loading, user, profile, navigate]);

  async function handleLogout() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  async function handleNewChat() {
    if (!user) return;
    const { data, error } = await supabase
      .from("chat_threads")
      .insert({ user_id: user.id, title: "Nuova conversazione" })
      .select("id")
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["threads"] });
    setSidebarOpen(false);
    navigate({ to: "/chat/$threadId", params: { threadId: data.id } });
  }

  async function renameThread(id: string, currentTitle: string) {
    const next = prompt("Nuovo nome:", currentTitle);
    if (!next || next.trim() === "") return;
    await supabase.from("chat_threads").update({ title: next.trim() }).eq("id", id);
    queryClient.invalidateQueries({ queryKey: ["threads"] });
  }

  async function deleteThread(id: string) {
    if (!confirm("Eliminare questa conversazione?")) return;
    await supabase.from("chat_threads").delete().eq("id", id);
    queryClient.invalidateQueries({ queryKey: ["threads"] });
    if (pathname.includes(id)) navigate({ to: "/chat" });
  }

  const filtered = threads.filter((t) =>
    t.title.toLowerCase().includes(search.toLowerCase()),
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen h-screen flex bg-background overflow-hidden">
      {/* Mobile toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="lg:hidden fixed top-3 left-3 z-50 p-2 rounded-lg bg-surface border border-border"
        aria-label="Menu"
      >
        {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Sidebar */}
      <aside
        className={`fixed lg:relative z-40 h-full w-72 bg-sidebar border-r border-sidebar-border flex flex-col transition-transform duration-200 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="p-4 border-b border-sidebar-border">
          <CafAiLogo />
        </div>

        <div className="p-3 space-y-2">
          <button
            onClick={handleNewChat}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition"
          >
            <MessageSquarePlus className="h-4 w-4" />
            Nuova chat
          </button>

          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca conversazioni…"
              className="w-full pl-8 pr-3 py-2 rounded-lg bg-sidebar-accent border border-sidebar-border text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-2">
          <div className="text-xs font-medium text-muted-foreground px-2 py-2 uppercase tracking-wider">
            Cronologia
          </div>
          {filtered.length === 0 && (
            <div className="text-sm text-muted-foreground px-3 py-2">Nessuna conversazione.</div>
          )}
          {filtered.map((t) => (
            <ThreadRow
              key={t.id}
              thread={t}
              active={pathname.includes(t.id)}
              onOpen={() => {
                setSidebarOpen(false);
                navigate({ to: "/chat/$threadId", params: { threadId: t.id } });
              }}
              onRename={() => renameThread(t.id, t.title)}
              onDelete={() => deleteThread(t.id)}
            />
          ))}
        </div>

        <div className="border-t border-sidebar-border p-2 space-y-1">
          {isAdmin && (
            <Link
              to="/admin"
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent transition text-sm"
            >
              <ShieldCheck className="h-4 w-4" />
              Amministrazione
            </Link>
          )}
          <Link
            to="/settings"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent transition text-sm"
          >
            <Settings className="h-4 w-4" />
            Impostazioni
          </Link>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent transition text-sm"
          >
            <LogOut className="h-4 w-4" />
            Esci
          </button>
          <div className="px-3 py-2 text-xs text-muted-foreground truncate">
            {profile?.email}
          </div>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="lg:hidden fixed inset-0 z-30 bg-black/50"
        />
      )}

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {profile && profile.status !== "approved" ? (
          <div className="flex-1 flex items-center justify-center px-6">
            <div className="max-w-md text-center">
              <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-warning/20 flex items-center justify-center">
                <ShieldCheck className="h-7 w-7 text-warning" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                Account in attesa di approvazione
              </h2>
              <p className="text-sm text-muted-foreground">
                Il tuo accesso deve essere approvato da un amministratore prima di poter usare CAF AI.
              </p>
            </div>
          </div>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}

function ThreadRow({
  thread,
  active,
  onOpen,
  onRename,
  onDelete,
}: {
  thread: Thread;
  active: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className={`group relative flex items-center rounded-lg text-sm transition ${
        active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60"
      }`}
    >
      <button
        onClick={onOpen}
        className="flex-1 text-left px-3 py-2 truncate text-sidebar-foreground"
      >
        {thread.title}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen(!menuOpen);
        }}
        className="opacity-0 group-hover:opacity-100 lg:group-hover:opacity-100 p-1.5 mr-1 rounded hover:bg-sidebar-border"
        aria-label="Azioni"
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-1 top-9 z-50 bg-popover border border-border rounded-lg shadow-lg p-1 w-40">
            <button
              onClick={() => {
                setMenuOpen(false);
                onRename();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-sm hover:bg-secondary"
            >
              <Pencil className="h-3.5 w-3.5" /> Rinomina
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-sm hover:bg-destructive/20 text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" /> Elimina
            </button>
          </div>
        </>
      )}
    </div>
  );
}
