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
// can't be captured at all — so a clip the browser can't read directly is
// pulled back through the app's own media proxy, which is what that
// endpoint exists for.
//
// It is the FALLBACK, though, not the first choice: the proxy runs as a
// Vercel serverless function, and those cap their response body at ~4.5MB
// however large a file the handler itself is willing to fetch. A stock
// clip is routinely 5-50MB, a voiceover WAV a few MB, a generated music
// track more — so proxying those never returned them at all, and the
// export quietly composited what was left (the background and the text,
// which are local screenshots and never go near the proxy). That is
// exactly what "renders, but no footage, voiceover or music" looks like.
export function proxied(url) {
  if (!url) return url;
  if (url.startsWith("blob:") || url.startsWith("data:")) return url;
  try {
    const u = new URL(url, window.location.href);
    if (u.origin === window.location.origin) return url;
  } catch { /* not absolute — treat as same-origin */ return url; }
  return `${API}/proxy-image?url=${encodeURIComponent(url)}`;
}

// Whether a URL would go through the proxy at all — i.e. whether trying the
// origin directly is even a different request worth making.
function isProxied(url) {
  return !!url && proxied(url) !== url;
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

// A scene with word-synced captions has one overlay image per word (the
// highlight is baked into each, since it's a real DOM screenshot rather
// than drawn text) instead of the single static one every other scene
// uses. This picks whichever of those covers the moment being drawn.
function contentImageAt(scene, sceneTime) {
  if (scene.contentFrames && scene.contentFrames.length) {
    let chosen = scene.contentFrames[0];
    for (const fr of scene.contentFrames) {
      if (sceneTime >= fr.start) chosen = fr; else break;
    }
    return chosen.image;
  }
  return scene.contentImage;
}

// One scene, drawn in the card's own layer order. `f` is that scene's half
// of the crossover (opacity, slide, zoom, wipe) from transitionFrame.
function drawScene(ctx, scene, f, W, H, sceneTime) {
  const { bgImage, bgColor, video, clipImage, clip } = scene;
  const contentImage = contentImageAt(scene, sceneTime);
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
  // A flat-coloured scene carries its colour rather than a bitmap of it —
  // see the dialog's isPlainColor. Filling costs nothing and holds nothing.
  if (bgImage) ctx.drawImage(bgImage, 0, 0, W, H);
  else if (bgColor) { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, W, H); }
  // clipImage and video are mutually exclusive (clip.kind decides which one
  // prepareScenes loaded), but both are graded and framed identically — a
  // still and a video are the same kind of background to this renderer.
  if (clipImage || (video && video.readyState >= 2 && video.videoWidth)) {
    ctx.save();
    ctx.globalAlpha = f.opacity * clip.opacity;
    const grade = filterCss(clip.effects);
    if (grade) ctx.filter = grade;
    if (clipImage) drawFitted(ctx, clipImage, clipImage.naturalWidth, clipImage.naturalHeight, W, H, clip.fit);
    else drawFitted(ctx, video, video.videoWidth, video.videoHeight, W, H, clip.fit);
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
  if (at.inTransition && at.prev && tx.under) drawScene(ctx, scenes[at.prev.index], tx.under, W, H, t - at.prev.start);
  drawScene(ctx, scenes[at.cur.index], at.inTransition ? tx.over : { opacity: 1, tx: 0, scale: 1, clipLeft: 0 }, W, H, t - at.cur.start);
  if (at.inTransition && tx.veil > 0) {
    ctx.save();
    ctx.globalAlpha = tx.veil;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

function loadImage(src, { crossOrigin } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("layer image failed to load"));
    img.src = src;
  });
}

// A still clip loaded the same tolerant way loadVideoSrc is: resolves null
// on failure rather than rejecting, so one bad image doesn't sink the export.
// Direct from its own origin first, proxy second — same reasoning as
// loadMediaElement below.
async function loadClipImage(url) {
  const direct = await loadImage(url, { crossOrigin: "anonymous" }).catch(() => null);
  if (direct || !isProxied(url)) return direct;
  return loadImage(proxied(url), { crossOrigin: "anonymous" }).catch(() => null);
}

