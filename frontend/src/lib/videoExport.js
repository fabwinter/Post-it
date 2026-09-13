import { API } from "@/lib/api";
import { ASPECT_RATIO } from "@/components/VisualCard";
import { normalizeClip, filterCss, frameAt, transitionFrame } from "@/lib/videoClip";

// Turning an edited reel into a file you can actually post.
//
// There's no encoder on the backend (the Python runtime has no ffmpeg), and
// ffmpeg.wasm is a non-starter here: it needs cross-origin isolation, and
// turning that on would cut the app off from the stock footage and blob
// storage it loads from other origins. So the encode happens where the
// footage already is — in the browser, on a canvas, through MediaRecorder.
//
// Each output frame is composited the same way the card stacks its layers:
// background, then the clip at its own grade/framing/opacity, then the
// overlays. Transitions come from the same transitionFrame() the player
// uses, so what you watched in the preview is what lands in the file.

// Preference order, not a hard list — whatever the browser actually has is
// negotiated at runtime. H.264 in MP4 is worth asking for first because
// it's what every social platform wants; WebM is the honest fallback on a
// browser without the proprietary codec.
const MIME_CANDIDATES = [
  { mime: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", ext: "mp4" },
  { mime: "video/mp4;codecs=avc1.42E01E", ext: "mp4" },
  { mime: "video/mp4;codecs=avc1", ext: "mp4" },
  { mime: "video/mp4", ext: "mp4" },
  { mime: "video/webm;codecs=vp9,opus", ext: "webm" },
  { mime: "video/webm;codecs=vp9", ext: "webm" },
  { mime: "video/webm;codecs=vp8,opus", ext: "webm" },
  { mime: "video/webm;codecs=vp8", ext: "webm" },
  { mime: "video/webm", ext: "webm" },
];

export function pickRecorderMime() {
  if (typeof MediaRecorder === "undefined") return null;
  return MIME_CANDIDATES.find((c) => {
    try { return MediaRecorder.isTypeSupported(c.mime); } catch { return false; }
  }) || null;
}

export function exportSupported() {
  return typeof MediaRecorder !== "undefined"
    && typeof document !== "undefined"
    && typeof document.createElement("canvas").captureStream === "function"
    && !!pickRecorderMime();
}

// Vertical is the shape a reel is watched in, so the presets are heights and
// the width follows the post's own aspect rather than the other way round.
export const EXPORT_PRESETS = [
  { key: "720", label: "720p", height: 1280 },
  { key: "1080", label: "1080p", height: 1920 },
  { key: "480", label: "480p", height: 854 },
];

// Canvas dimensions for a post's aspect at a chosen height, both rounded to
// even numbers — odd dimensions are rejected outright by some H.264 encoders.
export function exportDimensions(aspect, height) {
  const ratio = ASPECT_RATIO[aspect] || 1; // height / width
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(height / ratio), height: even(height) };
}

// Anything cross-origin drawn to a canvas taints it, and a tainted canvas
// can't be captured at all — so every clip is pulled back through the app's
// own media proxy, which is exactly what that endpoint exists for.
export function proxied(url) {
  if (!url) return url;
  if (url.startsWith("blob:") || url.startsWith("data:")) return url;
  try {
    const u = new URL(url, window.location.href);
    if (u.origin === window.location.origin) return url;
  } catch { /* not absolute — treat as same-origin */ return url; }
  return `${API}/proxy-image?url=${encodeURIComponent(url)}`;
}

// object-fit, done by hand: the canvas has no such property, and getting
// this wrong is the difference between footage that matches the preview and
// footage that's silently stretched.
function drawFitted(ctx, source, sw, sh, W, H, fit) {
  if (!sw || !sh) return;
  const scale = fit === "contain" ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh);
  const w = sw * scale;
  const h = sh * scale;
  ctx.drawImage(source, (W - w) / 2, (H - h) / 2, w, h);
}

// One scene, drawn in the card's own layer order. `f` is that scene's half
// of the crossover (opacity, slide, zoom, wipe) from transitionFrame.
function drawScene(ctx, scene, f, W, H) {
  const { bgImage, contentImage, video, clip } = scene;
  ctx.save();
  if (f.clipLeft) {
    ctx.beginPath();
    ctx.rect(f.clipLeft * W, 0, W - f.clipLeft * W, H);
    ctx.clip();
  }
  if (f.tx || f.scale !== 1) {
    ctx.translate(W / 2 + f.tx * W, H / 2);
    ctx.scale(f.scale, f.scale);
    ctx.translate(-W / 2, -H / 2);
  }
  ctx.globalAlpha = f.opacity;
  if (bgImage) ctx.drawImage(bgImage, 0, 0, W, H);
  if (video && video.readyState >= 2 && video.videoWidth) {
    ctx.save();
    ctx.globalAlpha = f.opacity * clip.opacity;
    const grade = filterCss(clip.effects);
    if (grade) ctx.filter = grade;
    drawFitted(ctx, video, video.videoWidth, video.videoHeight, W, H, clip.fit);
    ctx.restore();
  }
  ctx.globalAlpha = f.opacity;
  if (contentImage) ctx.drawImage(contentImage, 0, 0, W, H);
  ctx.restore();
  ctx.globalAlpha = 1;
}

// Composites the moment at `t`. Split out so a test — or a future
// frame-accurate encoder — can ask for a single frame without recording.
export function drawFrame(ctx, scenes, items, t, W, H) {
  const at = frameAt(items, t);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  if (!at) return;
  const tx = transitionFrame(at.cur.clip.transition.type, at.p);
  if (at.inTransition && at.prev && tx.under) drawScene(ctx, scenes[at.prev.index], tx.under, W, H);
  drawScene(ctx, scenes[at.cur.index], at.inTransition ? tx.over : { opacity: 1, tx: 0, scale: 1, clipLeft: 0 }, W, H);
  if (at.inTransition && tx.veil > 0) {
    ctx.save();
    ctx.globalAlpha = tx.veil;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("layer image failed to load"));
    img.src = src;
  });
}

