import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "@/lib/api";
import { onOpenHistory } from "@/lib/historyBus";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  History, Loader2, Trash2, Star, Pencil, Send, Check, X, RefreshCw,
  Image as ImageIcon, Video, Music, Mic, Lightbulb, PenLine, Repeat, Flame,
  GraduationCap, Shapes, LayoutTemplate,
} from "lucide-react";

const KIND_META = {
  ideate: { label: "Ideas", icon: Lightbulb },
  write: { label: "Copy", icon: PenLine },
  repurpose: { label: "Repurpose", icon: Repeat },
  templates: { label: "Templates", icon: Flame },
  coach: { label: "Coach", icon: GraduationCap },
  visual: { label: "Visual", icon: Shapes },
  post_plan: { label: "Post plan", icon: LayoutTemplate },
  image: { label: "Image", icon: ImageIcon },
  video: { label: "Video", icon: Video },
  music: { label: "Music", icon: Music },
  voice: { label: "Voice", icon: Mic },
};

const FILTERS = [
  { key: "all", label: "All", params: {} },
  { key: "text", label: "Copy", params: { group: "text" } },
  { key: "media", label: "Media", params: { group: "media" } },
  { key: "plans", label: "Plans", params: { kind: "post_plan" } },
  { key: "saved", label: "Saved", params: { favorite: true } },
];

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const fileUrl = (g) => (g.files || []).find((f) => f.file_url)?.file_url || "";

