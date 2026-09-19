import { useRef, useState, useEffect } from "react";
import { captureCardPng } from "@/lib/cardExport";
import { api, apiErrorMessage } from "@/lib/api";
import { useTextModels } from "@/lib/useTextModels";
import { ModelPicker } from "@/components/ModelPicker";
import { useBrand, activeColors } from "@/lib/useBrand";
import { VisualCard, THEMES } from "@/components/VisualCard";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Quote, Twitter, ListChecks, GalleryHorizontal, Images as ImagesIcon,
  Sparkles, Loader2, Download, Send, ChevronLeft, ChevronRight, Play, Pause,
} from "lucide-react";

const TEMPLATES = [
  { key: "quote", label: "Quote Card", icon: Quote, desc: "A bold, shareable quote graphic" },
  { key: "tweet", label: "Tweet Card", icon: Twitter, desc: "Screenshot-style tweet" },
  { key: "infographic", label: "Infographic", icon: ListChecks, desc: "Whiteboard & chalkboard points" },
  { key: "carousel", label: "Carousel", icon: GalleryHorizontal, desc: "Instagram / tutorial slides" },
  { key: "slideshow", label: "Slideshow", icon: ImagesIcon, desc: "Auto-playing slide deck" },
];

// A single card or deck generated straight from a prompt (a quote, a tweet
// screenshot, an infographic, a carousel), folded in from the standalone
// Visual Studio page. "Use in post" hands the generated spec + a plain-text
// summary of it to the Composer, the same shape a saved plan already
// arrives in.
export function ComposerVisualPanel({ onApply }) {
  const [template, setTemplate] = useState("quote");
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(5);
  const [themeKey, setThemeKey] = useState("midnight");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [slideIdx, setSlideIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const cardRef = useRef(null);
  const { models, default: defaultModel } = useTextModels("gemini-3-flash-preview");
  const [model, setModel] = useState("");
  const { brand } = useBrand();

  const isDeck = template === "carousel" || template === "slideshow";

  useEffect(() => { setData(null); setSlideIdx(0); setPlaying(false); }, [template]);

  useEffect(() => {
    if (!playing || !isDeck || !data?.slides?.length) return;
    const id = setInterval(() => setSlideIdx((i) => (i + 1) % (data.slides.length + 1)), 2200);
    return () => clearInterval(id);
  }, [playing, isDeck, data]);

  const generate = async () => {
    if (!topic.trim()) { toast.error("Enter a topic first."); return; }
    setLoading(true); setData(null); setSlideIdx(0);
    try {
      const { data: res } = await api.post("/ai/visual", { template, topic, count: Number(count), model: model || defaultModel });
      setData(res.data);
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't generate. Check the PoYo key.")); } finally { setLoading(false); }
  };

  const download = async () => {
    if (!cardRef.current) return;
    setExporting(true);
    try {
      // Shared with every other PNG export — see lib/cardExport: images
      // proxied so the canvas isn't tainted, footage snapshotted so a clip
      // doesn't kill the capture outright, fonts embedded scoped to the
      // faces actually on the card, and no cacheBust.
      const url = await captureCardPng(cardRef.current);
      // A data: URL handed straight to <a download> silently fails in some
      // browsers once it's large — the fix the Composer already made
      // (convert to a Blob URL first). Small captures keep the data URL.
      let href = url;
      try {
        const blob = await (await fetch(url)).blob();
        href = URL.createObjectURL(blob);
      } catch { /* keep the data URL */ }
      const a = document.createElement("a");
      a.href = href; a.download = `createos-${template}.png`; a.click();
      if (href !== url) setTimeout(() => URL.revokeObjectURL(href), 30000);
      toast.success("Downloaded PNG");
    } catch (e) { toast.error(apiErrorMessage(e, "Export failed")); } finally { setExporting(false); }
  };

  const useInPost = () => {
    if (!data) return;
    const platforms = template === "tweet" ? ["twitter"] : ["instagram"];
    onApply({ visual: { data, template, theme: themeKey }, content: summaryText(template, data), platforms });
  };

  return (
    <div data-testid="composer-visual-panel">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {TEMPLATES.map((t) => {
          const Icon = t.icon; const on = template === t.key;
          return (
            <button key={t.key} onClick={() => setTemplate(t.key)} data-testid={`visual-template-${t.key}`}
              className={`rounded-xl border p-3 text-left transition-colors ${on ? "border-lime bg-lime/10" : "border-white/10 bg-[#0A0A0A] hover:border-white/20"}`}>
              <Icon size={18} className={on ? "text-lime" : "text-zinc-400"} />
              <div className="mt-2 text-xs font-semibold text-white">{t.label}</div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
        <div>
          <label className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Topic / brief</label>
          <textarea data-testid="visual-topic" value={topic} onChange={(e) => setTopic(e.target.value)} rows={3}
            placeholder="e.g. why consistency beats virality for creators"
            className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-[#0A0A0A] p-3 text-sm text-white outline-none focus:border-lime" />

          {isDeck && (
            <div className="mt-3">
              <label className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Slides</label>
              <div className="mt-2 flex gap-2">
                {[3, 4, 5, 6, 7].map((n) => (
                  <button key={n} onClick={() => setCount(n)} data-testid={`visual-count-${n}`}
                    className={`h-9 w-9 rounded-lg border text-sm ${count === n ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>{n}</button>
                ))}
              </div>
            </div>
          )}

          <label className="mt-3 block font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Theme</label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {Object.values(THEMES).concat([{ key: "brand", label: brand.name || "Brand", bg: activeColors(brand).bg }]).map((th) => (
              <button key={th.key} onClick={() => setThemeKey(th.key)} data-testid={`visual-theme-${th.key}`}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${themeKey === th.key ? "border-lime text-white" : "border-white/10 text-zinc-400 hover:text-white"}`}>
                <span className="h-4 w-4 rounded-full border border-white/20" style={{ background: th.bg }} />
                {th.label}
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <ModelPicker value={model || defaultModel} onChange={setModel} models={models} testid="visual-model" className="w-auto min-w-[160px] flex-none" />
            <Button data-testid="visual-generate" onClick={generate} disabled={loading}
              className="gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover">
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />} Generate copy
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#0A0A0A] p-4">
          <div className="flex items-center justify-between">
            <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Preview</div>
            {isDeck && data?.slides && (
              <div className="flex items-center gap-2">
                <button onClick={() => setPlaying((p) => !p)} data-testid="visual-play"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-zinc-300 hover:text-lime">
                  {playing ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <span className="font-mono text-[11px] text-zinc-500">{slideIdx + 1}/{data.slides.length + 1}</span>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-col items-center">
            <div className="w-full max-w-[300px]">
              <div ref={cardRef} data-testid="visual-canvas" className="aspect-square w-full overflow-hidden rounded-xl">
                <VisualCard spec={specFrom(template, themeKey, data, slideIdx)} brand={brand} loading={loading} scale={0.6} />
              </div>
            </div>

            {isDeck && data?.slides && (
              <div className="mt-3 flex items-center gap-3">
                <button onClick={() => setSlideIdx((i) => Math.max(0, i - 1))} data-testid="visual-prev"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-zinc-300 hover:text-white"><ChevronLeft size={16} /></button>
                <button onClick={() => setSlideIdx((i) => Math.min(data.slides.length, i + 1))} data-testid="visual-next"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-zinc-300 hover:text-white"><ChevronRight size={16} /></button>
              </div>
            )}

            {data && (
              <div className="mt-4 flex gap-2">
                <Button variant="secondary" onClick={download} disabled={exporting} data-testid="visual-download"
                  className="gap-2 rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10">
                  {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} PNG
                </Button>
                <Button onClick={useInPost} data-testid="visual-use"
                  className="gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover">
                  <Send size={16} /> Use in post
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function summaryText(template, data) {
  if (!data) return "";
  if (template === "quote") return `"${data.quote}" — ${data.author}`;
  if (template === "tweet") return data.text || "";
  if (template === "infographic") return `${data.title}\n\n` + (data.points || []).map((p) => `• ${p}`).join("\n");
  if (data.slides) return `${data.title}\n\n` + data.slides.map((s, i) => `${i + 1}. ${s.heading}`).join("\n");
  return "";
}

// Map this panel's (template, data, slideIdx) view state onto the single-card
// spec the shared renderer takes.
function specFrom(template, theme, data, slideIdx) {
  if (!data) return null;
  if (template === "quote") return { template: "quote", theme, quote: data.quote, author: data.author };
  if (template === "tweet") return { template: "tweet", theme, name: data.name, handle: data.handle, text: data.text };
  if (template === "infographic") return { template: "infographic", theme, title: data.title, points: data.points || [] };
  const slides = data.slides || [];
  const total = slides.length + 1;
  if (slideIdx === 0) return { template: "cover", theme, index: 0, total, title: data.title };
  const s = slides[slideIdx - 1] || {};
  return { template: "slide", theme, index: slideIdx, total, heading: s.heading || s.caption || "", body: s.body || "" };
}
