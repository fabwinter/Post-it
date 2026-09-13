import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, SkipBack, Repeat } from "lucide-react";
import { VisualCard } from "@/components/VisualCard";
import { useCardScale } from "@/lib/slideElements";
import {
  reelTimeline, normalizeClip, TRANSITION_BY_KEY, formatSeconds,
} from "@/lib/videoClip";

// Plays a reel the way it will actually be watched: scenes end to end at
// their real lengths, each clip graded and trimmed as set, transitions
// between them, overlays riding on top. Until this existed a reel could only
// be inspected one static card at a time, which tells you nothing about
// whether a cut lands or a line is on screen long enough to read.
//
// Everything is CSS — two stacked scene layers whose opacity/transform the
// frame loop drives — so there's no canvas pass and the preview is exactly
// the DOM the cards already render.

// The two frames of a crossover, as a function of progress (0 -> 1).
// `under` is the outgoing scene, `over` the incoming one. Only transitions
// flagged `overlaps` in lib/videoClip.js ever show both at once.
function transitionStyles(type, p) {
  switch (type) {
    case "dissolve":
      return { under: { opacity: 1 }, over: { opacity: p }, veil: 0 };
    case "slide":
      return {
        under: { opacity: 1, transform: `translateX(${-30 * p}%)` },
        over: { opacity: 1, transform: `translateX(${100 * (1 - p)}%)` },
        veil: 0,
      };
    case "zoom":
      return {
        under: { opacity: 1, transform: `scale(${1 + 0.08 * p})` },
        over: { opacity: p, transform: `scale(${1 + 0.18 * (1 - p)})` },
        veil: 0,
      };
    case "wipe":
      return {
        under: { opacity: 1 },
        over: { opacity: 1, clipPath: `inset(0 0 0 ${100 * (1 - p)}%)` },
        veil: 0,
      };
    case "fade":
      // Through black rather than straight across: the veil peaks at the
      // boundary, so it reads as a beat rather than a blend.
      return { under: { opacity: 1 }, over: { opacity: p > 0.5 ? 1 : 0 }, veil: 1 - Math.abs(2 * p - 1) };
    default:
      return { under: { opacity: 1 }, over: { opacity: 1 }, veil: 0 };
  }
}

// One scene layer. Holds its own <video> ref so the frame loop can seek it
// to the right point of the source without re-rendering React on every tick.
function SceneLayer({ item, brand, scale, style, registerVideo }) {
  const ref = useRef(null);
  useEffect(() => {
    registerVideo(item.index, ref.current);
    return () => registerVideo(item.index, null);
  }, [item.index, registerVideo, item.clip.url]);

  return (
    <div className="absolute inset-0 overflow-hidden" style={style}>
      <VisualCard spec={item.asset.spec} brand={brand} scale={scale} videoRef={ref} videoControlled />
    </div>
  );
}

