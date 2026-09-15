import { useCallback, useEffect, useRef, useState } from "react";
import { toPng, getFontEmbedCSS } from "html-to-image";
import { Download, Loader2, X, Film, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VisualCard, themeFor } from "@/components/VisualCard";
import { CARD_REF_WIDTH } from "@/lib/slideElements";
import { reelTimeline, formatSeconds } from "@/lib/videoClip";
import {
  EXPORT_PRESETS, exportDimensions, exportSupported, pickRecorderMime,
  prepareScenes, recordReel, downloadBlob, loadMusic, missingMedia,
  noteExportRun, lastExportRun, clearExportRun, describeExportRun,
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

// A captioned scene needs one overlay screenshot per word it highlights —
// fine for the handful of words a reel line usually has, but a long line
// (or several scenes' worth of them) can pile up dozens of full-resolution
// PNGs in memory at once. Desktop browsers shrug that off; iOS Safari's
// much tighter per-tab memory ceiling can crash the whole page under it.
// Capping frames per scene bounds the worst case regardless of script
// length — short lines (the common case) are unaffected, since they never
// reach the cap.
const MAX_CAPTION_FRAMES = 4;

// The per-scene cap alone still scales with scene count: a six-scene reel
// at 720p holds six of these sets at once, and each frame is a full-size
// bitmap (720x1280 decodes to ~3.7MB however small the PNG itself is).
// That total is what actually crashed a 720p export.
//
// Budgeted in BYTES rather than frames, because a frame is not a fixed
// cost: the same 18-frame allowance is ~29MB at 480p and ~150MB at 1080p,
// so counting frames meant the cap did almost nothing exactly where it was
// needed most. This holds the line at the same ceiling whatever resolution
// is picked, and spends it on more caption steps when they're cheap.
const CAPTION_FRAME_BUDGET_BYTES = 40 * 1024 * 1024;

// Whether a CSS background value is a plain colour the canvas can fill
// directly, rather than something that genuinely has to be rasterised (a
// gradient, an image). Assigning an invalid value to fillStyle leaves the
// previous one in place, so setting it from two different starting points
// and comparing is the reliable way to ask the browser "is this a colour?"
let colorProbe = null;
function isPlainColor(value) {
  if (!value || typeof value !== "string") return false;
  if (/gradient|url\(|image-set/i.test(value)) return false;
  colorProbe = colorProbe || document.createElement("canvas").getContext("2d");
  colorProbe.fillStyle = "#000000";
  colorProbe.fillStyle = value;
  const fromBlack = colorProbe.fillStyle;
  colorProbe.fillStyle = "#ffffff";
  colorProbe.fillStyle = value;
  return colorProbe.fillStyle === fromBlack;
}

function pickCaptionWordIndices(count, max) {
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  const picked = new Set();
  for (let i = 0; i < max; i += 1) picked.add(Math.round((i * (count - 1)) / (max - 1)));
  return [...picked];
}

// How many caption frames one scene may spend, given how many scenes are
// competing for the same budget and how much each frame costs at this
// output size. Always at least one, so a captioned scene never silently
// loses its caption entirely.
function captionFrameBudget(captionedSceneCount, width, height) {
  if (captionedSceneCount <= 0) return MAX_CAPTION_FRAMES;
  const perFrameBytes = Math.max(1, width * height * 4);
  const affordable = Math.floor(CAPTION_FRAME_BUDGET_BYTES / perFrameBytes);
  return Math.max(1, Math.min(MAX_CAPTION_FRAMES, Math.floor(affordable / captionedSceneCount)));
}

// Neutralises the card's own background and hides the clip for the overlay
// pass. A stylesheet rule wins over the inline background VisualCard sets,
// which is what makes the overlay layer transparent without the card
// needing to know it's being exported.
const STAGE_CSS = `
.reel-export-content > div { background: transparent !important; }
.reel-export-content [data-export-backdrop] { display: none !important; }
`;

// Waits for a just-mounted card's images to actually be decodable. The stage
// now mounts one scene at a time (see the stage below), so a capture can
// otherwise beat its own logo to the screen — when every scene was mounted up
// front they had the whole run to load.
function waitForImages(node, timeoutMs = 8000) {
  const imgs = Array.from(node?.querySelectorAll?.("img") || []);
  return Promise.all(imgs.map((img) => (img.complete && img.naturalWidth
    ? Promise.resolve()
    : new Promise((resolve) => {
      const done = () => resolve();
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
      setTimeout(done, timeoutMs);
    }))));
}

export function ReelExportDialog({ open, onClose, assets, brand, aspect, title, music }) {
  const [preset, setPreset] = useState("720");
  const [phase, setPhase] = useState("idle"); // idle | preparing | recording | done | error
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  // What the render couldn't fetch. An export that silently drops the
  // footage, the voiceover or the score still produces a perfectly valid
  // file, which is exactly how a half-empty reel gets mistaken for a
  // finished one — so whatever went missing gets said out loud.
  const [missing, setMissing] = useState(null);
  // Which word the off-screen stage should highlight for a given scene while
  // capturing that scene's per-word caption frames — see `run()`.
  const [stageWordIndex, setStageWordIndex] = useState({});
  // Which scene is currently mounted on the off-screen stage. Only one is,
  // and only while it's being captured — see the capture loop in `run()`.
  const [stageIndex, setStageIndex] = useState(-1);
  // How far through capturing the scenes we are. Preparing used to say only
  // "Preparing scenes…" with a bar stuck at zero for its whole duration, so
  // a slow prep and a stalled render looked exactly alike — including to
  // someone trying to tell us which one they were watching.
  const [prepStep, setPrepStep] = useState(0);
  // What the last export was doing if it never finished. iOS kills a tab for
  // memory without an error, an unload event or a console — the page just
  // reloads empty — so the only account of a death like that is the trail the
  // render leaves behind as it goes. Shown here so it can be read back to us.
  const [lastRun, setLastRun] = useState(null);

  const bgRefs = useRef({});
  const contentRefs = useRef({});
  const cancelled = useRef(false);

  const { items, total } = reelTimeline(assets);
  const supported = exportSupported();
  const picked = pickRecorderMime();
  const height = EXPORT_PRESETS.find((p) => p.key === preset)?.height || 1280;
  const dims = exportDimensions(aspect, height);

  useEffect(() => {
    if (open) {
      const run = lastExportRun();
      setLastRun(run && run.stage !== "done" ? run : null);
      return;
    }
    setPhase("idle"); setProgress(0); setError(""); setResult(null); setMissing(null);
    cancelled.current = false; setStageWordIndex({}); setStageIndex(-1); setPrepStep(0);
  }, [open]);

  const run = useCallback(async () => {
    cancelled.current = false;
    // Open the audio context HERE, synchronously, before the first await —
    // this runs inside the tap that started the export, and that tap is the
    // only moment iOS will let a context start. Preparing the scenes takes
    // long enough that by the time recording begins the activation is long
    // gone, and a resume() the autoplay policy refuses there never settles
    // at all: it hangs, taking the whole export with it.
    let audioContext = null;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        audioContext = new AudioCtx();
        audioContext.resume?.().catch(() => {});
      }
    } catch { audioContext = null; }
    let handedToRecorder = false;
    setError(""); setResult(null); setMissing(null); setProgress(0); setPrepStep(0); setPhase("preparing");
    setLastRun(null);
    try {
      // Webfonts have to be resolved before rasterising or the overlay layer
      // bakes in a fallback face that the preview never showed.
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise((r) => setTimeout(r, 120));

      // Drop the clip from the clone rather than just hiding it. html-to-image
      // inlines every source it walks, so a hidden backdrop still meant
      // base64-ing the whole video into the overlay PNG once per scene — slow
      // enough to look like a hang. The real frames are composited underneath
      // this layer at record time anyway.
      const dropBackdrop = (node) => !(node instanceof Element && node.hasAttribute("data-export-backdrop"));
      const contentOpts = (opts) => ({ ...opts, backgroundColor: undefined, filter: dropBackdrop });

      const perSceneCaptionFrames = captionFrameBudget(
        items.filter((it) => it.asset?.spec?.voice?.words?.length).length,
        dims.width, dims.height,
      );

      // Resolve the page's web fonts ONCE and hand the result to every
      // capture. Left to itself, html-to-image re-walks every stylesheet and
      // re-inlines every @font-face on each call — and this app's custom faces
      // carry the whole font file as a base64 data URL, so that is megabytes
      // of parsing and re-encoding per screenshot. On a seven-scene reel that
      // repeated work is most of the minutes an export spends before it ever
      // starts recording, which is where a phone was giving up.
      // undefined = not tried yet, null = tried and failed (fall back to
      // html-to-image's own per-call embedding rather than lose the faces).
      let fontEmbedCSS;

      const layers = {};
      for (const it of items) {
        // One scene on the stage at a time. Every scene used to be mounted at
        // the full output size for the whole export — seven live 720x1280
        // cards, each with its own backdrop element and logo, is a lot of a
        // phone's memory spent on DOM that only one screenshot at a time ever
        // reads.
        setStageIndex(it.index);
        setPrepStep(items.indexOf(it) + 1);
        noteExportRun({
          stage: "preparing", scene: items.indexOf(it) + 1, scenes: items.length,
          width: dims.width, height: dims.height,
        });
        // Capturing is the long pole of an export, so it owns most of the
        // preparing bar; decoding those shots into bitmaps gets the rest.
        setProgress(((items.indexOf(it)) / Math.max(1, items.length)) * 0.3);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        // eslint-disable-next-line no-await-in-loop
        await waitForImages(contentRefs.current[it.index]);
        if (cancelled.current) { setPhase("idle"); setStageIndex(-1); return; }

        if (fontEmbedCSS === undefined) {
          try {
            // eslint-disable-next-line no-await-in-loop
            fontEmbedCSS = await getFontEmbedCSS(contentRefs.current[it.index] || bgRefs.current[it.index]);
          } catch { fontEmbedCSS = null; }
        }

        // cacheBust appends a unique query to every source, which defeats the
        // browser cache and refetches the same logo once per screenshot.
        const opts = {
          pixelRatio: 1, width: dims.width, height: dims.height,
          ...(fontEmbedCSS ? { fontEmbedCSS } : {}),
        };
        // A scene whose background is one flat colour does not need a
        // full-resolution screenshot to say so. Every one of those decoded to
        // a bitmap the size of the output (~3.7MB at 720p) and was held for
        // the whole export, so a six-scene reel spent ~22MB saying "this
        // scene is #0A0A0A" six times. The canvas can just fill the colour.
        // Anything that genuinely needs pixels — a gradient, an image — still
        // gets rasterised.
        const flat = it.asset?.spec?.bg_color || themeFor(it.asset?.spec?.theme, brand).bg;
        const bgColor = isPlainColor(flat) ? flat : null;
        const bg = bgColor || !bgRefs.current[it.index]
          ? null
          : await toPng(bgRefs.current[it.index], opts);
        const words = it.asset?.spec?.voice?.words;
        // A captioned scene highlights a different word over its own
        // lifetime, and that highlight is baked into the DOM screenshot
        // (same renderer as the preview) rather than drawn separately — so
        // it needs one overlay frame per word instead of one for the whole
        // scene. Scenes are short and word counts small, so this stays a
        // handful of extra screenshots, not hundreds.
        if (words?.length && contentRefs.current[it.index]) {
          const frames = [];
          const indices = pickCaptionWordIndices(words.length, perSceneCaptionFrames);
          for (const w of indices) {
            setStageWordIndex((s) => ({ ...s, [it.index]: w }));
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            try {
              // eslint-disable-next-line no-await-in-loop
              const image = await toPng(contentRefs.current[it.index], contentOpts(opts));
              frames.push({ image, start: words[w].start, end: words[w].end });
            } catch { /* this word's frame is skipped; the scene still uses whichever frames it got */ }
            if (cancelled.current) { setPhase("idle"); return; }
          }
          if (frames.length) {
            layers[it.index] = { bg, bgColor, contentFrames: frames };
          } else {
            // Every captioned frame failed to capture — fall back to one
            // plain (uncaptioned) screenshot rather than losing the scene.
            // eslint-disable-next-line no-await-in-loop
            const content = await toPng(contentRefs.current[it.index], contentOpts(opts)).catch(() => null);
            layers[it.index] = { bg, bgColor, content };
          }
        } else {
          const content = contentRefs.current[it.index] ? await toPng(contentRefs.current[it.index], contentOpts(opts)) : null;
          layers[it.index] = { bg, bgColor, content };
        }
        if (cancelled.current) { setPhase("idle"); setStageIndex(-1); return; }
      }
      // Nothing left to screenshot, so give the stage's DOM back before the
      // recording — which needs every megabyte it can get — begins.
      setStageIndex(-1);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const [scenes, musicEl] = await Promise.all([
        prepareScenes(items, layers, { onProgress: (p) => setProgress(0.3 + p * 0.1) }),
        loadMusic(music?.url),
      ]);
      if (cancelled.current) { setPhase("idle"); return; }

      const canvas = document.createElement("canvas");
      canvas.width = dims.width;
      canvas.height = dims.height;

      setPhase("recording");
      // From here recordReel owns the context and closes it when it cleans up.
      handedToRecorder = true;
      const out = await recordReel({
        canvas, scenes, items, total, fps: 30, audioContext,
        onProgress: (p) => setProgress(p),
        isCancelled: () => cancelled.current,
        musicEl, musicVolume: music?.volume,
      });
      if (cancelled.current) { setPhase("idle"); return; }
      setResult(out);
      setMissing(missingMedia(scenes, { musicWanted: !!music?.url, musicEl }));
      setPhase("done");
    } catch (e) {
      setStageIndex(-1);
      setError(e?.message || "Export failed");
      setPhase("error");
    } finally {
      // Reaching here at all means JavaScript is still running, so whatever
      // happened, the tab was not killed — close the breadcrumb out so the
      // next open doesn't report a crash that didn't happen.
      noteExportRun({ stage: "done" });
      // An export abandoned before recording began still opened a context,
      // and iOS only allows a handful at a time — so a few cancelled runs
      // would otherwise leave the next one unable to open one at all.
      if (!handedToRecorder && audioContext) audioContext.close().catch(() => {});
    }
  }, [items, total, dims.width, dims.height, brand, music?.url, music?.volume]);

  if (!open) return null;

  const busy = phase === "preparing" || phase === "recording";
  const safeName = (title || "reel").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || "reel";
  const missingSummary = (() => {
    if (!missing) return "";
    const parts = [];
    if (missing.clips) parts.push(missing.clips === 1 ? "1 scene's footage" : `${missing.clips} scenes' footage`);
    if (missing.voices) parts.push(missing.voices === 1 ? "1 voiceover" : `${missing.voices} voiceovers`);
    if (missing.music) parts.push("the background score");
    if (!parts.length) return "";
    return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  })();

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
                  {phase === "preparing"
                    ? `Preparing scene ${Math.max(1, prepStep)} of ${items.length}…`
                    : `Recording… ${Math.round(progress * 100)}%`}
                </div>
              </div>
            )}

            {phase === "idle" && lastRun && (
              <div className="mt-4 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200"
                data-testid="reel-export-lastrun">
                <AlertTriangle size={14} className="mt-0.5 flex-none" />
                <span className="min-w-0">
                  The last render stopped without finishing, at{" "}
                  <span className="font-mono break-words text-amber-100">{describeExportRun(lastRun)}</span>.
                  A lower resolution is the quickest thing to try.{" "}
                  <button type="button" className="underline underline-offset-2"
                    onClick={() => { clearExportRun(); setLastRun(null); }}
                    data-testid="reel-export-lastrun-dismiss">Dismiss</button>
                </span>
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

            {phase === "done" && missingSummary && (
              <div className="mt-2 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200"
                data-testid="reel-export-missing">
                <AlertTriangle size={14} className="mt-0.5 flex-none" />
                <span>
                  The file is missing {missingSummary}. It downloaded everything else — try rendering
                  again, and if it keeps happening the source may be too large or offline.
                </span>
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
          upscaled preview — and ONE scene at a time, because at that size it
          is not a cheap thing to have lying around. Mounting the whole reel
          meant a phone holding seven live 720x1280 cards, each with its own
          backdrop element and logo, for the entire export, when only the
          scene being screenshotted is ever read. */}
      <div style={STAGE_STYLE} aria-hidden data-testid="reel-export-stage">
        <style>{STAGE_CSS}</style>
        {items.filter((it) => it.index === stageIndex).map((it) => {
          const spec = it.asset.spec;
          const bg = spec.bg_color || themeFor(spec.theme, brand).bg;
          return (
            <div key={it.index}>
              <div ref={(el) => { bgRefs.current[it.index] = el; }}
                style={{ width: dims.width, height: dims.height, background: bg }} />
              <div ref={(el) => { contentRefs.current[it.index] = el; }} className="reel-export-content"
                style={{ width: dims.width, height: dims.height }}>
                <VisualCard spec={spec} brand={brand} scale={dims.width / CARD_REF_WIDTH}
                  activeWordIndex={stageWordIndex[it.index] ?? -1} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