// Going through our own proxy means the server has to pull the whole file
// from wherever it actually lives before any of it reaches us, so a client
// timeout shorter than the server's own fetch timeout can only ever lose
// the race — which this used to do at 15s against the server's 45s. 55s
// clears that with room for real network latency on top of the fetch.
const MEDIA_LOAD_TIMEOUT_MS = 55000;

// The direct attempt is a plain CDN fetch with no server in the middle, so
// it doesn't need anything like the proxy's budget — and when it's going to
// fail it usually fails immediately (a CORS rejection needs one round trip).
// Kept short so falling back to the proxy is quick rather than a stall.
const DIRECT_LOAD_TIMEOUT_MS = 20000;

// Points a media element at one specific URL and reports whether it came
// back with something playable.
function attemptMediaLoad(el, src, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      el.removeEventListener("loadeddata", onLoaded);
      el.removeEventListener("error", onError);
      resolve(ok);
    };
    const onLoaded = () => finish(true);
    const onError = () => finish(false);
    el.addEventListener("loadeddata", onLoaded);
    el.addEventListener("error", onError);
    setTimeout(() => finish(el.readyState >= 2), timeoutMs);
    el.src = src;
    el.load();
  });
}

// Loads a clip/voiceover/score into a media element, trying the source's own
// origin before the proxy.
//
// Direct is the right default and not just an optimisation: the proxy caps
// out at Vercel's ~4.5MB serverless response limit (see proxied()), which
// most real footage and plenty of voice/music tracks exceed, so proxying
// them returns nothing at all. Fetching straight from the CDN has no such
// ceiling. It does need the origin to send CORS headers — both for canvas
// drawing and for Web Audio, which silently outputs nothing for a
// cross-origin element it isn't allowed to read — so when the direct
// attempt fails for any reason we fall back to exactly what this did
// before. Worst case is the old behaviour; best case is media that was
// never going to fit through the proxy now loads.
async function loadMediaElement(el, url) {
  if (await attemptMediaLoad(el, url, DIRECT_LOAD_TIMEOUT_MS)) return true;
  if (!isProxied(url)) return false;
  return attemptMediaLoad(el, proxied(url), MEDIA_LOAD_TIMEOUT_MS);
}

// A bare <video> element with no source yet. Split from actually loading a
// clip (loadVideoSrc, below) so the element itself — the object identity
// buildAudioTrack wires into the recording's Web Audio graph — can exist
// from the very start of the export, while the expensive part (fetching
// and decoding the real footage) happens only once a scene is actually
// about to need it. See recordReel's clip window for why.
function createVideoEl({ muted }) {
  const el = document.createElement("video");
  el.crossOrigin = "anonymous";
  el.preload = "auto";
  el.playsInline = true;
  el.muted = muted;
  return el;
}

// Points an already-created <video> element at a real clip and waits for
// its first frame. Resolves true/false rather than throwing — a clip that
// won't load leaves drawScene with nothing to draw for that layer, which it
// already handles, so one bad clip doesn't lose the reel. The caller records
// the false so the export can say what's missing instead of just shipping a
// reel with holes in it.
function loadVideoSrc(el, url) {
  return loadMediaElement(el, url);
}

// Drops a clip's source so the browser can free whatever decoder it was
// holding for it, without discarding the element itself (still wired into
// the audio graph if this scene's clip volume is audible). Recording only
// ever moves forward through the timeline, so once a scene's clip is
// released it is never needed — and never reloaded — again this pass.
function releaseVideoSrc(el) {
  if (!el) return;
  try { el.pause(); } catch { /* ignore */ }
  try { el.removeAttribute("src"); el.load(); } catch { /* ignore */ }
}

// An audio URL loaded into a playable element, the same tolerant way
// loadVideoSrc is — resolves null on failure so one bad take (or a reel
// with no music) can't sink the export. Shared by a scene's own voiceover
// and the reel's one background score; nothing about loading it differs.
// Kept eager (unlike clip video, see prepareScenes) — audio decode has none
// of a video decoder's resource ceiling, so there's nothing to bound here.
async function loadAudioClip(url) {
  const el = document.createElement("audio");
  el.crossOrigin = "anonymous";
  el.preload = "auto";
  return (await loadMediaElement(el, url)) ? el : null;
}

