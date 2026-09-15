import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api, apiErrorMessage } from "@/lib/api";
import { platformOf } from "@/lib/platforms";
import { FORMAT_LABEL } from "@/lib/platformSpecs";
import { STATUS_META, FORMAT_ICON, projectSummary } from "@/lib/projects";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Plus, Search, Trash2, CheckSquare, Circle, X, Loader2, FolderOpen,
} from "lucide-react";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
];

// Every draft, every scheduled post, everything already published — one
// place to find any of them again. This used to only half-exist: Home
// showed the four most recent drafts and the four soonest scheduled posts,
// and nothing at all listed what had shipped. Same data (posts is already a
// full CRUD resource with drafts, schedule and history all in one row shape)
// — just no page that actually browsed all of it.
export default function Projects() {
  const navigate = useNavigate();
  // Dashboard's "All" links land here with a status preset (?status=draft)
  // rather than a separate route per status — one page, one filter state,
  // just seeded differently depending on how you arrived.
  const presetStatus = new URLSearchParams(useLocation().search).get("status");
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(FILTERS.some((f) => f.key === presetStatus) ? presetStatus : "all");
  const [search, setSearch] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  const load = useCallback(() => {
    setLoading(true);
    return api.get("/posts")
      .then(({ data }) => setPosts(data))
      .catch((e) => toast.error(apiErrorMessage(e, "Couldn't load your projects.")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({
    all: posts.length,
    draft: posts.filter((p) => p.status === "draft").length,
    scheduled: posts.filter((p) => p.status === "scheduled").length,
    published: posts.filter((p) => p.status === "published").length,
  }), [posts]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return posts
      .filter((p) => filter === "all" || p.status === filter)
      .filter((p) => !q || (p.title || "").toLowerCase().includes(q) || (p.content || "").toLowerCase().includes(q));
  }, [posts, filter, search]);

  const openProject = (p) => navigate("/composer", { state: { start: { from: "post", value: p.id } } });

  const toggleSelectMode = () => { setSelectMode((s) => !s); setSelected(new Set()); };
  const toggleSelected = (id) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const selectAllVisible = () => setSelected(new Set(visible.map((p) => p.id)));

  const removeOne = async (p) => {
    if (!window.confirm(`Delete "${p.title}"? This can't be undone.`)) return;
    const prev = posts;
    setPosts((s) => s.filter((x) => x.id !== p.id));
    try { await api.delete(`/posts/${p.id}`); toast.success("Deleted"); }
    catch (e) { toast.error(apiErrorMessage(e, "Delete failed.")); setPosts(prev); }
  };

  const removeSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} project${ids.length === 1 ? "" : "s"}? This can't be undone.`)) return;
    const prev = posts;
    setPosts((s) => s.filter((p) => !selected.has(p.id)));
    setSelectMode(false); setSelected(new Set());
    try {
      await api.post("/posts/bulk-delete", { ids });
      toast.success(`Deleted ${ids.length} project${ids.length === 1 ? "" : "s"}`);
    } catch (e) { toast.error(apiErrorMessage(e, "Delete failed.")); setPosts(prev); }
  };

  return (
    <div data-testid="projects-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">Projects</div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight sm:text-5xl">Everything you've built</h1>
        </div>
        <Button onClick={() => navigate("/composer")} data-testid="projects-new"
          className="h-11 gap-2 rounded-xl bg-lime px-5 font-semibold text-[#0A0A0A] hover:bg-lime-hover">
          <Plus size={18} /> New post
        </Button>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} data-testid={`projects-filter-${f.key}`}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${filter === f.key ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
            {f.label} <span className="text-zinc-600">({counts[f.key]})</span>
          </button>
        ))}
        <div className="relative ml-auto min-w-[160px] flex-1 sm:flex-none sm:w-64">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects…"
            data-testid="projects-search"
            className="w-full rounded-lg border border-white/10 bg-[#0A0A0A] py-2 pl-8 pr-3 text-sm text-white outline-none focus:border-lime placeholder:text-zinc-600" />
        </div>
        {posts.length > 0 && (
          selectMode ? (
            <>
              <button onClick={selectAllVisible} data-testid="projects-select-all"
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-400 hover:text-white">Select all</button>
              <Button onClick={removeSelected} disabled={selected.size === 0} data-testid="projects-delete-selected"
                className="gap-1.5 rounded-lg bg-magic text-xs font-semibold text-white hover:bg-magic/90 disabled:opacity-40">
                <Trash2 size={13} /> Delete {selected.size > 0 ? `(${selected.size})` : ""}
              </Button>
              <Button variant="secondary" onClick={toggleSelectMode} data-testid="projects-select-cancel"
                className="gap-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-white hover:bg-white/10">
                <X size={13} /> Cancel
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={toggleSelectMode} data-testid="projects-select-mode"
              className="gap-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-white hover:bg-white/10">
              <CheckSquare size={13} /> Select
            </Button>
          )
        )}
      </div>

      {loading && <div className="mt-16 flex justify-center"><Loader2 className="animate-spin text-zinc-600" /></div>}

      {!loading && visible.length === 0 && (
        <div className="mt-10 flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 text-center">
          <FolderOpen size={28} className="text-zinc-700" />
          <p className="text-sm text-zinc-500">
            {posts.length === 0 ? "Nothing built yet." : "Nothing matches that."}
          </p>
          {posts.length === 0 && (
            <Button onClick={() => navigate("/composer")} data-testid="projects-empty-new"
              className="mt-2 gap-1.5 rounded-lg bg-lime text-xs font-semibold text-[#0A0A0A] hover:bg-lime-hover">
              <Plus size={14} /> Start one
            </Button>
          )}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="projects-list">
        {visible.map((p) => {
          const isSelected = selected.has(p.id);
          const status = STATUS_META[p.status] || STATUS_META.draft;
          const FormatIcon = FORMAT_ICON[p.format] || FORMAT_ICON.single;
          const thumb = p.media_urls?.[0] || p.assets?.[0]?.spec?.image_url || p.assets?.[0]?.spec?.video_url || "";
          const when = p.status === "scheduled" && p.scheduled_time
            ? new Date(p.scheduled_time).toLocaleString()
            : new Date(p.updated_at || p.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
          return (
            <div key={p.id} data-testid={`project-card-${p.id}`}
              onClick={() => (selectMode ? toggleSelected(p.id) : openProject(p))}
              className={`group flex cursor-pointer gap-3 rounded-xl border bg-[#121212] p-3 text-left transition-colors hover:border-white/20 ${isSelected ? "border-lime" : "border-white/10"}`}>
              <div className="relative flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-lg bg-[#0A0A0A]">
                {thumb ? (
                  <img src={thumb} alt="" className="h-full w-full object-cover" />
                ) : (
                  <FormatIcon size={20} className="text-zinc-600" />
                )}
                {selectMode && (
                  <span className={`absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded ${isSelected ? "bg-lime text-[#0A0A0A]" : "bg-black/60 text-white"}`}>
                    {isSelected ? <CheckSquare size={11} /> : <Circle size={11} />}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] ${status.badgeClassName}`}>
                    {status.label}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-zinc-600">{FORMAT_LABEL[p.format] || p.format}</span>
                </div>
                <div className="mt-1.5 line-clamp-2 text-sm text-zinc-200">{projectSummary(p)}</div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex gap-1">
                    {(p.platforms || []).slice(0, 4).map((pk) => {
                      const P = platformOf(pk); const I = P.icon;
                      return <I key={pk} size={11} style={{ color: P.color }} />;
                    })}
                  </div>
                  <span className="font-mono text-[10px] text-zinc-600">{when}</span>
                </div>
              </div>
              {!selectMode && (
                // Always visible, not hover-revealed — hover-only affordances
                // don't exist on a touch screen, which is most real use here.
                <button onClick={(e) => { e.stopPropagation(); removeOne(p); }} data-testid={`project-delete-${p.id}`}
                  className="flex-none self-start text-zinc-600 transition-colors hover:text-magic">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
