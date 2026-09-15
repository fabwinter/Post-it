// The editing model for a reel's video: what part of a source clip plays,
// how long it holds the timeline, how it's graded, and how it arrives on
// screen after the clip before it.
//
// A scene already carries its overlays (the freeform `elements` array — see
// lib/slideElements.js) and its copy; this is the moving picture underneath
// them. It lives on the scene's spec as `clip`, so a reel is just the
// existing scene strip read as a timeline, left to right.

// Every grade is a CSS filter primitive, so a clip renders identically in a
// 68px strip thumbnail, the editor, and the player without a canvas pass.
// `neutral` is the value at which the primitive does nothing — anything at
// neutral is dropped from the filter string entirely.
export const EFFECT_CONTROLS = [
  { key: "brightness", label: "Brightness", min: 20, max: 200, step: 1, neutral: 100, css: (v) => `brightness(${v}%)` },
  { key: "contrast", label: "Contrast", min: 20, max: 200, step: 1, neutral: 100, css: (v) => `contrast(${v}%)` },
  { key: "saturate", label: "Saturation", min: 0, max: 250, step: 1, neutral: 100, css: (v) => `saturate(${v}%)` },
  { key: "hueRotate", label: "Hue", min: -180, max: 180, step: 1, neutral: 0, css: (v) => `hue-rotate(${v}deg)` },
  { key: "blur", label: "Blur", min: 0, max: 20, step: 0.5, neutral: 0, css: (v) => `blur(${v}px)` },
  { key: "grayscale", label: "Black & white", min: 0, max: 100, step: 1, neutral: 0, css: (v) => `grayscale(${v}%)` },
  { key: "sepia", label: "Sepia", min: 0, max: 100, step: 1, neutral: 0, css: (v) => `sepia(${v}%)` },
];

const EFFECT_BY_KEY = Object.fromEntries(EFFECT_CONTROLS.map((e) => [e.key, e]));

// One-tap looks. Each is just a set of the primitives above, so a preset is
// a starting point the sliders keep editing rather than a separate mode.
export const EFFECT_PRESETS = [
  { key: "none", label: "None", effects: {} },
  { key: "punch", label: "Punch", effects: { contrast: 125, saturate: 130 } },
  { key: "mono", label: "Mono", effects: { grayscale: 100, contrast: 115 } },
  { key: "warm", label: "Warm", effects: { sepia: 30, saturate: 115, brightness: 105 } },
  { key: "cool", label: "Cool", effects: { hueRotate: -12, saturate: 110, brightness: 102 } },
  { key: "faded", label: "Faded", effects: { contrast: 82, saturate: 78, brightness: 108 } },
  { key: "noir", label: "Noir", effects: { grayscale: 100, contrast: 150, brightness: 92 } },
  { key: "dream", label: "Dream", effects: { blur: 2, brightness: 108, saturate: 120 } },
];

// How a clip arrives after the one before it. Stored on the incoming clip
// (the first clip's transition is ignored — there's nothing to come from).
// `enter`/`leave` describe the two frames of the crossover, which the player
// interpolates between; `overlaps` says whether the outgoing clip stays on
// screen underneath while it happens.
export const TRANSITIONS = [
  { key: "cut", label: "Cut", overlaps: false },
  { key: "fade", label: "Fade", overlaps: false },
  { key: "dissolve", label: "Dissolve", overlaps: true },
  { key: "slide", label: "Slide", overlaps: true },
  { key: "zoom", label: "Zoom", overlaps: true },
  { key: "wipe", label: "Wipe", overlaps: true },
];

export const TRANSITION_BY_KEY = Object.fromEntries(TRANSITIONS.map((t) => [t.key, t]));

export const MIN_CLIP_SECONDS = 0.4;
export const MAX_CLIP_SECONDS = 60;
export const DEFAULT_CLIP_SECONDS = 3;

export const DEFAULT_TRANSITION = { type: "cut", duration: 0.4 };

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

