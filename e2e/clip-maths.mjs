// Pure-maths checks for the reel timeline model, run before the browser
// tests. videoClip.js has no imports and no DOM, so it can be exercised
// directly — which is the only way to pin down behaviour that is real but
// hard to see through a video file, like where in a source clip a given
// moment of a scene lands.
import { pathToFileURL } from "node:url";
import path from "node:path";

const mod = await import(pathToFileURL(path.resolve("frontend/src/lib/videoClip.js")).href);
const { normalizeClip, clipSourceTime } = mod;

let failed = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  — ${detail}`}`);
  if (!cond) failed += 1;
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// A clip long enough to fill its scene behaves exactly as it always did.
const long = normalizeClip({ url: "x", natural: 10 });
ok("a clip longer than the moment asked for plays straight through",
   near(clipSourceTime(long, 3, 10), 3), String(clipSourceTime(long, 3, 10)));

// The case this was written for: a 5s slide over a 2s stock clip. Past the
// end of the source it used to pin at the last frame — a freeze on screen,
// and underneath it a seek and a play() every single frame for the whole
// tail, because an ended element that gets play()d rewinds to zero and the
// next tick seeks it back. Looping costs one seek per lap instead.
const short = normalizeClip({ url: "x", natural: 2 });
ok("a clip shorter than its scene loops rather than freezing on its last frame",
   near(clipSourceTime(short, 2.5, 2), 0.5), String(clipSourceTime(short, 2.5, 2)));
ok("...and keeps looping for as long as the scene holds",
   near(clipSourceTime(short, 4.5, 2), 0.5), String(clipSourceTime(short, 4.5, 2)));
ok("...and never lands outside the source",
   [0, 1.9, 2, 3.7, 4.999].every((e) => {
     const v = clipSourceTime(short, e, 2);
     return v >= 0 && v < 2;
   }));

// Looping respects the trim window, not just the file: a clip trimmed to
// 4s-6s of a 30s source has to come back to 4s, never to 0.
const trimmed = normalizeClip({ url: "x", natural: 30, start: 4, end: 6 });
ok("a trimmed clip loops back to its own in-point, not to zero",
   near(clipSourceTime(trimmed, 2.5, 30), 4.5), String(clipSourceTime(trimmed, 2.5, 30)));

// Speed scales how fast the source is consumed, so it has to be applied
// before the wrap, not after.
const fast = normalizeClip({ url: "x", natural: 2, speed: 2 });
ok("speed is applied before the loop wraps",
   near(clipSourceTime(fast, 1.5, 2), 1), String(clipSourceTime(fast, 1.5, 2)));

// Duration is unknown until metadata lands; until then there is nothing to
// wrap against and the old linear answer is the only correct one.
ok("an unknown source length falls back to playing straight through",
   near(clipSourceTime(normalizeClip({ url: "x" }), 3, 0), 3));


// A take's real duration comes from its own alignment, not from asking a
// browser <audio> element what it thinks — see durationFromAlignment's own
// comment for why that element cannot be trusted for a synthesized file.
const durationFromAlignment = mod.durationFromAlignment;
ok("a take's duration is read from its own alignment, not guessed",
   near(durationFromAlignment({ character_end_times_seconds: [0.1, 0.3, 0.9, 4.7] }), 4.7),
   String(durationFromAlignment({ character_end_times_seconds: [0.1, 0.3, 0.9, 4.7] })));
ok("...and falls back cleanly when there's no alignment to read",
   durationFromAlignment(null) === null && durationFromAlignment({}) === null
   && durationFromAlignment({ character_end_times_seconds: [] }) === null);
ok("...and never returns a bogus non-positive number",
   durationFromAlignment({ character_end_times_seconds: [0.1, 0] }) === null);

// A scene's take now records its heading and its caption line together, so
// the caption's own word-highlight has to start timing from wherever the
// caption's text begins in that combined recording, not from zero — see
// alignmentSlice's own comment.
const alignmentSlice = mod.alignmentSlice;
const combined = {
  // "Hi. Bye" — 7 characters, offset 3 is where "Bye" starts.
  characters: ["H", "i", ".", " ", "B", "y", "e"],
  character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
  character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
};
const sliced = alignmentSlice(combined, 4);
ok("slicing keeps only the characters from the offset on",
   sliced.characters.join("") === "Bye", JSON.stringify(sliced));
ok("...and keeps each one's REAL absolute time, not renormalized to zero",
   near(sliced.character_start_times_seconds[0], 0.4), JSON.stringify(sliced));
ok("a zero offset returns the alignment untouched",
   alignmentSlice(combined, 0) === combined);
ok("an offset past the end returns nothing to highlight, not a crash",
   alignmentSlice(combined, 99) === null);
ok("no alignment at all passes through as-is (the caller's own fallback path)",
   alignmentSlice(null, 4) === null);

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
