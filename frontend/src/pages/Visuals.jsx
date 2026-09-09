import { useMemo, useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toPng } from "html-to-image";
import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Quote, Twitter, ListChecks, GalleryHorizontal, Images as ImagesIcon,
  Sparkles, Loader2, Download, Send, ChevronLeft, ChevronRight, Play, Pause, BadgeCheck,
} from "lucide-react";

const TEMPLATES = [
  { key: "quote", label: "Quote Card", icon: Quote, desc: "A bold, shareable quote graphic" },
  { key: "tweet", label: "Tweet Card", icon: Twitter, desc: "Screenshot-style tweet" },
  { key: "infographic", label: "Infographic", icon: ListChecks, desc: "Whiteboard & chalkboard points" },
  { key: "carousel", label: "Carousel", icon: GalleryHorizontal, desc: "Instagram / tutorial slides" },
  { key: "slideshow", label: "Slideshow", icon: ImagesIcon, desc: "Auto-playing slide deck" },
];

const THEMES = {
  whiteboard: { key: "whiteboard", label: "Whiteboard", bg: "#F7F7F2", fg: "#141414", sub: "#4b5563", accent: "#E2FF3D", pattern: "grid" },
  chalkboard: { key: "chalkboard", label: "Chalkboard", bg: "#12211C", fg: "#F4F1E9", sub: "#9db5a8", accent: "#E2FF3D", pattern: "chalk" },
  midnight: { key: "midnight", label: "Midnight", bg: "#0A0A0A", fg: "#FFFFFF", sub: "#a1a1aa", accent: "#E2FF3D", pattern: "dots" },
  gradient: { key: "gradient", label: "Gradient", bg: "linear-gradient(135deg,#1a1a2e 0%,#0A0A0A 60%)", fg: "#FFFFFF", sub: "#C4B5FD", accent: "#E2FF3D", pattern: "none" },
};