// A clip is stored sparsely (a scene that only ever had a stock video set is
// just `{url}`), so every read goes through here rather than assuming keys.
//
// `kind` is "video" (the default, for every clip stored before this existed)
// or "image" — a still held on screen for `hold`/DEFAULT_CLIP_SECONDS
// instead of played. Everything else (opacity, fit, effects, transition) is
// shared: a still and a video are the same kind of scene background, they
// just differ in whether there's a timeline to trim or speed up.
export function normalizeClip(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const kind = c.kind === "image" ? "image" : "video";
  const natural = kind === "video" && c.natural > 0 ? Number(c.natural) : null;
  const start = Math.max(0, num(c.start, 0));
  const rawEnd = c.end === null || c.end === undefined ? null : num(c.end, null);
  return {
    url: c.url || "",
    kind,
    credit: c.credit || "",
    natural,
    start,
    // A trim-out past the source's own length is meaningless; clamp once
    // the real duration is known rather than trusting what was stored.
    end: rawEnd === null ? null : clamp(rawEnd, start + MIN_CLIP_SECONDS, natural || MAX_CLIP_SECONDS * 4),
    speed: clamp(num(c.speed, 1), 0.25, 4),
    fit: c.fit === "contain" ? "contain" : "cover",
    // The old hardcoded 0.45 dim is now just this default: legible enough to
    // put white text over, and raisable to 1 when the footage is the point.
    opacity: clamp(num(c.opacity, 0.45), 0, 1),
    volume: clamp(num(c.volume, 0), 0, 1),
    effects: { ...(c.effects && typeof c.effects === "object" ? c.effects : {}) },
    transition: {
      type: TRANSITION_BY_KEY[c.transition?.type] ? c.transition.type : DEFAULT_TRANSITION.type,
      duration: clamp(num(c.transition?.duration, DEFAULT_TRANSITION.duration), 0.1, 3),
    },
    // Only set once the user has pinned a length by hand; otherwise the trim
    // window decides, so re-trimming keeps changing the length as expected.
    hold: c.hold > 0 ? clamp(Number(c.hold), MIN_CLIP_SECONDS, MAX_CLIP_SECONDS) : null,
  };
}

export function hasVideo(clip) {
  return !!(clip && clip.url);
}

// The filter string for a clip's grade. Primitives sitting at neutral are
// left out, so an ungraded clip gets no `filter` at all rather than a
// no-op chain the compositor still has to run.
export function filterCss(effects) {
  const parts = EFFECT_CONTROLS
    .filter((e) => {
      const v = effects?.[e.key];
      return Number.isFinite(Number(v)) && Number(v) !== e.neutral;
    })
    .map((e) => e.css(Number(effects[e.key])));
  return parts.length ? parts.join(" ") : undefined;
}

export function effectValue(effects, key) {
  const v = effects?.[key];
  return Number.isFinite(Number(v)) ? Number(v) : EFFECT_BY_KEY[key].neutral;
}

// Which preset (if any) the current grade exactly matches — so the preset
// row can show what's active, and stop showing it the moment a slider moves.
export function matchingPreset(effects) {
  const active = EFFECT_CONTROLS.filter((e) => effectValue(effects, e.key) !== e.neutral).map((e) => e.key);
  return EFFECT_PRESETS.find((p) => {
    const keys = Object.keys(p.effects);
    if (keys.length !== active.length) return false;
    return keys.every((k) => effectValue(effects, k) === p.effects[k]);
  })?.key || null;
}

// How much of the SOURCE a clip plays, in source seconds. Independent of
// speed — this is the trim window, not the time it takes to watch it.
export function trimmedSeconds(clip) {
  const c = normalizeClip(clip);
  const end = c.end ?? c.natural;
  if (!end) return null; // natural length not known yet
  return Math.max(MIN_CLIP_SECONDS, end - c.start);
}

// How long the clip holds the timeline. A hand-set `hold` wins; otherwise
// the trim window played at its speed; otherwise a sane default for footage
// whose metadata hasn't loaded yet (or a scene with no video at all, which
// still occupies time for its overlays).
export function clipSeconds(clip) {
  const c = normalizeClip(clip);
  if (c.hold) return c.hold;
  const trimmed = trimmedSeconds(c);
  if (trimmed === null) return DEFAULT_CLIP_SECONDS;
  return clamp(trimmed / c.speed, MIN_CLIP_SECONDS, MAX_CLIP_SECONDS);
}

// Where in the source a clip should be at `elapsed` seconds into its scene.
//
// A scene holds the timeline for as long as its length says, which is very
// often LONGER than the footage behind it: a 5s slide over a 4s stock clip is
// the ordinary case for an auto-built reel, and any hand-set `hold` can do it
// deliberately. The old answer was to pin at the last frame — min(want, cap)
// — which reads as a freeze, and, much worse, thrashes. The element plays
// past the pin and fires `ended`; the next tick sees it paused and calls
// play(), which rewinds an ended element to 0; the tick after that sees it
// 4 seconds away from the pin and seeks it back; it ends again. That is a
// seek and a play every frame for the whole tail of the scene, and every one
// of those seeks tears down and refills a decode pipeline.
//
// Looping the trim window instead costs one seek per lap, keeps motion under
// the text, and is identical to the old maths for any clip long enough to
// fill its scene.
export function clipSourceTime(clip, elapsed, sourceDuration) {
  const dur = Number.isFinite(sourceDuration) && sourceDuration > 0 ? sourceDuration : null;
  const end = clip.end ?? dur;
  const played = Math.max(0, num(elapsed, 0)) * clip.speed;
  if (!Number.isFinite(end)) return clip.start + played;
  const span = Math.max(MIN_CLIP_SECONDS, end - clip.start);
  return clip.start + (played % span);
}