// Loads the reel's background score ahead of recording — public because it
// isn't scoped to a scene the way prepareScenes's own loads are, so the
// export dialog calls it directly rather than threading a music URL
// through prepareScenes's per-scene loop.
export function loadMusic(url) {
  return url ? loadAudioClip(url) : Promise.resolve(null);
}

// A captioned scene's per-word overlay screenshots, loaded into real
// Image elements the same way the single-overlay case is — each keeps the
// word's own start/end so drawScene can pick the one covering a given
// moment.
function loadContentFrames(frames) {
  if (!frames || !frames.length) return Promise.resolve(null);
  return Promise.all(frames.map(async (fr) => ({
    image: fr.image ? await loadImage(fr.image) : null,
    start: fr.start,
    end: fr.end,
  })));
}

export async function prepareScenes(items, layers, { onProgress } = {}) {
  const scenes = [];
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    const clip = normalizeClip(it.clip);
    const [bgImage, contentImage, contentFrames] = await Promise.all([
      layers[it.index]?.bg ? loadImage(layers[it.index].bg) : null,
      layers[it.index]?.content ? loadImage(layers[it.index].content) : null,
      loadContentFrames(layers[it.index]?.contentFrames),
    ]);
    // Each of those layers exists twice over at this point: once as the
    // base64 PNG string the caller screenshotted, and again as the decoded
    // bitmap just loaded from it. Only the bitmap gets drawn, so dropping
    // the caller's strings as each scene finishes roughly halves what the
    // export holds at its peak — which is what a 720p reel with captions
    // was running out of.
    const layer = layers[it.index];
    if (layer) {
      layer.bg = null;
      layer.content = null;
      layer.contentFrames = null;
    }
    const isStill = clip.url && clip.kind === "image";
    // The <video> element is created now (cheap — no source yet), but not
    // pointed at real footage until recordReel's clip window decides this
    // scene is actually coming up. Loading every clip here, up front, used
    // to mean a many-scene reel held every clip's decoder open for the
    // entire export regardless of how low the output resolution was set —
    // a clip decodes at ITS OWN source resolution, not the canvas it's
    // drawn into, and iOS Safari in particular caps how many video
    // decoders it will run at once. See recordReel for the load/release.
    const video = clip.url && !isStill ? createVideoEl({ muted: clip.volume === 0 }) : null;
    const clipImage = isStill ? await loadClipImage(clip.url) : null;
    const voiceUrl = it.asset?.spec?.voice?.url || "";
    const voice = voiceUrl ? await loadAudioClip(voiceUrl) : null;
    scenes[it.index] = {
      bgImage, bgColor: layers[it.index]?.bgColor || null,
      contentImage, contentFrames, video, clipImage, clip, voice, item: it,
      // What this scene was supposed to have but couldn't load, so the
      // export can report holes rather than quietly shipping them.
      clipFailed: !!(isStill && clip.url && !clipImage),
      voiceFailed: !!(voiceUrl && !voice),
      videoUrl: clip.url && !isStill ? clip.url : null,
      videoState: "idle", // idle | loading | loaded
    };
    onProgress?.((i + 1) / items.length);
  }
  return scenes;
}

// How far ahead of a scene's own start (seconds) its clip begins loading.
// Bounds how many clips are ever concurrently decoded to roughly however
// many scenes fall within this window, instead of every clip in the reel.
// Generous on purpose: a proxied stock clip fetching over a slow connection
// needs real head start, and the cost of starting early is at most a couple
// of extra concurrent decoders, not the whole reel's worth.
const CLIP_LOOKAHEAD_S = 4;

// How long past a scene's own end to keep its clip loaded before releasing
// it. An overlapping transition (dissolve/slide/zoom/wipe) can keep the
// outgoing clip on screen for up to its full transition duration — clamped
// to 3s in normalizeClip — after the incoming scene has already started, so
// this has to clear that with room to spare rather than matching it exactly.
const CLIP_RELEASE_MARGIN_S = 3.5;

