import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "@/lib/api";
import { PLATFORM_LIST, platformOf } from "@/lib/platforms";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Repeat, Loader2, Copy, Send, Sparkles } from "lucide-react";

const DEFAULTS = ["twitter", "linkedin", "instagram", "threads"];

export default function Repurpose() {
  const navigate = useNavigate();
  const [source, setSource] = useState("");
  const [selected, setSelected] = useState(DEFAULTS);
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState(false);

  const toggle = (k) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  const run = async () => {
    if (!source.trim() || selected.length === 0) return;
    setLoading(true); setResults({});
    try {
      const { data } = await api.post("/ai/repurpose", { source, platforms: selected });
      setResults(data.posts);
    } catch (e) { toast.error(apiErrorMessage(e, "Repurpose failed.")); } finally { setLoading(false); }
  };

  return (
    <div data-testid="repurpose-page">
      <div className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">Repurpose</div>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">One source. Every platform, natively.</h1>

      <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        <div className="rounded-xl border border-white/10 bg-[#121212] p-5">
          <label className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Source content</label>
          <textarea data-testid="repurpose-source" value={source} onChange={(e) => setSource(e.target.value)} rows={10}
            placeholder="Paste a blog post, transcript, newsletter, raw notes, or a rough idea…"
            className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-[#0A0A0A] p-3 text-sm text-white outline-none focus:border-lime" />

          <label className="mt-4 block font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Target platforms</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {PLATFORM_LIST.map((p) => {
              const on = selected.includes(p.key); const I = p.icon;
              return (
                <button key={p.key} onClick={() => toggle(p.key)} data-testid={`repurpose-platform-${p.key}`}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${on ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
                  <I size={13} /> {p.name}
                </button>
              );
            })}
          </div>

          <Button data-testid="repurpose-run" onClick={run} disabled={loading}
            className="mt-5 w-full gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover">
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Repeat size={18} />} Repurpose to {selected.length}
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {loading && selected.map((k) => (
            <div key={k} className="generating-pulse rounded-xl border border-lime/40 bg-[#121212] p-5">
              <div className="flex items-center gap-2 text-zinc-400"><Sparkles size={14} className="text-lime" />{platformOf(k).name}</div>
              <div className="mt-4 space-y-2">
                <div className="h-3 w-full rounded bg-white/5" /><div className="h-3 w-4/5 rounded bg-white/5" /><div className="h-3 w-2/3 rounded bg-white/5" />
              </div>
            </div>
          ))}
          {!loading && Object.keys(results).length === 0 && (
            <div className="col-span-full flex min-h-[300px] items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-zinc-600">
              Your platform-native posts will appear here.
            </div>
          )}
          {!loading && Object.entries(results).map(([k, text]) => {
            const p = platformOf(k); const I = p.icon;
            return (
              <div key={k} className="flex flex-col rounded-xl border border-white/10 bg-[#121212] p-5" data-testid={`repurpose-result-${k}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold"><I size={16} style={{ color: p.color }} /> {p.name}</div>
                  <span className="font-mono text-[11px] text-zinc-500">{text.length}{p.limit ? `/${p.limit}` : ""}</span>
                </div>
                <p className="mt-3 flex-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{text}</p>
                <div className="mt-4 flex gap-2">
                  <Button variant="secondary" onClick={() => { navigator.clipboard.writeText(text); toast.success("Copied"); }}
                    className="h-8 gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-white hover:bg-white/10"><Copy size={14} /> Copy</Button>
                  <Button onClick={() => navigate("/composer", { state: { content: text, platforms: [k] } })}
                    className="h-8 gap-1.5 rounded-lg bg-lime px-3 text-xs font-semibold text-[#0A0A0A] hover:bg-lime-hover" data-testid={`repurpose-schedule-${k}`}><Send size={14} /> Compose</Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
