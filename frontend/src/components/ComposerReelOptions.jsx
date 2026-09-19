import { Minus, Plus } from "lucide-react";
import { useScriptStyles } from "@/lib/templateStyles";

// What a reel build asks for before it spends anything — scene count and
// structure, which of voiceover/music/footage to bother generating at all,
// and where the footage and score should come from. Every auto-build used
// to make all of these choices silently (platform default scene count, no
// intro/outro, everything on, stock search, whatever the topic implied for
// music) with no way to see or change any of it beforehand — the only lever
// was editing the result afterward, scene by scene. This is the "before you
// spend three API calls per scene" lever.
//
// `options` mirrors DEFAULT_REEL_OPTIONS (Composer.jsx); `onChange` gets a
// patch object merged into it, the same shallow-merge shape setState takes.

const VISUAL_SOURCES = [
  { key: "stock-video", label: "Stock video" },
  { key: "stock-image", label: "Stock image" },
  { key: "ai-video", label: "AI video" },
  { key: "ai-image", label: "AI image" },
];

const Toggle = ({ on, onClick, label, testid }) => (
  <button type="button" onClick={onClick} data-testid={testid}
    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
      on ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-500 hover:text-white"
    }`}>
    {label}
  </button>
);

export function ComposerReelOptions({ options, onChange, sceneRange }) {
  const patch = (p) => onChange({ ...options, ...p });
  const count = options.sceneCount || sceneRange.default;
  const setCount = (n) => patch({ sceneCount: Math.max(sceneRange.min, Math.min(sceneRange.max, n)) });
  const scriptStyles = useScriptStyles();
  const scriptStyle = options.scriptStyle || "standard";
  const active = scriptStyles.find((s) => s.key === scriptStyle);
  // This style's whole shape is "stop dead on the payoff", so an outro CTA
  // scene is the one thing it can't have. Rather than let the two contradict
  // each other in the prompt, picking it clears the outro toggle and the
  // control below says why it's gone.
  const noOutro = scriptStyle === "viral-short";

  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-[#0A0A0A] p-3" data-testid="composer-reel-options">
      <div className="mb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">Script style</span>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {scriptStyles.map((s) => (
            <button key={s.key} type="button" title={s.desc}
              onClick={() => patch({ scriptStyle: s.key, ...(s.key === "viral-short" ? { outro: false } : {}) })}
              data-testid={`composer-reel-script-${s.key}`}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                scriptStyle === s.key ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-500 hover:text-white"
              }`}>
              {s.label}
            </button>
          ))}
        </div>
        {active?.desc && (
          <p className="mt-1.5 text-[11px] text-zinc-500" data-testid="composer-reel-script-desc">{active.desc}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">Scenes</span>
          <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-[#121212] px-1 py-1">
            <button type="button" onClick={() => setCount(count - 1)} disabled={count <= sceneRange.min}
              data-testid="composer-reel-scenes-minus"
              className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:text-white disabled:opacity-30">
              <Minus size={12} />
            </button>
            <span className="w-5 text-center font-mono text-xs text-white" data-testid="composer-reel-scenes-count">{count}</span>
            <button type="button" onClick={() => setCount(count + 1)} disabled={count >= sceneRange.max}
              data-testid="composer-reel-scenes-plus"
              className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:text-white disabled:opacity-30">
              <Plus size={12} />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Toggle on={options.intro} onClick={() => patch({ intro: !options.intro })}
            label="+ Intro hook" testid="composer-reel-intro" />
          <Toggle on={options.outro} onClick={() => patch({ outro: !options.outro })}
            label={noOutro ? "+ Outro CTA (ends on the payoff)" : "+ Outro CTA"} testid="composer-reel-outro" />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">Include</span>
        <Toggle on={options.includeVoiceover} onClick={() => patch({ includeVoiceover: !options.includeVoiceover })}
          label="Voiceover" testid="composer-reel-include-voiceover" />
        <Toggle on={options.includeMusic} onClick={() => patch({ includeMusic: !options.includeMusic })}
          label="Music" testid="composer-reel-include-music" />
        <Toggle on={options.includeFootage} onClick={() => patch({ includeFootage: !options.includeFootage })}
          label="Footage" testid="composer-reel-include-footage" />
      </div>

      {options.includeFootage && (
        <div className="mt-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">Visuals</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {VISUAL_SOURCES.map((v) => (
              <button key={v.key} type="button" onClick={() => patch({ visualSource: v.key })}
                data-testid={`composer-reel-visual-${v.key}`}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  options.visualSource === v.key ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-500 hover:text-white"
                }`}>
                {v.label}
              </button>
            ))}
          </div>
          <input value={options.visualStyle} onChange={(e) => patch({ visualStyle: e.target.value })}
            placeholder="Look and feel — moody film grain, bright and minimal, hand-drawn…"
            data-testid="composer-reel-visual-style"
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#121212] px-3 py-1.5 text-xs text-white outline-none focus:border-lime placeholder:text-zinc-600" />
        </div>
      )}

      {options.includeMusic && (
        <div className="mt-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">Music style <span className="normal-case tracking-normal text-zinc-700">(blank = auto, from the topic)</span></span>
          <input value={options.musicStyle} onChange={(e) => patch({ musicStyle: e.target.value })}
            placeholder="Upbeat lo-fi, cinematic strings, driving synthwave…"
            data-testid="composer-reel-music-style"
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#121212] px-3 py-1.5 text-xs text-white outline-none focus:border-lime placeholder:text-zinc-600" />
        </div>
      )}
    </div>
  );
}
