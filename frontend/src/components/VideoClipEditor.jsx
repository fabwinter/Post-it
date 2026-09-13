import { useEffect, useRef, useState } from "react";
import { Film, Search, Upload, Shapes, Sparkles, Loader2, Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  EFFECT_CONTROLS, EFFECT_PRESETS, TRANSITIONS, normalizeClip, filterCss, effectValue,
  matchingPreset, clipSeconds, trimmedSeconds, withLength,
  MIN_CLIP_SECONDS, MAX_CLIP_SECONDS,
} from "@/lib/videoClip";

// Everything you can do to one scene's footage: where it comes from, which
// part of it plays and for how long, how it's graded, and how it arrives
// after the scene before it. Overlays aren't here — they're the freeform
// elements the canvas already edits, which sit on top of all of this.

const Row = ({ label, children, hint }) => (
  <div className="mt-2.5">
    <div className="flex items-baseline justify-between gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">{label}</span>
      {hint && <span className="font-mono text-[10px] tabular-nums text-zinc-500">{hint}</span>}
    </div>
    <div className="mt-1.5">{children}</div>
  </div>
);

const Slider = ({ value, min, max, step, onChange, testid }) => (
  <input type="range" min={min} max={max} step={step} value={value} data-testid={testid}
    onChange={(e) => onChange(Number(e.target.value))}
    className="h-6 w-full accent-lime" />
);