// Loads a scene's clip if it doesn't have one yet, idempotently — safe to
// call every tick. Returns the in-flight (or already-resolved) load so a
// caller that needs this exact scene ready (the opening frame) can await it.
function ensureVideoLoaded(scene) {
  if (!scene?.video || !scene.videoUrl || scene.videoState !== "idle") return scene?.videoLoadPromise || Promise.resolve();
  scene.videoState = "loading";
  scene.videoLoadPromise = loadVideoSrc(scene.video, scene.videoUrl).then((ok) => {
    scene.videoState = "loaded";
    if (!ok) scene.clipFailed = true;
  });
  return scene.videoLoadPromise;
}

// What the finished reel is missing, for the dialog to report. Collected
// after recording rather than before, because a clip only finds out it
// can't load at the point the window actually reaches for it.
export function missingMedia(scenes, { musicWanted, musicEl } = {}) {
  const list = scenes.filter(Boolean);
  return {
    clips: list.filter((s) => s.clipFailed).length,
    voices: list.filter((s) => s.voiceFailed).length,
    music: !!musicWanted && !musicEl,
  };
}

// A played-out scene's overlay screenshots, dropped so the browser can
// reclaim them. These are the export's other bulk consumer besides the
// clips: every one decodes to a bitmap the size of the output (~3.7MB at
// 720p), a captioned scene holds one PER HIGHLIGHTED WORD, and until now
// every scene's whole set stayed resident from the moment it was captured
// to the moment the file was written — so the static layers alone scaled
// with scene count exactly the way the video decoders used to.
//
// Safe for the same reason releasing a clip is: recording only ever moves
// forward, so a scene behind the playhead is never drawn again.
function releaseSceneLayers(scene) {
  scene.bgImage = null;
  scene.contentImage = null;
  scene.contentFrames = null;
  scene.layersReleased = true;
}

// Kicks off loading for whichever scenes are coming up soon, and releases
// whatever is safely behind playback — clip and overlays alike. Called every
// recording tick; the checks are a handful of flag comparisons, cheap enough
// to run at frame rate, and the actual loads happen in the background.
function manageSceneWindow(scenes, items, t) {
  items.forEach((it) => {
    const s = scenes[it.index];
    if (!s) return;
    const behind = t > it.end + CLIP_RELEASE_MARGIN_S;
    if (s.video) {
      if (s.videoState === "idle" && t < it.end && it.start - t <= CLIP_LOOKAHEAD_S) {
        ensureVideoLoaded(s);
      } else if (s.videoState === "loaded" && behind) {
        releaseVideoSrc(s.video);
        s.videoState = "idle";
      }
    }
    if (behind && !s.layersReleased) releaseSceneLayers(s);
  });
}

// Keeps each clip rolling at the point of the source the timeline implies —
// the same job the player's syncVideos does, kept separate because the
// exporter has no React state to hang it off.
function syncScenes(scenes, items, t, playing) {
  items.forEach((it) => {
    const s = scenes[it.index];
    if (!s) return;
    const onScreen = t >= it.start - 0.001 && t < it.end;
    if (s.video) {
      if (!onScreen) { if (!s.video.paused) s.video.pause(); }
      else {
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
      }
    }
    // A voiceover plays straight through from its own start, once per
    // scene — no trim window or speed to honor, just "is this on screen."
    if (s.voice) {
      if (!onScreen) { if (!s.voice.paused) s.voice.pause(); }
      else {
        const target = Math.max(0, t - it.start);
        if (Number.isFinite(target) && Math.abs(s.voice.currentTime - target) > 0.3) {
          try { s.voice.currentTime = target; } catch { /* not seekable yet */ }
        }
        if (playing && s.voice.paused) s.voice.play().catch(() => {});
        if (!playing && !s.voice.paused) s.voice.pause();
      }
    }
  });
}

