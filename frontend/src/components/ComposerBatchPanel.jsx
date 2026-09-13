import { useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";
import { useTextModels } from "@/lib/useTextModels";
import { useTemplateStyles } from "@/lib/templateStyles";
import { PLATFORM_LIST } from "@/lib/platforms";
import { ModelPicker } from "@/components/ModelPicker";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Flame, MessageCircleQuestion, ListOrdered, Swords, GraduationCap, Loader2, Copy, Send, Sparkles } from "lucide-react";

// The same five voice formulas as the Composer's own "Tone" picker — an
// icon per key for this grid; useTemplateStyles is the shared source of
// truth for the keys/labels themselves so this never drifts from Tone.
const ICONS = { hooks: Flame, story: MessageCircleQuestion, listicle: ListOrdered, contrarian: Swords, how_to: GraduationCap };

// A week of posts from one topic in one voice, folded in from the
// standalone Batch (formerly Viral Templates) page. Picking one applies it
// to the post currently open here instead of navigating to a new one.
export function ComposerBatchPanel({ onApply }) {
  const [topic, setTopic] = useState("");
  const [template, setTemplate] = useState("hooks");
  const [platform, setPlatform] = useState("twitter");
  const [count, setCount] = useState(7);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const { models, default: defaultModel } = useTextModels("gemini-3-flash-preview");
  const [model, setModel] = useState("");
  const voiceTemplates = useTemplateStyles();

  const run = async () => {
    if (!topic.trim()) { toast.error("Enter a topic first."); return; }
    setLoading(true); setPosts([]);
    try {
      const { data } = await api.post("/ai/templates", {
        topic, template, platform, count: Number(count), model: model || defaultModel,
      });
      setPosts(data.posts);
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't generate posts.")); } finally { setLoading(false); }
  };

  return (
    <div data-testid="composer-batch-panel">
      <label className="block font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Tone</label>
      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {voiceTemplates.map((t) => {
          const Icon = ICONS[t.key] || Sparkles; const on = template === t.key;
          return (
            <button key={t.key} onClick={() => setTemplate(t.key)} data-testid={`template-${t.key}`}
              className={`rounded-xl border p-3 text-left transition-colors ${on ? "border-lime bg-lime/10" : "border-white/10 bg-[#0A0A0A] hover:border-white/20"}`}>
              <Icon size={18} className={on ? "text-lime" : "text-zinc-400"} />
              <div className="mt-2 text-xs font-semibold text-white">{t.label}</div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
        <div>
          <label className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Topic</label>
          <textarea data-testid="templates-topic" value={topic} onChange={(e) => setTopic(e.target.value)} rows={3}
            placeholder="e.g. building an audience as a solo founder"
            className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-[#0A0A0A] p-3 text-sm text-white outline-none focus:border-lime" />

          <label className="mt-3 block font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Platform</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {PLATFORM_LIST.map((p) => (
              <button key={p.key} onClick={() => setPlatform(p.key)} data-testid={`templates-platform-${p.key}`}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${platform === p.key ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
                {p.name}
              </button>
            ))}
          </div>

          <label className="mt-3 block font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Posts</label>
          <div className="mt-2 flex gap-1.5">
            {[3, 5, 7, 10].map((n) => (
              <button key={n} onClick={() => setCount(n)} data-testid={`templates-count-${n}`}
                className={`h-9 w-9 rounded-lg border text-sm ${count === n ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>{n}</button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <ModelPicker value={model || defaultModel} onChange={setModel} models={models} testid="templates-model" className="w-auto min-w-[160px] flex-none" />
            <Button data-testid="templates-run" onClick={run} disabled={loading}
              className="gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover">
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />} Generate {count}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2" style={{ alignContent: "start" }}>
          {loading && Array.from({ length: Math.min(count, 4) }).map((_, i) => (
            <div key={i} className="generating-pulse rounded-xl border border-lime/40 bg-[#0A0A0A] p-4">
              <div className="space-y-2">
                <div className="h-3 w-full rounded bg-white/5" /><div className="h-3 w-4/5 rounded bg-white/5" /><div className="h-3 w-2/3 rounded bg-white/5" />
              </div>
            </div>
          ))}
          {!loading && posts.length === 0 && (
            <div className="col-span-full flex min-h-[160px] items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-zinc-600">
              Your week of posts will appear here.
            </div>
          )}
          {!loading && posts.map((p) => (
            <div key={p.day} className="flex flex-col rounded-xl border border-white/10 bg-[#0A0A0A] p-4" data-testid={`templates-result-${p.day}`}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Day {p.day}</span>
                <span className="font-mono text-[11px] text-zinc-500">{p.content.length} chars</span>
              </div>
              <p className="mt-2 flex-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{p.content}</p>
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" onClick={() => { navigator.clipboard.writeText(p.content); toast.success("Copied"); }}
                  className="h-8 gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-white hover:bg-white/10"><Copy size={14} /> Copy</Button>
                <Button onClick={() => onApply({ content: p.content, platform })}
                  className="h-8 flex-1 gap-1.5 rounded-lg bg-lime px-3 text-xs font-semibold text-[#0A0A0A] hover:bg-lime-hover" data-testid={`templates-schedule-${p.day}`}><Send size={14} /> Use this</Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
