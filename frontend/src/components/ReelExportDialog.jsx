import { useCallback, useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { Download, Loader2, X, Film, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VisualCard, themeFor } from "@/components/VisualCard";
import { CARD_REF_WIDTH } from "@/lib/slideElements";
import { reelTimeline, formatSeconds } from "@/lib/videoClip";
import {
  EXPORT_PRESETS, exportDimensions, exportSupported, pickRecorderMime,
  prepareScenes, recordReel, downloadBlob,
} from "@/lib/videoExport";

// Renders the reel to a real video file.
//
// The trick to matching the preview exactly is not re-implementing the card
// renderer against a canvas, but reusing it: each scene is rasterised twice
// off-screen by the same VisualCard the app already draws — once for what
// sits behind the footage, once for the overlays that sit on top — and the
// exporter composites the live clip frames between those two layers. So a
// font, a shadow or a sticker only has to be right in one renderer.

const STAGE_STYLE = { position: "fixed", left: -99999, top: 0, opacity: 0, pointerEvents: "none", zIndex: -1 };

// Neutralises the card's own background and hides the clip for the overlay
// pass. A stylesheet rule wins over the inline background VisualCard sets,
// which is what makes the overlay layer transparent without the card
// needing to know it's being exported.
const STAGE_CSS = `
.reel-export-content > div { background: transparent !important; }
.reel-export-content [data-export-backdrop] { display: none !important; }
`;

export function ReelExportDialog({ open, onClose, assets, brand, aspect, title }) {
  const [preset, setPreset] = useState("720");
  const [phase, setPhase] = useState("idle"); // idle | preparing | recording | done | error
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const bgRefs = useRef({});
  const contentRefs = useRef({});
  const cancelled = useRef(false);

  const { items, total } = reelTimeline(assets);
  const supported = exportSupported();
  const picked = pickRecorderMime();
  const height = EXPORT_PRESETS.find((p) => p.key === preset)?.height || 1280;
  const dims = exportDimensions(aspect, height);

  useEffect(() => {
    if (!open) { setPhase("idle"); setProgress(0); setError(""); setResult(null); cancelled.current = false; }
  }, [open]);

  const run = useCallback(async () => {
    cancelled.current = false;
    setError(""); setResult(null); setProgress(0); setPhase("preparing");
    try {
      // Webfonts have to be resolved before rasterising or the overlay layer
      // bakes in a fallback face that the preview never showed.
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise((r) => setTimeout(r, 120));

      const layers = {};
      for (const it of items) {
        const opts = { pixelRatio: 1, cacheBust: true, width: dims.width, height: dims.height };
        layers[it.index] = {
          bg: bgRefs.current[it.index] ? await toPng(bgRefs.current[it.index], opts) : null,
          content: contentRefs.current[it.index]
            ? await toPng(contentRefs.current[it.index], {
              ...opts,
              backgroundColor: undefined,
              // Drop the clip from the clone rather than just hiding it.
              // html-to-image inlines every source it walks, so a hidden
              // backdrop still meant base64-ing the whole video into the
              // overlay PNG once per scene — slow enough to look like a
              // hang. The real frames are composited underneath this layer
              // at record time anyway.
              filter: (node) => !(node instanceof Element && node.hasAttribute("data-export-backdrop")),
            })
            : null,
        };
        if (cancelled.current) { setPhase("idle"); return; }
      }

      const scenes = await prepareScenes(items, layers, { onProgress: (p) => setProgress(p * 0.4) });
      if (cancelled.current) { setPhase("idle"); return; }

      const canvas = document.createElement("canvas");
      canvas.width = dims.width;
      canvas.height = dims.height;

      setPhase("recording");
      const out = await recordReel({
        canvas, scenes, items, total, fps: 30,
        onProgress: (p) => setProgress(p),
        isCancelled: () => cancelled.current,
      });
      if (cancelled.current) { setPhase("idle"); return; }
      setResult(out);
      setPhase("done");
    } catch (e) {
      setError(e?.message || "Export failed");
      setPhase("error");
    }
  }, [items, total, dims.width, dims.height]);

  if (!open) return null;

  const busy = phase === "preparing" || phase === "recording";
  const safeName = (title || "reel").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || "reel";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" data-testid="reel-export">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#121212] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">Export reel</div>
            <h2 className="mt-1 font-display text-lg font-semibold">{formatSeconds(total)} · {items.length} scenes</h2>
          </div>
          <button onClick={() => { cancelled.current = true; onClose(); }} data-testid="reel-export-close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {!supported ? (
          <div className="mt-4 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200"
            data-testid="reel-export-unsupported">
            <AlertTriangle size={14} className="mt-0.5 flex-none" />
            <span>This browser can't record video. Chrome, Edge and Safari can — Firefox's recorder doesn't expose a format we can write.</span>
          </div>
        ) : (
          <>
            <div className="mt-4">
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">Resolution</span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {EXPORT_PRESETS.map((p) => {
                  const d = exportDimensions(aspect, p.height);
                  return (
                    <button key={p.key} onClick={() => setPreset(p.key)} disabled={busy}
                      data-testid={`reel-export-preset-${p.key}`}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40 ${
                        preset === p.key ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"
                      }`}>
                      {p.label} <span className="text-zinc-600">{d.width}×{d.height}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-600" data-testid="reel-export-note">
                Recorded in real time, so this takes about {formatSeconds(total)} — leave the tab in front while it runs.
                Your browser writes <span className="font-mono text-zinc-500">.{picked?.ext}</span>.
              </p>
            </div>

            {busy && (
              <div className="mt-4">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-lime transition-[width] duration-200"
                    style={{ width: `${Math.round(progress * 100)}%` }} data-testid="reel-export-bar" />
                </div>
                <div className="mt-1.5 font-mono text-[10px] text-zinc-500" data-testid="reel-export-phase">
                  {phase === "preparing" ? "Preparing scenes…" : `Recording… ${Math.round(progress * 100)}%`}
                </div>
              </div>
            )}

            {phase === "error" && (
              <div className="mt-4 rounded-lg border border-magic/30 bg-magic/5 p-3 text-xs text-magic" data-testid="reel-export-error">
                {error}
              </div>
            )}

            {phase === "done" && result && (
              <div className="mt-4 rounded-lg border border-lime/30 bg-lime/5 p-3 text-xs text-lime" data-testid="reel-export-done">
                Done — {(result.blob.size / (1024 * 1024)).toFixed(1)}MB {result.ext.toUpperCase()}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {phase === "done" && result ? (
                <Button onClick={() => downloadBlob(result.blob, `${safeName}.${result.ext}`)}
                  data-testid="reel-export-download"
                  className="gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover">
                  <Download size={15} /> Save the file
                </Button>
              ) : (
                <Button onClick={run} disabled={busy || !items.length} data-testid="reel-export-start"
                  className="gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover">
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <Film size={15} />}
                  {busy ? "Rendering…" : "Render video"}
                </Button>
              )}
              {busy && (
                <Button variant="ghost" onClick={() => { cancelled.current = true; }} data-testid="reel-export-cancel"
                  className="text-xs text-zinc-400 hover:text-white">Cancel</Button>
              )}
              {phase === "done" && (
                <Button variant="ghost" onClick={run} data-testid="reel-export-again"
                  className="text-xs text-zinc-400 hover:text-white">Render again</Button>
              )}
            </div>
          </>
        )}
      </div>

      {/* The off-screen stage the two layers are rasterised from. Rendered at
          the real output size so text is sharp at 1080p rather than an
          upscaled preview. */}
      <div style={STAGE_STYLE} aria-hidden data-testid="reel-export-stage">
        <style>{STAGE_CSS}</style>
        {items.map((it) => {
          const spec = it.asset.spec;
          const bg = spec.bg_color || themeFor(spec.theme, brand).bg;
          return (
            <div key={it.index}>
              <div ref={(el) => { bgRefs.current[it.index] = el; }}
                style={{ width: dims.width, height: dims.height, background: bg }} />
              <div ref={(el) => { contentRefs.current[it.index] = el; }} className="reel-export-content"
                style={{ width: dims.width, height: dims.height }}>
                <VisualCard spec={spec} brand={brand} scale={dims.width / CARD_REF_WIDTH} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