export function HistoryDrawer() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(async (key) => {
    setLoading(true);
    try {
      const f = FILTERS.find((x) => x.key === key) || FILTERS[0];
      const { data } = await api.get("/generations", { params: { ...f.params, limit: 80 } });
      setItems(data);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't load history."));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => onOpenHistory((f) => {
    const key = FILTERS.some((x) => x.key === f) ? f : "all";
    setFilter(key); setOpen(true); load(key);
  }), [load]);

  useEffect(() => { if (open) load(filter); }, [filter, open, load]);

  const remove = async (id) => {
    setItems((s) => s.filter((x) => x.id !== id));
    try { await api.delete(`/generations/${id}`); toast.success("Deleted"); }
    catch (e) { toast.error(apiErrorMessage(e, "Delete failed.")); load(filter); }
  };

  const patch = async (id, body) => {
    try {
      const { data } = await api.put(`/generations/${id}`, body);
      setItems((s) => s.map((x) => (x.id === id ? data : x)));
      return data;
    } catch (e) { toast.error(apiErrorMessage(e, "Save failed.")); }
  };

  const saveEdit = async (g) => {
    await patch(g.id, { output: draft });
    setEditing(null);
    toast.success("Saved");
  };

  // Every kind knows how to become a post — that is the whole point of keeping
  // the history around.
  const sendToComposer = (g) => {
    const out = parse(g.output);
    setOpen(false);
    if (g.kind === "post_plan" && out) {
      navigate("/composer", { state: { plan: out } });
    } else if (g.kind === "write") {
      navigate("/composer", { state: { content: g.output || "" } });
    } else if (g.kind === "ideate" && out?.ideas?.length) {
      navigate("/composer", { state: { brief: out.ideas[0] } });
    } else if (g.kind === "repurpose" && out) {
      const [platform, text] = Object.entries(out)[0] || [];
      navigate("/composer", { state: { content: text || "", platforms: platform ? [platform] : undefined } });
    } else if (g.kind === "templates" && out?.posts?.length) {
      navigate("/composer", { state: { content: out.posts[0].content } });
    } else if (g.kind === "visual" && out) {
      navigate("/composer", { state: { visual: { data: out, template: g.meta?.template || "carousel" } } });
    } else if (g.kind === "coach") {
      navigate("/composer", { state: { content: parse(g.output)?.hook_rewrite || "" } });
    } else {
      const url = fileUrl(g);
      if (!url) { toast.error("This one hasn't finished rendering yet."); return; }
      navigate("/composer", { state: { mediaUrl: url, mediaType: g.kind } });
    }
  };

  const grouped = useMemo(() => items, [items]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="flex w-full flex-col border-white/10 bg-[#0A0A0A] p-0 text-white sm:max-w-md">
        <SheetTitle className="sr-only">Generation history</SheetTitle>
        <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4">
          <History size={17} className="text-lime" />
          <span className="font-display text-base font-semibold">History</span>
          <button onClick={() => load(filter)} data-testid="history-refresh"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-zinc-400 hover:text-white">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        <div className="flex flex-nowrap gap-1 overflow-x-auto border-b border-white/10 px-4 py-2.5 [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} data-testid={`history-filter-${f.key}`}
              className={`flex-shrink-0 rounded-full border px-3 py-1 text-xs transition-colors ${filter === f.key ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
          {loading && items.length === 0 && (
            <div className="flex justify-center py-10"><Loader2 className="animate-spin text-zinc-600" /></div>
          )}
          {!loading && items.length === 0 && (
            <div className="rounded-lg border border-dashed border-white/10 p-8 text-center text-sm text-zinc-600">
              Nothing here yet. Everything you generate is saved automatically.
            </div>
          )}

          {grouped.map((g) => {
            const meta = KIND_META[g.kind] || { label: g.kind, icon: Shapes };
            const Icon = meta.icon;
            const url = fileUrl(g);
            const isEditing = editing === g.id;
            const pending = g.task_id && !["finished", "failed", "error"].includes(g.status);
            return (
              <div key={g.id} data-testid={`history-item-${g.id}`}
                className="rounded-xl border border-white/10 bg-[#121212] p-3.5">
                <div className="flex items-start gap-2.5">
                  <Icon size={14} className="mt-0.5 flex-shrink-0 text-lime" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-zinc-100">{g.title}</div>
                    <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                      <span>{meta.label}</span>
                      <span>·</span>
                      <span>{new Date(g.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                      {pending && <span className="text-amber-400">· {g.status}</span>}
                    </div>
                  </div>
                  <button onClick={() => patch(g.id, { favorite: !g.favorite })} data-testid={`history-star-${g.id}`}
                    className={`flex-shrink-0 ${g.favorite ? "text-lime" : "text-zinc-600 hover:text-zinc-300"}`}>
                    <Star size={14} fill={g.favorite ? "currentColor" : "none"} />
                  </button>
                </div>

                {url && g.kind === "image" && <img src={url} alt="" className="mt-3 max-h-40 w-full rounded-lg object-cover" />}
                {url && g.kind === "video" && <video src={url} controls className="mt-3 w-full rounded-lg" />}
                {url && (g.kind === "music" || g.kind === "voice") && <audio src={url} controls className="mt-3 w-full" />}

                {isEditing ? (
                  <>
                    <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={7}
                      data-testid={`history-editor-${g.id}`}
                      className="mt-3 w-full resize-y rounded-lg border border-white/10 bg-[#0A0A0A] p-2.5 font-mono text-xs text-zinc-200 outline-none focus:border-lime" />
                    <div className="mt-2 flex gap-2">
                      <Button onClick={() => saveEdit(g)} data-testid={`history-save-${g.id}`}
                        className="h-7 flex-1 gap-1.5 rounded-lg bg-lime text-xs font-semibold text-[#0A0A0A] hover:bg-lime-hover"><Check size={13} /> Save</Button>
                      <Button variant="secondary" onClick={() => setEditing(null)}
                        className="h-7 gap-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-white hover:bg-white/10"><X size={13} /> Cancel</Button>
                    </div>
                  </>
                ) : (
                  g.output && <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">{previewOf(g)}</p>
                )}

                {!isEditing && (
                  <div className="mt-3 flex gap-2">
                    <Button onClick={() => sendToComposer(g)} data-testid={`history-use-${g.id}`}
                      className="h-7 flex-1 gap-1.5 rounded-lg bg-lime text-xs font-semibold text-[#0A0A0A] hover:bg-lime-hover">
                      <Send size={12} /> Use
                    </Button>
                    {g.output && (
                      <Button variant="secondary" onClick={() => { setEditing(g.id); setDraft(g.output || ""); }}
                        data-testid={`history-edit-${g.id}`}
                        className="h-7 gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs text-white hover:bg-white/10">
                        <Pencil size={12} />
                      </Button>
                    )}
                    <Button variant="ghost" onClick={() => remove(g.id)} data-testid={`history-delete-${g.id}`}
                      className="h-7 px-2.5 text-zinc-600 hover:text-magic">
                      <Trash2 size={13} />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// JSON outputs are unreadable raw, so each kind gets a one-line human preview.
function previewOf(g) {
  const out = g.output || "";
  const j = parse(out);
  if (!j) return out;
  if (Array.isArray(j.ideas)) return j.ideas.join("\n");
  if (Array.isArray(j.posts)) return j.posts.map((p) => p.content || p).join("\n\n");
  if (Array.isArray(j.slides)) return [j.title, ...j.slides.map((s) => `• ${s.heading || s.caption || ""}`)].join("\n");
  if (j.caption) return j.caption;
  if (j.hook_rewrite) return `Score ${j.score ?? "—"} · ${j.hook_rewrite}`;
  if (j.quote) return `"${j.quote}"`;
  if (typeof j === "object") return Object.values(j).filter((v) => typeof v === "string").join("\n\n");
  return out;
}