// Setting a length by hand pins `hold`, so later trimming doesn't silently
// undo it — the editor shows the pin and offers to drop it.
export function withLength(clip, seconds) {
  return { ...normalizeClip(clip), hold: clamp(num(seconds, DEFAULT_CLIP_SECONDS), MIN_CLIP_SECONDS, MAX_CLIP_SECONDS) };
}

// Lays the scenes out end to end. Transitions that overlap (dissolve, slide,
// zoom, wipe) borrow their time from the outgoing clip's tail rather than
// adding to the running time, which is what makes the total match what you
// actually watch.
export function reelTimeline(assets) {
  const scenes = (assets || []).map((a, i) => {
    const clip = normalizeClip(a?.spec?.clip);
    return { index: i, asset: a, clip, seconds: clipSeconds(clip) };
  });
  let t = 0;
  const items = scenes.map((s, i) => {
    const prev = scenes[i - 1];
    const t0 = TRANSITION_BY_KEY[s.clip.transition.type];
    const overlap = i > 0 && t0?.overlaps
      ? Math.min(s.clip.transition.duration, s.seconds / 2, (prev?.seconds || 0) / 2)
      : 0;
    const start = Math.max(0, t - overlap);
    const end = start + s.seconds;
    t = end;
    return { ...s, start, end, overlap };
  });
  return { items, total: t };
}

// The two frames of a crossover as plain numbers, so the CSS player and the
// canvas exporter draw the same thing from one definition rather than two
// implementations that drift. `under` is the outgoing scene, `over` the
// incoming one; tx is a fraction of the frame width, clipLeft the fraction
// of the incoming scene still hidden, veil the black dip over the top.
export function transitionFrame(type, p) {
  const flat = { under: null, over: { opacity: 1, tx: 0, scale: 1, clipLeft: 0 }, veil: 0 };
  switch (type) {
    case "dissolve":
      return { under: { opacity: 1, tx: 0, scale: 1, clipLeft: 0 }, over: { opacity: p, tx: 0, scale: 1, clipLeft: 0 }, veil: 0 };
    case "slide":
      return {
        under: { opacity: 1, tx: -0.3 * p, scale: 1, clipLeft: 0 },
        over: { opacity: 1, tx: 1 - p, scale: 1, clipLeft: 0 },
        veil: 0,
      };
    case "zoom":
      return {
        under: { opacity: 1, tx: 0, scale: 1 + 0.08 * p, clipLeft: 0 },
        over: { opacity: p, tx: 0, scale: 1 + 0.18 * (1 - p), clipLeft: 0 },
        veil: 0,
      };
    case "wipe":
      return {
        under: { opacity: 1, tx: 0, scale: 1, clipLeft: 0 },
        over: { opacity: 1, tx: 0, scale: 1, clipLeft: 1 - p },
        veil: 0,
      };
    case "fade":
      // Through black rather than straight across: the veil peaks at the
      // boundary, so it reads as a beat rather than a blend.
      return {
        under: { opacity: 1, tx: 0, scale: 1, clipLeft: 0 },
        over: { opacity: p > 0.5 ? 1 : 0, tx: 0, scale: 1, clipLeft: 0 },
        veil: 1 - Math.abs(2 * p - 1),
      };
    default:
      return flat;
  }
}

// Where the playhead sits: which scene owns this moment, what it's coming
// from, and how far through the crossover we are. Shared so the exporter
// reproduces the player's timing exactly rather than approximating it.
export function frameAt(items, t) {
  if (!items.length) return null;
  const idx = items.findIndex((it) => t < it.end);
  const cur = idx === -1 ? items[items.length - 1] : items[idx];
  const prev = items[cur.index - 1];
  const window = cur.clip.transition.type === "cut"
    ? 0
    : Math.min(cur.clip.transition.duration, cur.seconds, prev?.seconds ?? 0);
  const into = t - cur.start;
  const inTransition = !!prev && window > 0 && into < window;
  return { cur, prev, inTransition, p: inTransition ? Math.min(1, Math.max(0, into / window)) : 1 };
}

