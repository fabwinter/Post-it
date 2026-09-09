// A "Model" field for any AI text-generation surface (Write, Repurpose,
// Visuals, ...). Renders a real dropdown once /ai/models resolves; falls
// back to a free-text input (prefilled with the server default) so the
// feature still works if PoYo doesn't expose a model list.
export function ModelPicker({ value, onChange, models, testid, className = "" }) {
  const base = "w-full rounded-lg border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-lime";

  if (models && models.length > 0) {
    const opts = value && !models.includes(value) ? [value, ...models] : models;
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testid}
        className={`cursor-pointer [color-scheme:dark] ${base} ${className}`}
      >
        {opts.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
    );
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid={testid}
      placeholder="Model ID (e.g. gemini-3-flash-preview)"
      className={`${base} ${className}`}
    />
  );
}
