import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, SkipBack, Repeat } from "lucide-react";
import { VisualCard } from "@/components/VisualCard";
import { useCardScale } from "@/lib/slideElements";
import { reelTimeline, transitionFrame, frameAt, formatSeconds, wordIndexAt, clipSourceTime } from "@/lib/videoClip";

// Plays a reel the way it will actually be watched: scenes end to end at
// their real lengths, each clip graded and trimmed as set, transitions
// between them, overlays riding on top. Until this existed a reel could only
// be inspected one static card at a time, which tells you nothing about
// whether a cut lands or a line is on screen long enough to read.
//
// Everything is CSS — two stacked scene layers whose opacity/transform the
// frame loop drives — so there's no canvas pass and the preview is exactly
// the DOM the cards already render.

// transitionFrame gives the crossover as plain numbers (shared with the
// canvas exporter so the two renderers can't drift); this is only the
// translation of those numbers into CSS.
const layerCss = (f) => (f ? {
  opacity: f.opacity,
  transform: f.tx || f.scale !== 1 ? `translateX(${f.tx * 100}%) scale(${f.scale})` : undefined,
  clipPath: f.clipLeft ? `inset(0 0 0 ${f.clipLeft * 100}%)` : undefined,
} : undefined);

// One scene layer. Holds its own <video> ref so the frame loop can seek it
// to the right point of the source without re-rendering React on every tick.
function SceneLayer({ item, brand, scale, style, registerVideo, activeWordIndex }) {
  const ref = useRef(null);
  useEffect(() => {
    registerVideo(item.index, ref.current);
    return () => registerVideo(item.index, null);
  }, [item.index, registerVideo, item.clip.url]);

  return (
    <div className="absolute inset-0 overflow-hidden" style={style}>
      <VisualCard spec={item.asset.spec} brand={brand} scale={scale} videoRef={ref} videoControlled
        activeWordIndex={activeWordIndex} />
    </div>
  );
}

// A scene's recorded voiceover, if it has one — no visual of its own, just
// registered the same way a scene's background video is, so the frame loop
// can play it in lockstep. Kept mounted for every scene at once (there's
// only ever a handful) rather than only the current one, so scrubbing back
// to an earlier scene doesn't have to reload its audio first.
function VoiceLayer({ item, registerAudio }) {
  const ref = useRef(null);
  const url = item.asset.spec?.voice?.url;
  useEffect(() => {
    registerAudio(item.index, ref.current);
    return () => registerAudio(item.index, null);
  }, [item.index, registerAudio, url]);
  if (!url) return null;
  return <audio ref={ref} src={url} preload="auto" />;
}

export function ReelPlayer({ assets, brand, aspectCls, music, activeIndex, onSelectScene, testid = "reel-player" }) {
  const boxRef = useRef(null);
  const scale = useCardScale(boxRef, 0.45);
  const { items, total } = useMemo(() => reelTimeline(assets), [assets]);

  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [t, setT] = useState(0);
  const musicRef = useRef(null);

  const videos = useRef(new Map());
  const registerVideo = useCallback((i, el) => {
    if (el) videos.current.set(i, el);
    else videos.current.delete(i);
  }, []);

  const audios = useRef(new Map());
  const registerAudio = useCallback((i, el) => {
    if (el) audios.current.set(i, el);
    else audios.current.delete(i);
  }, []);

  const frame = useMemo(() => frameAt(items, t), [items, t]);

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
      // Loops the trim window rather than pinning to the last frame — see
      // clipSourceTime for why pinning is both a freeze and a seek storm.
      const target = clipSourceTime(c, time - it.start, el.duration);
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

  // A voiceover plays straight through from its own start, once per scene —
  // no trim window or speed to honor like a background clip has, just "is
  // this scene on screen right now."
  const syncAudios = useCallback((time, isPlaying) => {
    items.forEach((it) => {
      const el = audios.current.get(it.index);
      if (!el) return;
      const onScreen = time >= it.start - 0.001 && time < it.end;
      if (!onScreen) {
        if (!el.paused) el.pause();
        return;
      }
      const target = Math.max(0, time - it.start);
      if (Number.isFinite(target) && Math.abs(el.currentTime - target) > 0.25) {
        try { el.currentTime = target; } catch { /* not seekable yet */ }
      }
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

  useLayoutEffect(() => { syncVideos(t, playing); syncAudios(t, playing); }, [t, playing, syncVideos, syncAudios]);

  // The score isn't scene-synced — it's one track under the whole reel —
  // so it only needs to follow play/pause and restart from the top
  // whenever the playhead does (a manual restart or the loop wrapping
  // around both set t back to exactly 0).
  useEffect(() => {
    const el = musicRef.current;
    if (!el || !music?.url) return;
    if (playing && el.paused) el.play().catch(() => {});
    if (!playing && !el.paused) el.pause();
  }, [playing, music?.url]);
  useEffect(() => {
    const el = musicRef.current;
    if (el && music?.url) el.volume = music.volume ?? 0.18;
  }, [music?.volume, music?.url]);
  useEffect(() => {
    const el = musicRef.current;
    if (el && music?.url && t === 0) { try { el.currentTime = 0; } catch { /* not seekable yet */ } }
  }, [t, music?.url]);

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
  const tx = transitionFrame(cur.clip.transition.type, p);
  const veil = inTransition ? tx.veil : 0;
  const curWordIndex = wordIndexAt(cur.asset.spec?.voice?.words, t - cur.start);
  const prevWordIndex = prev ? wordIndexAt(prev.asset.spec?.voice?.words, t - prev.start) : -1;

  return (
    <div data-testid={testid}>
      <div ref={boxRef} className={`relative ${aspectCls} w-full overflow-hidden rounded-xl bg-black`}
        data-testid={`${testid}-stage`}>
        {inTransition && prev && tx.under && (
          <SceneLayer item={prev} brand={brand} scale={scale} style={layerCss(tx.under)} registerVideo={registerVideo}
            activeWordIndex={prevWordIndex} />
        )}
        <SceneLayer item={cur} brand={brand} scale={scale}
          style={inTransition ? layerCss(tx.over) : { opacity: 1 }} registerVideo={registerVideo}
          activeWordIndex={curWordIndex} />
        {veil > 0 && <div className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: veil }} />}
      </div>
      {items.map((it) => <VoiceLayer key={it.index} item={it} registerAudio={registerAudio} />)}
      {!!music?.url && <audio ref={musicRef} src={music.url} loop preload="auto" data-testid={`${testid}-music`} />}

      {/* Transport */}
      <div className="mt-2 flex items-center gap-2">
        <button onClick={() => setPlaying((s) => !s)} data-testid={`${testid}-playpause`}
          title={playing ? "Pause" : "Play"}
          className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-lime text-[#0A0A0A] hover:bg-lime-hover">
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button onClick={() => { setT(0); syncVideos(0, false); syncAudios(0, false); }} data-testid={`${testid}-restart`} title="Back to start"
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
