import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { listUsers, setUserStatus } from "@/lib/users.functions";
import {
  ingestDocument,
  deleteDocument,
  ARCHIVE_CATEGORIES,
  type ArchiveCategory,
} from "@/lib/documents.functions";
import {
  ArrowLeft,
  Users,
  FileText,
  UploadCloud,
  Check,
  X,
  Trash2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
});

type Tab = "users" | "docs";

function AdminPage() {
  const { isAdmin, loading } = useAuth();
  const [tab, setTab] = useState<Tab>("users");

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="flex-1 p-8">
        <p className="text-muted-foreground">Accesso riservato agli amministratori.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto w-full px-6 py-6">
        <Link
          to="/chat"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> Torna alla chat
        </Link>
        <h1 className="text-2xl font-semibold mb-6">Amministrazione</h1>

        <div className="flex gap-2 border-b border-border mb-6">
          <TabBtn active={tab === "users"} onClick={() => setTab("users")}>
            <Users className="h-4 w-4" /> Utenti
          </TabBtn>
          <TabBtn active={tab === "docs"} onClick={() => setTab("docs")}>
            <FileText className="h-4 w-4" /> Archivio AI
          </TabBtn>
        </div>

        {tab === "users" ? <UsersTab /> : <DocsTab />}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/* ---------------- USERS ---------------- */

type UserRow = {
  id: string;
  email: string;
  full_name: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

function UsersTab() {
  const fetchUsers = useServerFn(listUsers);
  const updateStatus = useServerFn(setUserStatus);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const data = await fetchUsers();
      setRows(data as UserRow[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function change(id: string, status: UserRow["status"]) {
    try {
      await updateStatus({ data: { user_id: id, status } });
      toast.success("Aggiornato");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    }
  }

  if (loading) return <Loader2 className="h-6 w-6 animate-spin text-primary" />;

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-3">Utente</th>
            <th className="text-left px-4 py-3">Stato</th>
            <th className="text-right px-4 py-3">Azioni</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id} className="border-t border-border">
              <td className="px-4 py-3">
                <div className="font-medium">{u.full_name || u.email}</div>
                <div className="text-xs text-muted-foreground">{u.email}</div>
              </td>
              <td className="px-4 py-3">
                <StatusPill status={u.status} />
              </td>
              <td className="px-4 py-3 text-right">
                <div className="inline-flex gap-1.5">
                  {u.status !== "approved" && (
                    <button
                      onClick={() => change(u.id, "approved")}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-success/15 text-success border border-success/30 hover:bg-success/25"
                    >
                      <Check className="h-3.5 w-3.5" /> Approva
                    </button>
                  )}
                  {u.status !== "rejected" && (
                    <button
                      onClick={() => change(u.id, "rejected")}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-destructive/15 text-destructive border border-destructive/30 hover:bg-destructive/25"
                    >
                      <X className="h-3.5 w-3.5" /> Rifiuta
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ status }: { status: UserRow["status"] }) {
  const map = {
    approved: "bg-success/15 text-success border-success/30",
    pending: "bg-warning/15 text-warning border-warning/30",
    rejected: "bg-destructive/15 text-destructive border-destructive/30",
  };
  const label = { approved: "Approvato", pending: "In attesa", rejected: "Rifiutato" };
  return (
    <span
      className={`text-xs px-2 py-1 rounded-md border ${map[status]}`}
    >
      {label[status]}
    </span>
  );
}

/* ---------------- DOCS ---------------- */

type Doc = {
  id: string;
  title: string;
  filename: string;
  doc_type: string;
  categoria: string;
  page_count: number | null;
  status: string;
  created_at: string;
};

function DocsTab() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<ArchiveCategory>("circolari");
  const deleteFn = useServerFn(deleteDocument);

  async function refresh() {
    setLoading(true);
    const { data } = await supabase
      .from("documents")
      .select("id,title,filename,doc_type,categoria,page_count,status,created_at")
      .order("created_at", { ascending: false });
    setDocs((data as Doc[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleDelete(id: string) {
    if (!confirm("Eliminare questo documento? L'operazione è irreversibile.")) return;
    try {
      await deleteFn({ data: { id } });
      toast.success("Documento eliminato");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    }
  }

  return (
    <div className="space-y-6">
      <UploadCard category={category} setCategory={setCategory} onDone={refresh} />

      <div>
        <div className="text-sm font-medium text-muted-foreground mb-2">
          Documenti indicizzati ({docs.length})
        </div>
        {loading ? (
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        ) : docs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground text-sm">
            Nessun documento ancora caricato.
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3">Documento</th>
                  <th className="text-left px-4 py-3">Categoria</th>
                  <th className="text-left px-4 py-3">Pagine</th>
                  <th className="text-right px-4 py-3">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <div className="font-medium">{d.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {d.filename} · {d.doc_type.toUpperCase()}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">{d.categoria}</td>
                    <td className="px-4 py-3 text-xs">{d.page_count ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(d.id)}
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-destructive/15 text-destructive border border-destructive/30 hover:bg-destructive/25"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Elimina
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function UploadCard({
  category,
  setCategory,
  onDone,
}: {
  category: ArchiveCategory;
  setCategory: (c: ArchiveCategory) => void;
  onDone: () => void;
}) {
  const ingest = useServerFn(ingestDocument);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");

  async function handleUpload() {
    if (!file) return toast.error("Seleziona un file");
    const isPdf = file.name.toLowerCase().endsWith(".pdf");
    const isMd = file.name.toLowerCase().endsWith(".md");
    if (!isPdf && !isMd) return toast.error("Formati supportati: PDF, MD");

    setBusy(true);
    try {
      // 1) Extract text client-side
      setProgress("Estrazione del testo…");
      const { chunks, pageCount } = await extractFile(file, (p, total) =>
        setProgress(`Estrazione pagina ${p} di ${total}…`),
      );

      if (chunks.length === 0) throw new Error("Nessun testo estratto dal file");

      // 2) Upload raw file to storage bucket
      setProgress("Caricamento file…");
      const path = `archivio_ai/${category}/${Date.now()}-${sanitize(file.name)}`;
      const { error: upErr } = await supabase.storage
        .from("documents")
        .upload(path, file, {
          contentType: isPdf ? "application/pdf" : "text/markdown",
          upsert: false,
        });
      if (upErr) throw upErr;

      // 3) Persist metadata + chunks via server fn
      setProgress("Indicizzazione…");
      await ingest({
        data: {
          title: title.trim() || file.name.replace(/\.(pdf|md)$/i, ""),
          filename: file.name,
          categoria: category,
          doc_type: isPdf ? "pdf" : "markdown",
          storage_path: path,
          page_count: pageCount,
          chunks,
        },
      });

      toast.success("Documento indicizzato");
      setFile(null);
      setTitle("");
      setProgress("");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore caricamento");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <UploadCloud className="h-4 w-4 text-primary" />
        Aggiungi documento all'archivio_ai
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs text-muted-foreground">Categoria</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ArchiveCategory)}
            className="mt-1 w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm"
          >
            {ARCHIVE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Titolo (opzionale)</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm"
            placeholder="Es. Circolare INPS n. 12/2026"
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground">File (PDF o MD)</label>
        <input
          type="file"
          accept=".pdf,.md,application/pdf,text/markdown"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:cursor-pointer"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleUpload}
          disabled={busy || !file}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          Carica e indicizza
        </button>
        {busy && progress && (
          <span className="text-xs text-muted-foreground">{progress}</span>
        )}
      </div>
    </div>
  );
}

/* ---------------- Parsing helpers ----------------
 * The extraction logic (page + line numbers) lives in src/lib/pdf-extract.ts
 * and is shared with the "Analizza documento" page.
 */
