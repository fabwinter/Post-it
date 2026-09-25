import { lineSettings } from "@/components/StyledText";

export function LineSizeControls({ element, onPatch, prefix }) {
  const lines = String(element.text || "").split("\n");
  if (lines.length < 2) return null;
  const settings = lineSettings(element);
  const update = (index, key, value) => {
    const values = settings.map((line) => line[key]);
    values[index] = value;
    onPatch({ [key === "size" ? "lineSizes" : "fitLines"]: values });
  };
  return (
    <div className="mt-3 space-y-2 border-t border-white/10 pt-3" data-testid={`${prefix}-line-sizes`}>
      <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Individual lines</p>
      {lines.map((line, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2 text-xs text-zinc-300">
          <span className="w-20 truncate" title={line || `Line ${index + 1}`}>{line || `Line ${index + 1}`}</span>
          <input type="number" min="8" max="240" aria-label={`Line ${index + 1} font size`}
            data-testid={`${prefix}-line-size-${index}`} value={settings[index].size}
            onChange={(event) => {
              const size = Number(event.target.value);
              if (size >= 8 && size <= 240) update(index, "size", size);
            }}
            disabled={settings[index].fit}
            className="h-9 w-16 rounded-lg border border-white/10 bg-[#0A0A0A] px-2 text-white disabled:opacity-40" />
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={settings[index].fit} onChange={(event) => update(index, "fit", event.target.checked)}
              data-testid={`${prefix}-line-fit-${index}`} className="accent-lime" /> Fit width
          </label>
        </div>
      ))}
    </div>
  );
}
