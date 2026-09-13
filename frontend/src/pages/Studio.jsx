import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "@/lib/api";
import { useTextModels } from "@/lib/useTextModels";
import { PLATFORM_LIST } from "@/lib/platforms";
import { ModelPicker } from "@/components/ModelPicker";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Sparkles, Loader2, Send, Copy } from "lucide-react";

// Image/video/music/voice generation moved to the Library — every asset a
// generator produces belongs beside the rest of what's reusable across
// posts, not on a page named for the act of making it. Only the caption
// writer, which has no output to keep and reuse, stays here.
export default function Studio() {
  const navigate = useNavigate();
  const [brief, setBrief] = useState("");
  const [platform, setPlatform] = useState("twitter");
  const [tone, setTone] = useState("engaging");
  const [out, setOut] = useState("");
  const [loading, setLoading] = useState(false);
  const { models, default: defaultModel } = useTextModels("gemini-3-flash-preview");
  const [model, setModel] = useState("");

  const write = async () => {
    if (!brief.trim()) return;
    setLoading(true); setOut("");
    try {
      const { data } = await api.post("/ai/write", { brief, platform, tone, model: model || defaultModel });
      setOut(data.content);
    } catch (e) { toast.error(apiErrorMessage(e, "Generation failed.")); } finally { setLoading(false); }
  };

  return (
    <div data-testid="studio-page">
      <div className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">Content Studio</div>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Write a caption from any brief</h1>

      <div className="mt-7 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-[#121212] p-5">
          <label className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Brief</label>
          <textarea data-testid="studio-text-brief" value={brief} onChange={(e) => setBrief(e.target.value)} rows={6}
            placeholder="What do you want to say? Paste notes, an angle, or a rough draft…"
            className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-[#0A0A0A] p-3 text-sm text-white outline-none focus:border-lime" />

          <label className="mt-4 block font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Platform</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {PLATFORM_LIST.map((p) => (
              <button key={p.key} onClick={() => setPlatform(p.key)} data-testid={`studio-platform-${p.key}`}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${platform === p.key ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
                {p.name}
              </button>
            ))}
          </div>

          <label className="mt-4 block font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Tone</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {["engaging", "professional", "witty", "bold", "inspirational"].map((t) => (
              <button key={t} onClick={() => setTone(t)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-colors ${tone === t ? "border-iris bg-iris/10 text-iris" : "border-white/10 text-zinc-400 hover:text-white"}`}>{t}</button>
            ))}
          </div>

          <label className="mt-4 block font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Model</label>
          <div className="mt-2">
            <ModelPicker value={model || defaultModel} onChange={setModel} models={models} testid="studio-text-model" />
          </div>

          <Button data-testid="studio-write-button" onClick={write} disabled={loading}
            className="mt-5 w-full gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover">
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />} Write it
          </Button>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#121212] p-5">
          <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Output</div>
          <div className="mt-3 min-h-[220px] whitespace-pre-wrap rounded-lg border border-white/10 bg-[#0A0A0A] p-4 text-sm leading-relaxed text-zinc-200">
            {out || <span className="text-zinc-600">Your generated post will appear here.</span>}
          </div>
          {out && (
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" onClick={() => { navigator.clipboard.writeText(out); toast.success("Copied"); }}
                className="gap-2 rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10" data-testid="studio-copy-text">
                <Copy size={16} /> Copy
              </Button>
              <Button onClick={() => navigate("/composer", { state: { content: out, platforms: [platform] } })}
                className="gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover" data-testid="studio-send-composer">
                <Send size={16} /> Send to Composer
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
