import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "@/lib/api";
import { FORMAT_LABEL } from "@/lib/platformSpecs";
import { STATUS_META, projectSummary } from "@/lib/projects";
import { toast } from "sonner";
import { Search, Loader2, FolderOpen, Send } from "lucide-react";

// "Open project" as a fifth way to start — the other four (Topic/Source/
// Visual/Batch) all write something new; this is the one that picks up
// something already in progress without first leaving the Composer for
// Projects. Reopening reuses the exact mechanism Projects, Home's draft
// rows and History's "Use" already do — navigate("/composer", {state:
// {start:{from:"post", value:id}}}) — location.key changes on every
// navigate call even to the same path, so Composer's own start-intent
// effect re-fires and reloads, whether or not it was already open.
export function ComposerProjectPanel() {
  const navigate = useNavigate();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.get("/posts")
      .then(({ data }) => setPosts(data))
      .catch((e) => toast.error(apiErrorMessage(e, "Couldn't load your projects.")))
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return posts.slice(0, 12);
    return posts
      .filter((p) => (p.title || "").toLowerCase().includes(q) || (p.content || "").toLowerCase().includes(q))
      .slice(0, 12);
  }, [posts, search]);

  const open = (p) => navigate("/composer", { state: { start: { from: "post", value: p.id } } });

  return (
    <div data-testid="composer-project-panel">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your projects…"
          data-testid="composer-project-search"
          className="w-full rounded-lg border border-white/10 bg-[#121212] py-2 pl-8 pr-3 text-sm text-white outline-none focus:border-lime placeholder:text-zinc-600" />
      </div>

      {loading && <div className="mt-6 flex justify-center"><Loader2 className="animate-spin text-zinc-600" /></div>}

      {!loading && visible.length === 0 && (
        <div className="mt-6 flex min-h-[100px] flex-col items-center justify-center gap-1 text-center text-sm text-zinc-600">
          <FolderOpen size={20} className="text-zinc-700" />
          <span>{posts.length === 0 ? "Nothing built yet." : "Nothing matches that."}</span>
        </div>
      )}

      <div className="mt-3 space-y-1.5" data-testid="composer-project-list">
        {visible.map((p) => {
          const status = STATUS_META[p.status] || STATUS_META.draft;
          return (
            <button key={p.id} onClick={() => open(p)} data-testid={`composer-project-row-${p.id}`}
              className="flex w-full items-center gap-2.5 rounded-lg border border-white/10 bg-[#121212] p-2.5 text-left transition-colors hover:border-white/20">
              <span className={`h-1.5 w-1.5 flex-none rounded-full ${status.dotClassName}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-zinc-200">{projectSummary(p)}</div>
                <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-zinc-600">
                  {status.label} · {FORMAT_LABEL[p.format] || p.format}
                </div>
              </div>
              <Send size={13} className="flex-none text-zinc-600" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