// Every source of sound a reel can have, mixed into one recording: a
// background clip with its volume turned up, every scene's own voiceover
// (always audible — there's no mute control for it, it's the point of the
// scene), and the reel's one background score at whatever level it was set
// to. Wrapped in its own try/catch because a browser refusing the audio
// graph should cost the soundtrack, not the export.
//
// The context this creates starts SUSPENDED whenever it's built without a
// live user gesture behind it — which is always, here: preparing the scenes
// takes seconds of fetching and screenshotting, so by the time recording
// starts the click on "Render video" is long gone. A suspended context's
// destination stream is pure silence, so every take and the score would be
// mixed into a track that records nothing. recordReel resumes it before
// starting; see there.
function buildAudioTrack(scenes, musicEl, musicVolume) {
  const withClipSound = scenes.filter((s) => s?.video && s.clip.volume > 0);
  const withVoice = scenes.filter((s) => s?.voice);
  if (!withClipSound.length && !withVoice.length && !musicEl) return { track: null, ctx: null };
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const actx = new AudioCtx();
    const dest = actx.createMediaStreamDestination();
    withClipSound.forEach((s) => {
      const src = actx.createMediaElementSource(s.video);
      const gain = actx.createGain();
      gain.gain.value = s.clip.volume;
      src.connect(gain).connect(dest);
      s.video.muted = false;
    });
    withVoice.forEach((s) => {
      const src = actx.createMediaElementSource(s.voice);
      src.connect(dest);
      s.voice.muted = false;
    });
    if (musicEl) {
      const src = actx.createMediaElementSource(musicEl);
      const gain = actx.createGain();
      gain.gain.value = Number.isFinite(musicVolume) ? musicVolume : 0.18;
      src.connect(gain).connect(dest);
      musicEl.muted = false;
    }
    return { track: dest.stream.getAudioTracks()[0] || null, ctx: actx };
  } catch {
    return { track: null, ctx: null };
  }
}

// Bitrate scaled to the frame actually being encoded, rather than one flat
// number for every preset. This was pinned at 8Mbps, which is roughly triple
// what 720p vertical needs and six times 480p's — and since every recorded
// chunk is held in memory until the file is assembled at the end, that
// overshoot was paid for in RAM for the whole render: a 30s reel banked
// ~30MB of chunks where ~10MB would have looked the same. ~4.3 bits per
// pixel per second lands near what a social platform re-encodes to anyway.
function bitrateFor(width, height) {
  const perSecond = Math.round(width * height * 4.3);
  return Math.max(1_200_000, Math.min(perSecond, 8_000_000));
}