export default function Visuals() {
  const navigate = useNavigate();
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

  const theme = THEMES[themeKey];
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
      const { data: res } = await api.post("/ai/visual", { template, topic, count: Number(count) });
      setData(res.data);
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't generate. Check the PoYo key.")); } finally { setLoading(false); }
  };

  const download = async () => {
    if (!cardRef.current) return;
    setExporting(true);
    try {
      const url = await toPng(cardRef.current, { pixelRatio: 2, cacheBust: true });
      const a = document.createElement("a");
      a.href = url; a.download = `createos-${template}.png`; a.click();
      toast.success("Downloaded PNG");
    } catch (e) { toast.error(apiErrorMessage(e, "Export failed")); } finally { setExporting(false); }
  };

  const useInPost = async () => {
    if (!cardRef.current) return;
    setExporting(true);
    try {
      const url = await toPng(cardRef.current, { pixelRatio: 2, cacheBust: true });
      const platforms = template === "tweet" ? ["twitter"] : template === "carousel" || template === "slideshow" ? ["instagram"] : ["instagram"];
      const content = summaryText(template, data);
      navigate("/composer", { state: { mediaUrl: url, mediaType: "image", content, platforms } });
    } catch (e) { toast.error(apiErrorMessage(e, "Export failed")); } finally { setExporting(false); }
  };

  return (
    <div data-testid="visuals-page">
      <div className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">Visual studio</div>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Design it from a prompt</h1>

      {/* Template picker */}
      <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {TEMPLATES.map((t) => {
          const Icon = t.icon; const on = template === t.key;
          return (
            <button key={t.key} onClick={() => setTemplate(t.key)} data-testid={`visual-template-${t.key}`}
              className={`rounded-xl border p-4 text-left transition-colors ${on ? "border-lime bg-lime/10" : "border-white/10 bg-[#121212] hover:border-white/20"}`}>
              <Icon size={20} className={on ? "text-lime" : "text-zinc-400"} />
              <div className="mt-3 text-sm font-semibold text-white">{t.label}</div>
              <div className="mt-0.5 text-xs text-zinc-500">{t.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        {/* Controls */}
        <div className="rounded-xl border border-white/10 bg-[#121212] p-5">
          <label className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Topic / brief</label>
          <textarea data-testid="visual-topic" value={topic} onChange={(e) => setTopic(e.target.value)} rows={4}
            placeholder="e.g. why consistency beats virality for creators"
            className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-[#0A0A0A] p-3 text-sm text-white outline-none focus:border-lime" />

          {isDeck && (
            <div className="mt-4">
              <label className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Slides</label>
              <div className="mt-2 flex gap-2">
                {[3, 4, 5, 6, 7].map((n) => (
                  <button key={n} onClick={() => setCount(n)} data-testid={`visual-count-${n}`}
                    className={`h-9 w-9 rounded-lg border text-sm ${count === n ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>{n}</button>
                ))}
              </div>
            </div>
          )}

          <label className="mt-4 block font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Theme</label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {Object.values(THEMES).map((th) => (
              <button key={th.key} onClick={() => setThemeKey(th.key)} data-testid={`visual-theme-${th.key}`}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${themeKey === th.key ? "border-lime text-white" : "border-white/10 text-zinc-400 hover:text-white"}`}>
                <span className="h-4 w-4 rounded-full border border-white/20" style={{ background: th.bg }} />
                {th.label}
              </button>
            ))}
          </div>

          <Button data-testid="visual-generate" onClick={generate} disabled={loading}
            className="mt-5 w-full gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover">
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />} Generate copy
          </Button>
          <p className="mt-3 text-xs text-zinc-600">AI writes the copy; the graphic renders instantly. Export a crisp PNG or drop it into a post.</p>
        </div>

        {/* Preview */}
        <div className="rounded-xl border border-white/10 bg-[#121212] p-5">
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
            <div className="w-full max-w-[440px]">
              <div ref={cardRef} data-testid="visual-canvas" className="aspect-square w-full overflow-hidden rounded-xl">
                <VisualCanvas template={template} theme={theme} data={data} slideIdx={slideIdx} loading={loading} />
              </div>
            </div>

            {isDeck && data?.slides && (
              <div className="mt-4 flex items-center gap-3">
                <button onClick={() => setSlideIdx((i) => Math.max(0, i - 1))} data-testid="visual-prev"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-zinc-300 hover:text-white"><ChevronLeft size={16} /></button>
                <button onClick={() => setSlideIdx((i) => Math.min(data.slides.length, i + 1))} data-testid="visual-next"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-zinc-300 hover:text-white"><ChevronRight size={16} /></button>
              </div>
            )}

            {data && (
              <div className="mt-5 flex gap-2">
                <Button variant="secondary" onClick={download} disabled={exporting} data-testid="visual-download"
                  className="gap-2 rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10">
                  {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} PNG
                </Button>
                <Button onClick={useInPost} disabled={exporting} data-testid="visual-use"
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

function patternStyle(theme) {
  if (theme.pattern === "grid") return { backgroundImage: "linear-gradient(rgba(0,0,0,0.06) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,0.06) 1px,transparent 1px)", backgroundSize: "28px 28px" };
  if (theme.pattern === "dots") return { backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)", backgroundSize: "26px 26px" };
  if (theme.pattern === "chalk") return { backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)", backgroundSize: "30px 30px" };
  return {};
}

function VisualCanvas({ template, theme, data, slideIdx, loading }) {
  const base = { background: theme.bg, color: theme.fg };
  const patt = patternStyle(theme);

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center" style={base}>
        <Loader2 className="animate-spin" style={{ color: theme.accent }} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex h-full w-full items-center justify-center text-center" style={base}>
        <span style={{ color: theme.sub, fontSize: 13, padding: 24 }}>Generate copy to see your visual here</span>
      </div>
    );
  }

  if (template === "quote") {
    return (
      <div className="relative flex h-full w-full flex-col justify-between p-9" style={base}>
        <div className="absolute inset-0" style={patt} />
        <div className="relative font-display" style={{ fontSize: 64, lineHeight: 1, color: theme.accent }}>“</div>
        <div className="relative">
          <p className="font-display" style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.25 }}>{data.quote}</p>
        </div>
        <div className="relative flex items-center justify-between">
          <span style={{ color: theme.sub, fontSize: 14, fontWeight: 600 }}>— {data.author}</span>
          <span style={{ color: theme.accent, fontSize: 11, fontFamily: "JetBrains Mono, monospace", letterSpacing: 2 }}>CREATEOS</span>
        </div>
      </div>
    );
  }

  if (template === "tweet") {
    return (
      <div className="flex h-full w-full flex-col justify-center p-9" style={base}>
        <div className="flex items-center gap-3">
          <div style={{ height: 52, width: 52, borderRadius: 999, background: "linear-gradient(135deg,#E2FF3D,#C4B5FD)" }} />
          <div>
            <div className="flex items-center gap-1" style={{ fontSize: 17, fontWeight: 700 }}>{data.name}<BadgeCheck size={16} style={{ color: "#1DA1F2" }} /></div>
            <div style={{ color: theme.sub, fontSize: 14 }}>{data.handle}</div>
          </div>
          <Twitter size={22} className="ml-auto" style={{ color: theme.sub }} />
        </div>
        <p className="mt-5 font-display" style={{ fontSize: 25, lineHeight: 1.35, fontWeight: 500 }}>{data.text}</p>
        <div className="mt-6" style={{ color: theme.sub, fontSize: 13 }}>9:41 AM · CreateOS</div>
      </div>
    );
  }

  if (template === "infographic") {
    return (
      <div className="relative flex h-full w-full flex-col p-9" style={base}>
        <div className="absolute inset-0" style={patt} />
        <div className="relative font-mono" style={{ color: theme.accent, fontSize: 11, letterSpacing: 3 }}>INFOGRAPHIC</div>
        <h2 className="relative mt-3 font-display" style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.05 }}>{data.title}</h2>
        <div className="relative mt-6 flex flex-1 flex-col justify-center gap-3">
          {(data.points || []).map((p, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="flex-shrink-0 font-display" style={{ background: theme.accent, color: "#0A0A0A", fontWeight: 800, width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>{i + 1}</span>
              <span style={{ fontSize: 17, lineHeight: 1.3, fontWeight: 500 }}>{p}</span>
            </div>
          ))}
        </div>
        <div className="relative font-mono" style={{ color: theme.sub, fontSize: 11, letterSpacing: 2 }}>CREATEOS.STUDIO</div>
      </div>
    );
  }

  // carousel / slideshow deck
  const slides = data.slides || [];
  const isCover = slideIdx === 0;
  const slide = isCover ? null : slides[slideIdx - 1];
  return (
    <div className="relative flex h-full w-full flex-col justify-between p-9" style={base}>
      <div className="absolute inset-0" style={patt} />
      <div className="relative flex items-center justify-between font-mono" style={{ color: theme.accent, fontSize: 11, letterSpacing: 2 }}>
        <span>{isCover ? "SWIPE →" : `${slideIdx}/${slides.length}`}</span>
        <span style={{ color: theme.sub }}>CREATEOS</span>
      </div>
      <div className="relative flex flex-1 flex-col justify-center">
        {isCover ? (
          <h2 className="font-display" style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.05 }}>{data.title}</h2>
        ) : (
          <>
            <h3 className="font-display" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1 }}>{slide?.heading}</h3>
            <p className="mt-4" style={{ fontSize: 18, lineHeight: 1.4, color: theme.sub }}>{slide?.body}</p>
          </>
        )}
      </div>
      <div className="relative flex gap-1.5">
        {Array.from({ length: slides.length + 1 }).map((_, i) => (
          <span key={i} style={{ height: 4, flex: 1, borderRadius: 4, background: i === slideIdx ? theme.accent : "rgba(150,150,150,0.3)" }} />
        ))}
      </div>
    </div>
  );
}
