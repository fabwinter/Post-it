import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "@/lib/api";
import { useTextModels } from "@/lib/useTextModels";
import { PLATFORM_LIST } from "@/lib/platforms";
import { ModelPicker } from "@/components/ModelPicker";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Flame, MessageCircleQuestion, ListOrdered, Swords, GraduationCap, Loader2, Copy, Send, Sparkles } from "lucide-react";

const TEMPLATES = [
  { key: "hooks", label: "Hooks", icon: Flame, desc: "Scroll-stopping one-liners" },
  { key: "story", label: "Story Arc", icon: MessageCircleQuestion, desc: "Moment, tension, lesson" },
  { key: "listicle", label: "Listicle", icon: ListOrdered, desc: "Numbered, punchy points" },
  { key: "contrarian", label: "Contrarian", icon: Swords, desc: "Challenge the consensus" },
  { key: "how_to", label: "How-To", icon: GraduationCap, desc: "Outcome, then steps" },
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
    </div>
  );
}