export function ReelPlayer({ assets, brand, aspectCls, activeIndex, onSelectScene, testid = "reel-player" }) {
  const boxRef = useRef(null);
  const scale = useCardScale(boxRef, 0.45);
  const { items, total } = useMemo(() => reelTimeline(assets), [assets]);

  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [t, setT] = useState(0);

  const videos = useRef(new Map());
  const registerVideo = useCallback((i, el) => {
    if (el) videos.current.set(i, el);
    else videos.current.delete(i);
  }, []);

  // Which scene owns this moment, and how far into a crossover we are. The
  // incoming clip's transition duration is what defines the window, and
  // `overlap` (computed in reelTimeline) is how much of it actually fits.
  const frame = useMemo(() => {
    if (!items.length) return null;
    const i = Math.max(0, items.findIndex((it) => t < it.end));
    const cur = items[i] === undefined ? items[items.length - 1] : items[i];
    const prev = items[cur.index - 1];
    const window = TRANSITION_BY_KEY[cur.clip.transition.type]?.key === "cut"
      ? 0
      : Math.min(cur.clip.transition.duration, cur.seconds, prev?.seconds ?? 0);
    const into = t - cur.start;
    const inTransition = prev && window > 0 && into < window;
    return { cur, prev, p: inTransition ? Math.min(1, Math.max(0, into / window)) : 1, inTransition };
  }, [items, t]);

  // Seek every mounted clip to the source time this moment implies, and keep
  // only the ones on screen rolling. Done outside React state so a 60fps
  // loop costs no re-renders.
  const syncVideos = useCallback((time, isPlaying) => {
    items.forEach((it) => {
      const el = videos.current.get(it.index);
      if (!el || !it.clip.url) return;
      const onScreen = time >= it.start - 0.001 && time < it.end;
      if (!onScreen) {
        if (!el.paused) el.pause();
        return;
      }
      const c = it.clip;
      const want = c.start + Math.max(0, time - it.start) * c.speed;
      const cap = c.end ?? (el.duration || Infinity);
      const target = Math.min(want, cap - 0.05);
      if (Number.isFinite(target) && Math.abs(el.currentTime - target) > 0.25) {
        try { el.currentTime = Math.max(0, target); } catch { /* not seekable yet */ }
      }
      el.playbackRate = c.speed;
      el.volume = c.volume;
      el.muted = c.volume === 0;
      if (isPlaying && el.paused) el.play().catch(() => { /* autoplay refused; the frame loop still advances */ });
      if (!isPlaying && !el.paused) el.pause();
    });
  }, [items]);

  // The clock. rAF rather than an interval so playback tracks the display's
  // real cadence, and the elapsed delta comes from timestamps so a dropped
  // frame doesn't slow the reel down.
  const raf = useRef(0);
  const last = useRef(0);
  useEffect(() => {
    if (!playing) return undefined;
    last.current = performance.now();
    const tick = (now) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      setT((prev) => {
        const next = prev + dt;
        if (next >= total) {
          if (loop) return 0;
          setPlaying(false);
          return total;
        }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, total, loop]);

  useLayoutEffect(() => { syncVideos(t, playing); }, [t, playing, syncVideos]);

  // Editing a clip while parked on it should show the change, so a length or
  // trim edit that moves the playhead past the end pulls it back in range.
  useEffect(() => { if (t > total) setT(0); }, [t, total]);

  // Selecting a scene elsewhere (the strip, the editor) parks the playhead
  // on it, so the preview always shows what's being edited.
  useEffect(() => {
    if (playing || activeIndex == null) return;
    const it = items[activeIndex];
    if (it) setT(it.start + Math.min(0.05, it.seconds / 4));
  }, [activeIndex, items, playing]);

  if (!items.length) return null;

  const { cur, prev, p, inTransition } = frame;
  const tx = transitionStyles(cur.clip.transition.type, p);
  const veil = inTransition ? tx.veil : 0;

  return (
    <div data-testid={testid}>
      <div ref={boxRef} className={`relative ${aspectCls} w-full overflow-hidden rounded-xl bg-black`}
        data-testid={`${testid}-stage`}>
        {inTransition && prev && (
          <SceneLayer item={prev} brand={brand} scale={scale} style={tx.under} registerVideo={registerVideo} />
        )}
        <SceneLayer item={cur} brand={brand} scale={scale}
          style={inTransition ? tx.over : { opacity: 1 }} registerVideo={registerVideo} />
        {veil > 0 && <div className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: veil }} />}
      </div>

      {/* Transport */}
      <div className="mt-2 flex items-center gap-2">
        <button onClick={() => setPlaying((s) => !s)} data-testid={`${testid}-playpause`}
          title={playing ? "Pause" : "Play"}
          className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-lime text-[#0A0A0A] hover:bg-lime-hover">
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button onClick={() => { setT(0); syncVideos(0, false); }} data-testid={`${testid}-restart`} title="Back to start"
          className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-white/10 text-zinc-400 hover:text-white">
          <SkipBack size={15} />
        </button>
        <button onClick={() => setLoop((s) => !s)} data-testid={`${testid}-loop`} title={loop ? "Looping" : "Play once"}
          className={`flex h-9 w-9 flex-none items-center justify-center rounded-lg border transition-colors ${loop ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-500 hover:text-white"}`}>
          <Repeat size={15} />
        </button>
        <span className="flex-none font-mono text-[11px] tabular-nums text-zinc-400" data-testid={`${testid}-time`}>
          {formatSeconds(t)} <span className="text-zinc-600">/ {formatSeconds(total)}</span>
        </span>
      </div>

      {/* Timeline — one block per scene, proportional to how long it holds
          the screen, so the shape of the edit is readable at a glance. */}
      <div className="mt-2 flex h-9 w-full gap-0.5 overflow-hidden rounded-lg border border-white/10 bg-[#0A0A0A] p-0.5"
        data-testid={`${testid}-timeline`}>
        {items.map((it) => {
          const on = it.index === activeIndex;
          const playhead = t >= it.start && t < it.end;
          return (
            <button key={it.index} onClick={() => { onSelectScene?.(it.index); setT(it.start); }}
              data-testid={`${testid}-seg-${it.index}`} title={`Scene ${it.index + 1} · ${it.seconds.toFixed(1)}s`}
              style={{ flexGrow: Math.max(0.08, it.seconds), flexBasis: 0 }}
              className={`relative min-w-0 overflow-hidden rounded-md border text-left transition-colors ${
                on ? "border-lime bg-lime/15" : "border-white/10 bg-white/5 hover:bg-white/10"
              }`}>
              {it.clip.url && (
                <video src={it.clip.url} muted playsInline preload="metadata"
                  className="absolute inset-0 h-full w-full object-cover opacity-30" />
              )}
              <span className={`relative ml-1 font-mono text-[9px] ${on ? "text-lime" : "text-zinc-400"}`}>{it.index + 1}</span>
              {playhead && (
                <span className="absolute inset-y-0 w-px bg-lime"
                  style={{ left: `${Math.min(100, ((t - it.start) / Math.max(0.001, it.seconds)) * 100)}%` }} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