// Word-level timing for a scene's spoken line, so the on-screen body text
// can highlight along with the voiceover the way a caption does.
//
// When PoYo's TTS returns real alignment data, it's ElevenLabs' own
// character-timestamp shape: parallel `characters`/`character_start_times_seconds`/
// `character_end_times_seconds` arrays. A word's start/end is just the span
// of its own non-whitespace characters in that array. If that shape isn't
// there — or its character count doesn't add up to the words we asked it to
// speak, which text normalization (numbers, abbreviations) can cause — this
// falls back to splitting the clip's duration across words by their length,
// which reads close enough without needing real timing at all.
// A take's real duration, straight from ElevenLabs' own character alignment
// — the last character's end time IS how long the line runs.
//
// This exists because the audio element's own `duration` cannot be trusted
// for a synthesized take. A streamed MP3 with no duration atom in its
// header — which is what TTS output usually is — reports `duration:
// Infinity` at loadedmetadata in Chrome and Safari alike; that's a quirk of
// the format, not a broken file, but code that treated it as "unknown"
// (Number.isFinite(Infinity) is false) fell back to whatever length the
// scene already had, unrelated to how long the line actually takes to say,
// and the scene cut away mid-sentence. Every take, every reel — the alignment
// path sidesteps the browser for this number entirely.
export function durationFromAlignment(alignment) {
  const ends = alignment?.character_end_times_seconds;
  if (!Array.isArray(ends) || !ends.length) return null;
  const last = ends[ends.length - 1];
  return Number.isFinite(last) && last > 0 ? last : null;
}

// Cuts an alignment down to the characters from `charOffset` on, keeping
// each one's own absolute timestamp.
//
// A scene's take is now the on-screen headline AND the caption line spoken
// together as one recording (see synthesizeSceneVoice), so the alignment
// that comes back covers both. The word-sync highlight only ever belongs to
// the caption half — the headline sits on screen the whole time regardless,
// it was never a caption to begin with — so the caption's own words need
// timing that starts wherever the caption's own text starts in that
// recording, not from zero. Slicing rather than re-deriving keeps every
// character's REAL spoken time, so the highlight lands exactly when that
// word is actually said, silence for the headline included.
export function alignmentSlice(alignment, charOffset) {
  const chars = alignment?.characters;
  const starts = alignment?.character_start_times_seconds;
  const ends = alignment?.character_end_times_seconds;
  if (!Array.isArray(chars) || !Array.isArray(starts) || !Array.isArray(ends)) return alignment;
  if (charOffset <= 0) return alignment;
  if (charOffset >= chars.length) return null;
  return {
    characters: chars.slice(charOffset),
    character_start_times_seconds: starts.slice(charOffset),
    character_end_times_seconds: ends.slice(charOffset),
  };
}

export function deriveCaptionWords(text, duration, alignment) {
  const words = (text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const chars = alignment?.characters;
  const starts = alignment?.character_start_times_seconds;
  const ends = alignment?.character_end_times_seconds;
  if (Array.isArray(chars) && Array.isArray(starts) && Array.isArray(ends)
    && chars.length === starts.length && chars.length === ends.length && chars.length > 0) {
    const result = [];
    let i = 0;
    for (const w of words) {
      while (i < chars.length && /\s/.test(chars[i])) i += 1;
      const wordStart = i < chars.length ? starts[i] : null;
      let wordEnd = wordStart;
      let consumed = 0;
      while (i < chars.length && consumed < w.length) {
        if (!/\s/.test(chars[i])) { wordEnd = ends[i]; consumed += 1; }
        i += 1;
      }
      if (wordStart != null && wordEnd != null) result.push({ text: w, start: wordStart, end: wordEnd });
    }
    if (result.length === words.length) return result;
  }
  const dur = Number(duration) > 0 ? Number(duration) : words.length * 0.35;
  const weights = words.map((w) => Math.max(1, w.length));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  return words.map((w, i) => {
    const start = t;
    t += (weights[i] / totalWeight) * dur;
    return { text: w, start, end: t };
  });
}

// Which word a moment in the scene lands on, or -1 before the first word /
// once every word has been reached (the last word stays "active" through
// whatever silence trails it, which reads better than snapping off early).
export function wordIndexAt(words, t) {
  if (!words || !words.length) return -1;
  if (t < words[0].start) return -1;
  let idx = 0;
  for (let i = 0; i < words.length; i += 1) {
    if (t >= words[i].start) idx = i; else break;
  }
  return idx;
}

export function formatSeconds(s) {
  const v = Math.max(0, Number(s) || 0);
  const m = Math.floor(v / 60);
  const rest = v - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, "0")}`;
}
