import { Images, Film, Palette } from "lucide-react";

// Shown only once a saved design is chosen, because that's the only time
// there's anything to reuse. Picking a design used to mean taking ALL of it
// — its layout AND the exact pictures, footage and background colours that
// were in it when it was saved. That's right when you're re-running the
// same look for a new topic and wrong when those pictures were about the
// old topic, and there was no way to say which you meant short of deleting
// each one by hand afterward.
//
// Each row is the same question for a different kind of media: keep what
// the design has, or leave the slot empty for something new. The layout
// itself is never in question — the frame, its position and its size stay
// put either way, which is the whole point of having picked a design.
const CHOICES = [
  { key: "reuse", label: "Reuse" },
  { key: "new", label: "New" },
];

const ROWS = [
  {
    key: "images",
    label: "Images",
    icon: Images,
    // Deliberately says "pictures", not "images", so it can't be read as
    // including the logo — which is never replaced (see the backend's
    // _apply_template_layouts: role="logo" keeps its url either way).
    hint: { reuse: "the design's own pictures", new: "fresh pictures in the same frames" },
  },
  {
    key: "videos",
    label: "Videos",
    icon: Film,
    hint: { reuse: "the design's saved footage", new: "fresh footage per scene" },
  },
  {
    key: "backgrounds",
    label: "Backgrounds",
    icon: Palette,
    hint: { reuse: "the design's saved colours", new: "this slide's theme colour" },
  },
];

export function ComposerDesignMedia({ value, onChange, testid = "composer-design-media" }) {
  const patch = (p) => onChange({ ...value, ...p });

  return (
    <div className="mt-2 w-full rounded-lg border border-white/10 bg-[#0A0A0A] p-3" data-testid={testid}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">From this design</span>
        <span className="text-[11px] text-zinc-600">its layout is kept either way — this is only what fills it</span>
      </div>
      <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
        {ROWS.map((row) => {
          const Icon = row.icon;
          const picked = value?.[row.key] === "new" ? "new" : "reuse";
          return (
            <div key={row.key} className="rounded-lg border border-white/5 bg-[#121212] p-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-300">
                <Icon size={12} className="text-zinc-500" /> {row.label}
              </div>
              <div className="mt-1.5 flex items-center gap-1">
                {CHOICES.map((c) => (
                  <button key={c.key} type="button" onClick={() => patch({ [row.key]: c.key })}
                    data-testid={`${testid}-${row.key}-${c.key}`}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      picked === c.key ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-500 hover:text-white"
                    }`}>
                    {c.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] leading-snug text-zinc-600">{row.hint[picked]}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