// Records the reel in real time. MediaRecorder captures a live stream, so
// this takes as long as the reel runs — the progress callback is what makes
// that legible rather than a frozen dialog.
export function recordReel({ canvas, scenes, items, total, fps = 30, onProgress, isCancelled, musicEl, musicVolume }) {
  return new Promise((resolve, reject) => {
    const picked = pickRecorderMime();
    if (!picked) { reject(new Error("This browser can't record video.")); return; }
    const ctx = canvas.getContext("2d", { alpha: false });
    const W = canvas.width;
    const H = canvas.height;

    // Drive the stream from our own draws rather than letting it sample the
    // canvas on a timer of its own. captureStream(fps) grabs a frame every
    // 1/fps whether or not a new one was drawn and whether or not the encoder
    // is keeping up — and on a phone busy decoding footage it is not, so the
    // ungrabbed frames pile up in the stream's buffer for the whole render.
    // That backlog is a steady climb, which is what dying partway through a
    // recording rather than at the start looks like. With captureStream(0)
    // nothing is captured until requestFrame() is called, so what gets
    // encoded is exactly what got drawn, and a slow frame costs latency
    // instead of memory. Not every browser has requestFrame, hence the probe.
    const stream = canvas.captureStream(0);
    const videoTrack = stream.getVideoTracks()[0];
    const pushFrame = typeof videoTrack?.requestFrame === "function"
      ? () => videoTrack.requestFrame()
      : null;
    if (!pushFrame) {
      videoTrack?.stop();
      stream.removeTrack(videoTrack);
      canvas.captureStream(fps).getVideoTracks().forEach((tr) => stream.addTrack(tr));
    }
    const { track: audioTrack, ctx: audioCtx } = buildAudioTrack(scenes, musicEl, musicVolume);
    if (audioTrack) stream.addTrack(audioTrack);

    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: picked.mime, videoBitsPerSecond: bitrateFor(W, H) });
    } catch (e) { reject(e); return; }

    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onerror = (e) => reject(e.error || new Error("Recording failed"));

    let raf = 0;
    const cleanup = () => {
      cancelAnimationFrame(raf);
      // Fully released, not just paused — a canceled or finished export
      // shouldn't leave every clip's decoder sitting resident until GC
      // eventually gets to it.
      scenes.forEach((s) => {
        if (s?.video) releaseVideoSrc(s.video);
        if (s?.voice && !s.voice.paused) s.voice.pause();
      });
      if (musicEl && !musicEl.paused) musicEl.pause();
      stream.getTracks().forEach((tr) => tr.stop());
      if (audioCtx) audioCtx.close().catch(() => {});
    };

    // Finishing has to happen exactly once, and it has to happen even if the
    // recorder never tells us it stopped. Safari does sometimes swallow that
    // event, and the old code simply waited for it forever — holding every
    // clip, bitmap and recorded chunk resident the whole time, which is a
    // hang that turns into a dead tab rather than a file. The data already
    // collected is a perfectly good video, so use it.
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ blob: new Blob(chunks, { type: picked.mime }), ext: picked.ext, mime: picked.mime });
    };
    recorder.onstop = finish;
    const stopRecorder = () => {
      try { recorder.stop(); } catch { finish(); return; }
      setTimeout(finish, 4000);
    };

    const begin = async () => {
      // Clips load just-in-time as playback approaches them (manageClipWindow,
      // called every tick below) rather than all at once — but whichever
      // scene(s) the opening frame actually needs have to be explicitly
      // waited on here, or the file would open on black while the first
      // clip is still fetching.
      manageSceneWindow(scenes, items, 0);
      await Promise.all(
        items.filter((it) => it.start <= CLIP_LOOKAHEAD_S).map((it) => ensureVideoLoaded(scenes[it.index]))
      );
      if (isCancelled?.()) return;
      // An AudioContext built this far from a user gesture starts suspended,
      // and a suspended context feeds its destination stream silence — so
      // without this the recording gets a soundtrack of nothing regardless of
      // whether the voiceovers and score themselves loaded fine.
      if (audioCtx && audioCtx.state !== "running") {
        try { await audioCtx.resume(); } catch { /* recorded without sound */ }
      }
      drawFrame(ctx, scenes, items, 0, W, H);
      syncScenes(scenes, items, 0, false);
      // The score isn't scene-synced — it just loops under the whole thing,
      // starting from the top the moment the recording does.
      if (musicEl) { musicEl.loop = true; try { musicEl.currentTime = 0; } catch { /* not seekable yet */ } }

      setTimeout(() => {
        recorder.start(250);
        // Nothing is captured until asked for now, so the opening frame has
        // to be handed over explicitly or the file starts on black.
        pushFrame?.();
        if (musicEl) musicEl.play().catch(() => {});
        const t0 = performance.now();
        const frameGap = 1 / fps;
        let lastDrawn = -Infinity;
        const tick = (now) => {
          const t = (now - t0) / 1000;
          if (isCancelled?.()) { stopRecorder(); return; }
          if (t >= total) {
            drawFrame(ctx, scenes, items, Math.max(0, total - 0.001), W, H);
            pushFrame?.();
            onProgress?.(1);
            // One extra beat so the final frame is definitely in the stream
            // before the recorder is told to stop.
            setTimeout(stopRecorder, 120);
            return;
          }
          manageSceneWindow(scenes, items, t);
          syncScenes(scenes, items, t, true);
          // Composite at the output's frame rate, not the display's. This ran
          // on every animation frame — 60 a second on the phone this was
          // failing on — while the recording only ever wanted 30, so half of
          // the full-canvas draws (video sample, grade, overlays, all at
          // 720x1280) were work nobody could ever see, competing with the
          // encoder for the same main thread.
          if (t - lastDrawn >= frameGap) {
            lastDrawn = t;
            drawFrame(ctx, scenes, items, t, W, H);
            pushFrame?.();
          }
          onProgress?.(t / total);
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      }, 250);
    };

    begin().catch(reject);
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
