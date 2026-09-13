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
export function normalizeClip(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const natural = c.natural > 0 ? Number(c.natural) : null;
  const start = Math.max(0, num(c.start, 0));
  const rawEnd = c.end === null || c.end === undefined ? null : num(c.end, null);
  return {
    url: c.url || "",
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

export function formatSeconds(s) {
  const v = Math.max(0, Number(s) || 0);
  const m = Math.floor(v / 60);
  const rest = v - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, "0")}`;
}
