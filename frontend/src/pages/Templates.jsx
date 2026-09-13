import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "@/lib/api";
import { useTextModels } from "@/lib/useTextModels";
import { useCustomTemplates } from "@/lib/useCustomTemplates";
import { PLATFORM_LIST } from "@/lib/platforms";
import { ModelPicker } from "@/components/ModelPicker";
import { VisualCard, ASPECT_CLASS } from "@/components/VisualCard";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Flame, MessageCircleQuestion, ListOrdered, Swords, GraduationCap, Loader2, Copy, Send, Sparkles, Wand,
  Upload, FileText, Image as ImageIcon, Presentation, Trash2, LayoutTemplate, Pencil,
} from "lucide-react";

const TEMPLATES = [
  { key: "hooks", label: "Hooks", icon: Flame, desc: "Scroll-stopping one-liners" },
  { key: "story", label: "Story Arc", icon: MessageCircleQuestion, desc: "Moment, tension, lesson" },
  { key: "listicle", label: "Listicle", icon: ListOrdered, desc: "Numbered, punchy points" },
  { key: "contrarian", label: "Contrarian", icon: Swords, desc: "Challenge the consensus" },
  { key: "how_to", label: "How-To", icon: GraduationCap, desc: "Outcome, then steps" },
];

const CUSTOM_TYPES = [
  { key: "pptx", label: "PowerPoint", icon: Presentation, accept: ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  { key: "pdf", label: "PDF", icon: FileText, accept: ".pdf,application/pdf" },
  { key: "image", label: "Image", icon: ImageIcon, accept: "image/*" },
];

export default function Templates() {
  const navigate = useNavigate();
  const [topic, setTopic] = useState("");
  const [template, setTemplate] = useState("hooks");
  const [platform, setPlatform] = useState("twitter");
  const [count, setCount] = useState(7);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const { models, default: defaultModel } = useTextModels("gemini-3-flash-preview");
  const [model, setModel] = useState("");

  const [customType, setCustomType] = useState("pptx");
  const [converting, setConverting] = useState(false);
  const customFileRef = useRef(null);
  const { templates: customTemplates, loading: loadingCustom, reload: reloadCustom } = useCustomTemplates();

  const run = async () => {
    if (!topic.trim()) { toast.error("Enter a topic first."); return; }
    setLoading(true); setPosts([]);
    try {
      const { data } = await api.post("/ai/templates", {
        topic, template, platform, count: Number(count), model: model || defaultModel,
      });
      setPosts(data.posts);
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't generate templates.")); } finally { setLoading(false); }
  };

  // Uploads the file, then extracts its real layout (slide text, page text,
  // or a dominant-color palette) into a reusable, saved template.
  const convertFile = async (file) => {
    if (!file) return;
    setConverting(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const { data: up } = await api.post("/upload", body);
      await api.post("/templates/from-file", { source_type: customType, source_url: up.url });
      await reloadCustom();
      toast.success("Template saved — use it from the Composer.");
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't convert that file.")); }
    finally { setConverting(false); if (customFileRef.current) customFileRef.current.value = ""; }
  };

  const deleteCustomTemplate = async (tpl) => {
    if (!window.confirm(`Delete "${tpl.name}"? This can't be undone.`)) return;
    try {
      await api.delete(`/templates/custom/${tpl.id}`);
      await reloadCustom();
      toast.success("Deleted");
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't delete that template.")); }
  };

  const openInComposer = (tpl) => navigate("/composer", { state: { applyCustomTemplateId: tpl.id } });
  const editTemplate = (tpl) => navigate("/composer", { state: { editTemplateId: tpl.id } });

  return (
    <div data-testid="templates-page">
      <div className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">Viral templates</div>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Drop a topic, get a week of posts</h1>

      <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {TEMPLATES.map((t) => {
          const Icon = t.icon; const on = template === t.key;
          return (
            <button key={t.key} onClick={() => setTemplate(t.key)} data-testid={`template-${t.key}`}
              className={`rounded-xl border p-4 text-left transition-colors ${on ? "border-lime bg-lime/10" : "border-white/10 bg-[#121212] hover:border-white/20"}`}>
              <Icon size={20} className={on ? "text-lime" : "text-zinc-400"} />
              <div className="mt-3 text-sm font-semibold text-white">{t.label}</div>
              <div className="mt-0.5 text-xs text-zinc-500">{t.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        <div className="rounded-xl border border-white/10 bg-[#121212] p-5">
          <label className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Topic</label>
          <textarea data-testid="templates-topic" value={topic} onChange={(e) => setTopic(e.target.value)} rows={3}
            placeholder="e.g. building an audience as a solo founder"
            className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-[#0A0A0A] p-3 text-sm text-white outline-none focus:border-lime" />

          <label className="mt-4 block font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Platform</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {PLATFORM_LIST.map((p) => (
              <button key={p.key} onClick={() => setPlatform(p.key)} data-testid={`templates-platform-${p.key}`}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${platform === p.key ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
                {p.name}
              </button>
            ))}
          </div>

          <div className="mt-4 flex gap-3">
            <div className="flex-1">
              <label className="block font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Posts</label>
              <div className="mt-2 flex gap-1.5">
                {[3, 5, 7, 10].map((n) => (
                  <button key={n} onClick={() => setCount(n)} data-testid={`templates-count-${n}`}
                    className={`h-9 w-9 rounded-lg border text-sm ${count === n ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>{n}</button>
                ))}
              </div>
            </div>
          </div>

          <label className="mt-4 block font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Model</label>
          <div className="mt-2">
            <ModelPicker value={model || defaultModel} onChange={setModel} models={models} testid="templates-model" />
          </div>

          <Button data-testid="templates-run" onClick={run} disabled={loading}
            className="mt-5 w-full gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover">
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />} Generate {count} posts
          </Button>

          <Button variant="secondary" data-testid="templates-apply-existing"
            onClick={() => navigate("/composer", { state: { applyTemplate: template } })}
            className="mt-2 w-full gap-2 rounded-lg border border-white/10 bg-white/5 text-xs text-white hover:bg-white/10">
            <Wand size={14} /> Apply this style to a draft instead
          </Button>
          <p className="mt-2 text-xs text-zinc-600">Already have a draft? Skip generating from a topic — open it in the Composer and restyle it as {TEMPLATES.find((t) => t.key === template)?.label}.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {loading && Array.from({ length: count }).map((_, i) => (
            <div key={i} className="generating-pulse rounded-xl border border-lime/40 bg-[#121212] p-5">
              <div className="space-y-2">
                <div className="h-3 w-full rounded bg-white/5" /><div className="h-3 w-4/5 rounded bg-white/5" /><div className="h-3 w-2/3 rounded bg-white/5" />
              </div>
            </div>
          ))}
          {!loading && posts.length === 0 && (
            <div className="col-span-full flex min-h-[300px] items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-zinc-600">
              Your week of posts will appear here.
            </div>
          )}
          {!loading && posts.map((p) => (
            <div key={p.day} className="flex flex-col rounded-xl border border-white/10 bg-[#121212] p-5" data-testid={`templates-result-${p.day}`}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Day {p.day}</span>
                <span className="font-mono text-[11px] text-zinc-500">{p.content.length} chars</span>
              </div>
              <p className="mt-3 flex-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{p.content}</p>
              <div className="mt-4 flex gap-2">
                <Button variant="secondary" onClick={() => { navigator.clipboard.writeText(p.content); toast.success("Copied"); }}
                  className="h-8 gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-white hover:bg-white/10"><Copy size={14} /> Copy</Button>
                <Button onClick={() => navigate("/composer", { state: { content: p.content, platforms: [platform] } })}
                  className="h-8 gap-1.5 rounded-lg bg-lime px-3 text-xs font-semibold text-[#0A0A0A] hover:bg-lime-hover" data-testid={`templates-schedule-${p.day}`}><Send size={14} /> Compose</Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 rounded-xl border border-white/10 bg-[#121212] p-5" data-testid="templates-custom">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <LayoutTemplate size={15} className="text-lime" /> Template library
        </h3>
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
          Starter layouts ship with the app — each one lays out the words for you and stays fully draggable in the
          Composer. Or add your own: upload a PowerPoint, PDF, or image and its real structure becomes a reusable
          template. Building from either writes fresh content into that structure; it never copies the source's wording.
        </p>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {CUSTOM_TYPES.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.key} onClick={() => setCustomType(t.key)} data-testid={`templates-custom-type-${t.key}`}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${customType === t.key ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
                <Icon size={13} /> {t.label}
              </button>
            );
          })}
        </div>

        <div className="mt-3">
          <input ref={customFileRef} type="file" accept={CUSTOM_TYPES.find((t) => t.key === customType)?.accept}
            className="hidden" data-testid="templates-custom-file-input" onChange={(e) => convertFile(e.target.files?.[0])} />
          <Button variant="secondary" onClick={() => customFileRef.current?.click()} disabled={converting} data-testid="templates-custom-convert"
            className="gap-2 rounded-lg border border-white/10 bg-white/5 text-xs text-white hover:bg-white/10">
            {converting ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {converting ? "Converting…" : `Upload ${customType === "pptx" ? "PowerPoint" : customType} to convert`}
          </Button>
        </div>

        {/* Each card carries min-w-0 because a grid item defaults to
            min-width:auto and so can't shrink below its own min-content —
            which `truncate` (white-space:nowrap) makes the full untruncated
            width of the description. Below sm there's no grid-cols-* class,
            so the implicit track is `auto` and had nothing else holding it
            back: the cards sat at ~592px in a 390px viewport and scrolled
            the whole page sideways. sm:grid-cols-2 was never affected —
            Tailwind's grid-cols-* already expand to minmax(0, 1fr). */}
        {!loadingCustom && customTemplates.length > 0 && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {customTemplates.map((tpl) => (
              <div key={tpl.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-[#0A0A0A] p-3" data-testid={`templates-custom-item-${tpl.id}`}>
                <div className={`relative w-[84px] flex-none overflow-hidden rounded-md border border-white/10 bg-[#050505] ${tpl.format === "reel" ? ASPECT_CLASS["9:16"] : ASPECT_CLASS["4:5"]}`}
                  data-testid={`templates-custom-thumb-${tpl.id}`}>
                  {tpl.preview ? (
                    <VisualCard spec={tpl.preview} scale={0.19} className="pointer-events-none" />
                  ) : Object.keys(tpl.colors || {}).length > 0 ? (
                    <div className="flex h-full flex-col">
                      {Object.values(tpl.colors).slice(0, 4).map((hex, i) => (
                        <span key={i} className="flex-1" style={{ background: hex }} />
                      ))}
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center text-zinc-700"><LayoutTemplate size={18} /></div>
                  )}
                </div>
                <div className="min-w-[9rem] flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-white">{tpl.name}</span>
                    {tpl.builtin && <span className="flex-none rounded-full border border-lime/40 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-lime">Starter</span>}
                  </div>
                  {tpl.description && <div className="mt-0.5 truncate text-[11px] text-zinc-500">{tpl.description}</div>}
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                    {!tpl.builtin && <span className="uppercase">{tpl.source_kind}</span>}
                    <span>{!tpl.builtin && "· "}{tpl.slides.length} slide{tpl.slides.length === 1 ? "" : "s"} · {tpl.format}</span>
                  </div>
                </div>
                {/* Once wrapped onto its own line the actions read better
                    across than stacked in a narrow column, so they only
                    become a column again at the width that fits them beside
                    the text. */}
                <div className="flex w-full flex-none flex-row items-stretch gap-1.5 sm:w-auto sm:flex-col">
                  <Button onClick={() => openInComposer(tpl)} data-testid={`templates-custom-use-${tpl.id}`}
                    className="h-7 gap-1 rounded-lg bg-lime px-2.5 text-[11px] font-semibold text-[#0A0A0A] hover:bg-lime-hover">
                    <Wand size={12} /> Use
                  </Button>
                  {!tpl.builtin && (
                    <Button variant="secondary" onClick={() => editTemplate(tpl)} data-testid={`templates-custom-edit-${tpl.id}`}
                      className="h-7 gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 text-[11px] text-white hover:bg-white/10">
                      <Pencil size={12} /> Edit
                    </Button>
                  )}
                  {!tpl.builtin && (
                    <Button variant="secondary" onClick={() => deleteCustomTemplate(tpl)} data-testid={`templates-custom-delete-${tpl.id}`}
                      className="h-7 w-7 rounded-lg border border-white/10 bg-white/5 p-0 text-zinc-400 hover:text-white">
                      <Trash2 size={13} />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