// A clip element ready to be drawn from. Resolves as soon as there are
// frames to read; a clip that never loads resolves null rather than
// failing the whole export — one missing source shouldn't lose the reel.
function loadVideo(url, { muted }) {
  return new Promise((resolve) => {
    const el = document.createElement("video");
    el.crossOrigin = "anonymous";
    el.preload = "auto";
    el.playsInline = true;
    el.muted = muted;
    el.src = proxied(url);
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    el.addEventListener("loadeddata", () => done(el), { once: true });
    el.addEventListener("error", () => done(null), { once: true });
    setTimeout(() => done(el.readyState >= 2 ? el : null), 15000);
    el.load();
  });
}

export async function prepareScenes(items, layers, { onProgress } = {}) {
  const scenes = [];
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    const clip = normalizeClip(it.clip);
    const [bgImage, contentImage] = await Promise.all([
      layers[it.index]?.bg ? loadImage(layers[it.index].bg) : null,
      layers[it.index]?.content ? loadImage(layers[it.index].content) : null,
    ]);
    const video = clip.url ? await loadVideo(clip.url, { muted: clip.volume === 0 }) : null;
    scenes[it.index] = { bgImage, contentImage, video, clip, item: it };
    onProgress?.((i + 1) / items.length);
  }
  return scenes;
}

// Keeps each clip rolling at the point of the source the timeline implies —
// the same job the player's syncVideos does, kept separate because the
// exporter has no React state to hang it off.
function syncScenes(scenes, items, t, playing) {
  items.forEach((it) => {
    const s = scenes[it.index];
    if (!s?.video) return;
    const onScreen = t >= it.start - 0.001 && t < it.end;
    if (!onScreen) { if (!s.video.paused) s.video.pause(); return; }
    const c = s.clip;
    const want = c.start + Math.max(0, t - it.start) * c.speed;
    const cap = c.end ?? (s.video.duration || Infinity);
    const target = Math.min(want, cap - 0.05);
    if (Number.isFinite(target) && Math.abs(s.video.currentTime - target) > 0.3) {
      try { s.video.currentTime = Math.max(0, target); } catch { /* not seekable yet */ }
    }
    s.video.playbackRate = c.speed;
    if (playing && s.video.paused) s.video.play().catch(() => {});
    if (!playing && !s.video.paused) s.video.pause();
  });
}

// Any clip with its volume up gets mixed into the recording. Wrapped in its
// own try/catch because a browser refusing the audio graph should cost the
// soundtrack, not the export.
function buildAudioTrack(scenes) {
  const withSound = scenes.filter((s) => s?.video && s.clip.volume > 0);
  if (!withSound.length) return { track: null, ctx: null };
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const actx = new AudioCtx();
    const dest = actx.createMediaStreamDestination();
    withSound.forEach((s) => {
      const src = actx.createMediaElementSource(s.video);
      const gain = actx.createGain();
      gain.gain.value = s.clip.volume;
      src.connect(gain).connect(dest);
      s.video.muted = false;
    });
    return { track: dest.stream.getAudioTracks()[0] || null, ctx: actx };
  } catch {
    return { track: null, ctx: null };
  }
}

// Records the reel in real time. MediaRecorder captures a live stream, so
// this takes as long as the reel runs — the progress callback is what makes
// that legible rather than a frozen dialog.
export function recordReel({ canvas, scenes, items, total, fps = 30, onProgress, isCancelled }) {
  return new Promise((resolve, reject) => {
    const picked = pickRecorderMime();
    if (!picked) { reject(new Error("This browser can't record video.")); return; }
    const ctx = canvas.getContext("2d", { alpha: false });
    const W = canvas.width;
    const H = canvas.height;

    const stream = canvas.captureStream(fps);
    const { track: audioTrack, ctx: audioCtx } = buildAudioTrack(scenes);
    if (audioTrack) stream.addTrack(audioTrack);

    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: picked.mime, videoBitsPerSecond: 8_000_000 });
    } catch (e) { reject(e); return; }

    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onerror = (e) => reject(e.error || new Error("Recording failed"));

    let raf = 0;
    const cleanup = () => {
      cancelAnimationFrame(raf);
      scenes.forEach((s) => { if (s?.video && !s.video.paused) s.video.pause(); });
      stream.getTracks().forEach((tr) => tr.stop());
      if (audioCtx) audioCtx.close().catch(() => {});
    };

    recorder.onstop = () => {
      cleanup();
      resolve({ blob: new Blob(chunks, { type: picked.mime }), ext: picked.ext, mime: picked.mime });
    };

    // Draw the opening frame and give the clips a moment to actually be at
    // their first frame before the recorder starts, so the file doesn't open
    // on black.
    drawFrame(ctx, scenes, items, 0, W, H);
    syncScenes(scenes, items, 0, false);

    setTimeout(() => {
      recorder.start(250);
      const t0 = performance.now();
      const tick = (now) => {
        const t = (now - t0) / 1000;
        if (isCancelled?.()) { recorder.stop(); return; }
        if (t >= total) {
          drawFrame(ctx, scenes, items, Math.max(0, total - 0.001), W, H);
          onProgress?.(1);
          // One extra beat so the final frame is definitely in the stream
          // before the recorder is told to stop.
          setTimeout(() => recorder.stop(), 120);
          return;
        }
        syncScenes(scenes, items, t, true);
        drawFrame(ctx, scenes, items, t, W, H);
        onProgress?.(t / total);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, 250);
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