const Chip = ({ on, onClick, children, testid, title }) => (
  <button onClick={onClick} data-testid={testid} title={title}
    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
      on ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"
    }`}>
    {children}
  </button>
);

export function VideoClipEditor({
  clip: raw, onChange, onPickStock, onPickLibrary, onUpload, onGenerate, onClear,
  isFirst, uploading,
}) {
  const clip = normalizeClip(raw);
  const fileRef = useRef(null);
  const [tab, setTab] = useState("clip"); // clip | effects | transition
  const probeRef = useRef(null);

  const patch = (p) => onChange({ ...clip, ...p });
  const patchEffects = (p) => onChange({ ...clip, effects: { ...clip.effects, ...p } });

  // The source's real length isn't known until the browser reads its
  // metadata, and every trim control needs it — so it's probed once and
  // cached on the clip rather than re-read on each render.
  useEffect(() => {
    const el = probeRef.current;
    if (!el || !clip.url || clip.natural) return undefined;
    const onMeta = () => {
      if (el.duration && Number.isFinite(el.duration)) onChange({ ...clip, natural: Number(el.duration.toFixed(2)) });
    };
    el.addEventListener("loadedmetadata", onMeta);
    return () => el.removeEventListener("loadedmetadata", onMeta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.url, clip.natural]);

  const natural = clip.natural;
  const seconds = clipSeconds(clip);
  const trimmed = trimmedSeconds(clip);
  const preset = matchingPreset(clip.effects);
  const graded = filterCss(clip.effects);

  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-[#121212] p-3" data-testid="clip-editor">
      {clip.url && <video ref={probeRef} src={clip.url} preload="metadata" className="hidden" muted />}

      {/* Source */}
      <div className="flex items-center gap-2.5">
        <div className="relative h-14 w-14 flex-none overflow-hidden rounded-md border border-white/10 bg-black">
          {clip.url ? (
            <video src={clip.url} muted loop playsInline autoPlay
              className="h-full w-full object-cover" style={{ filter: graded }} />
          ) : (
            <div className="flex h-full items-center justify-center text-zinc-700"><Film size={16} /></div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-white">{clip.url ? "Clip attached" : "No footage yet"}</div>
          <div className="mt-0.5 font-mono text-[10px] text-zinc-500">
            {clip.url
              ? `${seconds.toFixed(1)}s on the timeline${natural ? ` · source ${natural.toFixed(1)}s` : ""}`
              : `Holds ${seconds.toFixed(1)}s for its overlays`}
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/webm,video/*"
          className="hidden" data-testid="clip-upload-input"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }} />
        <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={uploading}
          data-testid="clip-upload"
          className="h-7 gap-1 rounded-lg border border-white/10 bg-white/5 px-2 text-[11px] text-white hover:bg-white/10">
          {uploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />} Upload
        </Button>
        <Button variant="secondary" onClick={onPickStock} data-testid="clip-stock"
          className="h-7 gap-1 rounded-lg border border-white/10 bg-white/5 px-2 text-[11px] text-white hover:bg-white/10">
          <Search size={11} /> Stock
        </Button>
        <Button variant="secondary" onClick={onPickLibrary} data-testid="clip-library"
          className="h-7 gap-1 rounded-lg border border-white/10 bg-white/5 px-2 text-[11px] text-white hover:bg-white/10">
          <Shapes size={11} /> Library
        </Button>
        <Button variant="secondary" onClick={onGenerate} data-testid="clip-generate"
          className="h-7 gap-1 rounded-lg border border-white/10 bg-white/5 px-2 text-[11px] text-white hover:bg-white/10">
          <Sparkles size={11} /> Generate
        </Button>
        {clip.url && (
          <Button variant="ghost" onClick={onClear} data-testid="clip-clear"
            className="h-7 px-2 text-[11px] text-zinc-500 hover:text-magic">Remove</Button>
        )}
      </div>

      <div className="mt-3 flex gap-1.5 border-t border-white/5 pt-2.5">
        {[{ k: "clip", l: "Clip" }, { k: "effects", l: "Effects" }, { k: "transition", l: "Transition" }].map((x) => (
          <Chip key={x.k} on={tab === x.k} onClick={() => setTab(x.k)} testid={`clip-tab-${x.k}`}>{x.l}</Chip>
        ))}
      </div>

      {tab === "clip" && (
        <>
          <Row label="Length" hint={`${seconds.toFixed(1)}s`}>
            <div className="flex items-center gap-2">
              <Slider min={MIN_CLIP_SECONDS} max={Math.max(6, Math.min(MAX_CLIP_SECONDS, natural || 15))} step={0.1}
                value={seconds} onChange={(v) => onChange(withLength(clip, v))} testid="clip-length" />
              <button onClick={() => patch({ hold: null })} disabled={!clip.hold} data-testid="clip-length-unpin"
                title={clip.hold ? "Pinned — click to follow the trim again" : "Following the trim"}
                className={`flex h-6 w-6 flex-none items-center justify-center rounded-md border transition-colors disabled:opacity-30 ${
                  clip.hold ? "border-lime text-lime" : "border-white/10 text-zinc-500"
                }`}>
                {clip.hold ? <Pin size={11} /> : <PinOff size={11} />}
              </button>
            </div>
          </Row>

          {clip.url && natural > 0 && (
            <Row label="Trim" hint={trimmed ? `${clip.start.toFixed(1)}s → ${(clip.end ?? natural).toFixed(1)}s` : ""}>
              <div className="space-y-1">
                <Slider min={0} max={Math.max(0.1, natural - MIN_CLIP_SECONDS)} step={0.1} value={clip.start}
                  onChange={(v) => patch({ start: Math.min(v, (clip.end ?? natural) - MIN_CLIP_SECONDS) })}
                  testid="clip-trim-start" />
                <Slider min={MIN_CLIP_SECONDS} max={natural} step={0.1} value={clip.end ?? natural}
                  onChange={(v) => patch({ end: Math.max(v, clip.start + MIN_CLIP_SECONDS) })}
                  testid="clip-trim-end" />
              </div>
            </Row>
          )}

          {clip.url && (
            <>
              <Row label="Speed" hint={`${clip.speed.toFixed(2)}×`}>
                <Slider min={0.25} max={4} step={0.05} value={clip.speed}
                  onChange={(v) => patch({ speed: v })} testid="clip-speed" />
              </Row>
              <Row label="Behind overlays" hint={`${Math.round(clip.opacity * 100)}%`}>
                <Slider min={0} max={1} step={0.05} value={clip.opacity}
                  onChange={(v) => patch({ opacity: v })} testid="clip-opacity" />
              </Row>
              <Row label="Framing">
                <div className="flex gap-1.5">
                  {["cover", "contain"].map((f) => (
                    <Chip key={f} on={clip.fit === f} onClick={() => patch({ fit: f })} testid={`clip-fit-${f}`}>{f}</Chip>
                  ))}
                </div>
              </Row>
              <Row label="Sound" hint={clip.volume === 0 ? "muted" : `${Math.round(clip.volume * 100)}%`}>
                <Slider min={0} max={1} step={0.05} value={clip.volume}
                  onChange={(v) => patch({ volume: v })} testid="clip-volume" />
              </Row>
            </>
          )}
        </>
      )}

      {tab === "effects" && (
        <>
          <Row label="Look">
            <div className="flex flex-wrap gap-1.5">
              {EFFECT_PRESETS.map((p) => (
                <Chip key={p.key} on={preset === p.key} testid={`clip-preset-${p.key}`}
                  onClick={() => onChange({ ...clip, effects: { ...p.effects } })}>{p.label}</Chip>
              ))}
            </div>
          </Row>
          {EFFECT_CONTROLS.map((e) => {
            const v = effectValue(clip.effects, e.key);
            return (
              <Row key={e.key} label={e.label} hint={v === e.neutral ? "—" : String(v)}>
                <Slider min={e.min} max={e.max} step={e.step} value={v}
                  onChange={(val) => patchEffects({ [e.key]: val })} testid={`clip-effect-${e.key}`} />
              </Row>
            );
          })}
        </>
      )}

      {tab === "transition" && (
        <>
          {isFirst ? (
            <p className="mt-2 text-[11px] text-zinc-600">
              The first scene has nothing to come from — a transition here would have nothing to blend with.
              Set one on any later scene to control how it arrives.
            </p>
          ) : (
            <>
              <Row label="How this scene arrives">
                <div className="flex flex-wrap gap-1.5">
                  {TRANSITIONS.map((x) => (
                    <Chip key={x.key} on={clip.transition.type === x.key} testid={`clip-transition-${x.key}`}
                      onClick={() => patch({ transition: { ...clip.transition, type: x.key } })}>{x.label}</Chip>
                  ))}
                </div>
              </Row>
              {clip.transition.type !== "cut" && (
                <Row label="Transition length" hint={`${clip.transition.duration.toFixed(1)}s`}>
                  <Slider min={0.1} max={2} step={0.1} value={clip.transition.duration}
                    onChange={(v) => patch({ transition: { ...clip.transition, duration: v } })}
                    testid="clip-transition-duration" />
                </Row>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
