import { useEffect, useRef, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";
import { useBrandKits } from "@/lib/useBrand";
import { BRAND_FONTS } from "@/lib/fonts";
import { VisualCard } from "@/components/VisualCard";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Palette, Save, Loader2, Plus, X, Upload, ImageOff, Sparkles, Image as ImageIcon,
  FileText, Link as LinkIcon, Check, Shapes, Star, Trash2, Moon, Sun, Type,
} from "lucide-react";

const COLOR_FIELDS = [
  { key: "bg", label: "Primary" },
  { key: "fg", label: "Secondary" },
  { key: "accent", label: "Tertiary" },
  { key: "sub", label: "Muted" },
];

const IMPORT_TYPES = [
  { key: "image", label: "Image", icon: ImageIcon, accept: "image/*" },
  { key: "svg", label: "SVG", icon: Shapes, accept: ".svg,image/svg+xml" },
  { key: "pdf", label: "PDF", icon: FileText, accept: ".pdf,application/pdf" },
  { key: "url", label: "Website URL", icon: LinkIcon },
];

const emptyKit = () => ({
  id: null, name: "New brand kit",
  colors: { dark: { bg: "#0A0A0A", fg: "#FFFFFF", accent: "#E2FF3D", sub: "#a1a1aa" },
            light: { bg: "#FFFFFF", fg: "#0A0A0A", accent: "#0047FF", sub: "#6b7280" } },
  color_mode: "dark", fonts: { display: "Inter", body: "Inter" },
  logo_url: null, handle: "", voice: "", style: "", audience: "",
  hashtags: [], cta: "", banned_words: [], is_default: false,
});

export default function BrandKit() {
  const { kits, loading, reload } = useBrandKits();
  const [selectedId, setSelectedId] = useState(undefined); // undefined = not landed yet, null = new unsaved kit
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef(null);

  const [importType, setImportType] = useState("image");
  const [importUrl, setImportUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [applied, setApplied] = useState(false);
  const importFileRef = useRef(null);

  // Land on the default kit once the list loads, and again whenever the
  // selected kit disappears (deleted, say) — but never fight a manual pick.
  useEffect(() => {
    if (loading) return;
    if (selectedId !== undefined && (selectedId === null || kits.some((k) => k.id === selectedId))) return;
    const target = kits.find((k) => k.is_default) || kits[0];
    if (target) { setSelectedId(target.id); setForm(target); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, kits]);

  if (!form) {
    return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-zinc-600" /></div>;
  }

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  const mode = form.color_mode === "light" ? "light" : "dark";
  const setColor = (k, v) => setForm((s) => ({ ...s, colors: { ...s.colors, [mode]: { ...s.colors[mode], [k]: v } } }));

  const selectKit = (kit) => { setSelectedId(kit.id); setForm(kit); setAnalysis(null); setApplied(false); };
  const newKit = () => { setSelectedId(null); setForm(emptyKit()); setAnalysis(null); setApplied(false); };

  const deleteKit = async (kit) => {
    if (!kit.id) return;
    if (kits.length <= 1) { toast.error("Can't delete your only brand kit."); return; }
    if (!window.confirm(`Delete "${kit.name}"? This can't be undone.`)) return;
    try {
      await api.delete(`/brand-kits/${kit.id}`);
      toast.success("Brand kit deleted");
      if (selectedId === kit.id) setSelectedId(undefined);
      await reload();
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't delete that kit.")); }
  };

  const makeDefault = async (kit) => {
    if (!kit.id || kit.is_default) return;
    try {
      await api.put(`/brand-kits/${kit.id}`, { is_default: true });
      toast.success(`${kit.name} is now the default kit`);
      await reload();
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't set the default.")); }
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    setUploadingLogo(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const { data } = await api.post("/upload", body);
      set("logo_url", data.url);
      toast.success("Logo uploaded");
    } catch (e) { toast.error(apiErrorMessage(e, "Upload failed.")); }
    finally { setUploadingLogo(false); if (logoInputRef.current) logoInputRef.current.value = ""; }
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        name: form.name, colors: form.colors, color_mode: form.color_mode, fonts: form.fonts,
        logo_url: form.logo_url || null, handle: form.handle, voice: form.voice, style: form.style,
        audience: form.audience, hashtags: form.hashtags, cta: form.cta, banned_words: form.banned_words,
      };
      const { data } = form.id ? await api.put(`/brand-kits/${form.id}`, payload) : await api.post("/brand-kits", payload);
      setSelectedId(data.id); setForm(data);
      await reload();
      toast.success("Brand kit saved — every generation can use it from now on.");
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't save the brand kit.")); }
    finally { setSaving(false); }
  };

  // Runs the analysis for whichever source is picked — an uploaded file for
  // image/svg/pdf, or the URL text field directly for a website.
  const runAnalysis = async (file) => {
    setAnalyzing(true); setAnalysis(null); setApplied(false);
    try {
      let sourceUrl = importUrl;
      if (importType !== "url") {
        if (!file) { setAnalyzing(false); return; }
        const body = new FormData();
        body.append("file", file);
        const { data: up } = await api.post("/upload", body);
        sourceUrl = up.url;
      } else if (!importUrl.trim()) {
        toast.error("Paste a website URL first.");
        setAnalyzing(false);
        return;
      }
      const { data } = await api.post("/brand-kit/analyze", { source_type: importType, source_url: sourceUrl });
      setAnalysis(data);
    } catch (e) { toast.error(apiErrorMessage(e, "Analysis failed.")); }
    finally { setAnalyzing(false); if (importFileRef.current) importFileRef.current.value = ""; }
  };

  // Merges the analyzed fields into the form — Save still has to be clicked,
  // so nothing overwrites the saved brand kit without a review.
  const applyAnalysis = () => {
    if (!analysis) return;
    setForm((s) => {
      const m = s.color_mode === "light" ? "light" : "dark";
      return {
        ...s,
        colors: Object.keys(analysis.colors || {}).length
          ? { ...s.colors, [m]: { ...s.colors[m], ...analysis.colors } } : s.colors,
        fonts: Object.keys(analysis.fonts || {}).length ? { ...s.fonts, ...analysis.fonts } : s.fonts,
        logo_url: analysis.logo_url || s.logo_url,
        voice: analysis.voice || s.voice,
        style: analysis.style || s.style,
        name: (!s.name || s.name === "Default brand" || s.name === "New brand kit") && analysis.detected_name
          ? analysis.detected_name : s.name,
      };
    });
    setApplied(true);
    toast.success("Applied — review below, then Save.");
  };

  return (
    <div data-testid="brand-page">
      <div className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">Brand kit</div>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Teach it your brand once</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-500">
        The kit feeds three things at once: the words (voice, audience, banned words go into every copy prompt),
        the pictures (your palette is injected into image prompts and available as a graphic theme),
        and the finish (signature hashtags and CTA get appended to built posts).
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-1.5" data-testid="brand-kit-switcher">
        {kits.map((k) => (
          <div key={k.id || "new"}
            className={`flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-1.5 text-xs font-medium transition-colors ${form.id === k.id ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
            <button onClick={() => selectKit(k)} data-testid={`brand-kit-select-${k.id}`} className="flex items-center gap-1.5 py-0.5 pl-1.5">
              <span className="h-3 w-3 flex-shrink-0 rounded-full border border-white/20" style={{ background: (k.colors?.[k.color_mode || "dark"] || k.colors?.dark)?.bg }} />
              {k.name}{k.is_default && <Star size={11} className="fill-current text-lime" />}
            </button>
            {form.id === k.id && !k.is_default && (
              <button onClick={() => makeDefault(k)} title="Set as default" data-testid={`brand-kit-make-default-${k.id}`} className="text-zinc-600 hover:text-lime"><Star size={12} /></button>
            )}
            {form.id === k.id && kits.length > 1 && (
              <button onClick={() => deleteKit(k)} title="Delete kit" data-testid={`brand-kit-delete-${k.id}`} className="text-zinc-600 hover:text-magic"><Trash2 size={12} /></button>
            )}
          </div>
        ))}
        <button onClick={newKit} data-testid="brand-kit-new"
          className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${selectedId === null ? "border-lime bg-lime/10 text-lime" : "border-dashed border-white/15 text-zinc-500 hover:border-lime/40 hover:text-lime"}`}>
          <Plus size={12} /> New kit
        </button>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_minmax(0,340px)]">
        <div className="space-y-5">
          <section className="rounded-xl border border-white/10 bg-[#121212] p-5">
            <h3 className="font-display text-base font-semibold">Identity</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Brand name" value={form.name} onChange={(v) => set("name", v)} testid="brand-name" />
              <Field label="Handle / wordmark" value={form.handle} onChange={(v) => set("handle", v)}
                placeholder="@yourhandle" testid="brand-handle" />
            </div>
            <div className="mt-4">
              <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">Logo</label>
              <div className="mt-1.5 flex items-center gap-3">
                <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-[#0A0A0A]" data-testid="brand-logo-preview">
                  {form.logo_url ? (
                    <img src={form.logo_url} alt="Logo" className="h-full w-full object-contain" />
                  ) : (
                    <ImageOff size={18} className="text-zinc-700" />
                  )}
                </div>
                <div className="flex flex-1 flex-wrap gap-2">
                  <input ref={logoInputRef} type="file" accept="image/*,.svg" className="hidden" data-testid="brand-logo-upload-input"
                    onChange={(e) => uploadLogo(e.target.files?.[0])} />
                  <Button variant="secondary" onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo} data-testid="brand-logo-upload"
                    className="h-8 gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-white hover:bg-white/10">
                    {uploadingLogo ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Upload logo
                  </Button>
                  {form.logo_url && (
                    <Button variant="ghost" onClick={() => set("logo_url", "")} data-testid="brand-logo-remove"
                      className="h-8 gap-1.5 px-2.5 text-xs text-zinc-500 hover:text-magic">
                      <X size={13} /> Remove
                    </Button>
                  )}
                </div>
              </div>
              <input value={form.logo_url || ""} onChange={(e) => set("logo_url", e.target.value)}
                placeholder="or paste a logo URL" data-testid="brand-logo"
                className="mt-2 w-full rounded-lg border border-white/10 bg-[#0A0A0A] px-3 py-2 text-xs text-zinc-400 outline-none transition-colors placeholder:text-zinc-700 focus:border-lime" />
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-[#121212] p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold">Palette</h3>
              <div className="flex items-center gap-1 rounded-full border border-white/10 bg-[#0A0A0A] p-0.5" data-testid="brand-color-mode">
                <button onClick={() => set("color_mode", "dark")} data-testid="brand-color-mode-dark"
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${mode === "dark" ? "bg-lime/10 text-lime" : "text-zinc-500 hover:text-white"}`}>
                  <Moon size={11} /> Dark
                </button>
                <button onClick={() => set("color_mode", "light")} data-testid="brand-color-mode-light"
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${mode === "light" ? "bg-lime/10 text-lime" : "text-zinc-500 hover:text-white"}`}>
                  <Sun size={11} /> Light
                </button>
              </div>
            </div>
            <p className="mt-1.5 text-xs text-zinc-500">Two palettes per kit — pick which one a graphic renders with when you apply this brand's theme.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {COLOR_FIELDS.map((c) => (
                <div key={c.key}>
                  <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">{c.label}</label>
                  <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-white/10 bg-[#0A0A0A] px-2 py-1.5">
                    <input type="color" value={form.colors?.[mode]?.[c.key] || "#000000"} data-testid={`brand-color-${c.key}`}
                      onChange={(e) => setColor(c.key, e.target.value)}
                      className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0" />
                    <input value={form.colors?.[mode]?.[c.key] || ""} onChange={(e) => setColor(c.key, e.target.value)}
                      data-testid={`brand-color-${c.key}-hex`}
                      className="w-full bg-transparent font-mono text-xs text-zinc-300 outline-none" />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-[#121212] p-5">
            <h3 className="flex items-center gap-2 font-display text-base font-semibold"><Type size={15} className="text-lime" /> Fonts</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <FontField label="Display / headings" value={form.fonts?.display} onChange={(v) => set("fonts", { ...form.fonts, display: v })} testid="brand-font-display" />
              <FontField label="Body text" value={form.fonts?.body} onChange={(v) => set("fonts", { ...form.fonts, body: v })} testid="brand-font-body" />
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-[#121212] p-5">
            <h3 className="font-display text-base font-semibold">Voice</h3>
            <Area className="mt-4" label="How the brand sounds" value={form.voice} onChange={(v) => set("voice", v)}
              placeholder="Direct and technical. Short sentences. Concrete numbers over adjectives. Never salesy."
              testid="brand-voice" />
            <Area className="mt-4" label="Visual style" value={form.style} onChange={(v) => set("style", v)}
              placeholder="Minimal, high-contrast, lots of negative space. Bold type, no gradients." testid="brand-style" rows={2} />
            <Area className="mt-4" label="Who you're talking to" value={form.audience} onChange={(v) => set("audience", v)}
              placeholder="Solo founders shipping their first product." testid="brand-audience" rows={2} />
            <Field className="mt-4" label="Default call to action" value={form.cta} onChange={(v) => set("cta", v)}
              placeholder="Follow for the weekly build log." testid="brand-cta" />
            <TagList className="mt-4" label="Signature hashtags" values={form.hashtags} testid="brand-hashtags"
              onChange={(v) => set("hashtags", v)} placeholder="#buildinpublic" />
            <TagList className="mt-4" label="Never use these words" values={form.banned_words} testid="brand-banned"
              onChange={(v) => set("banned_words", v)} placeholder="synergy" />
          </section>

          <section className="rounded-xl border border-white/10 bg-[#121212] p-5" data-testid="brand-import">
            <h3 className="flex items-center gap-2 font-display text-base font-semibold">
              <Sparkles size={15} className="text-lime" /> Build it from something you already have
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
              An image or SVG gives a real palette pulled from its actual pixels or markup. A PDF or website
              gives voice and style inferred from its actual text — not a guess at what the page "looks like".
            </p>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {IMPORT_TYPES.map((t) => {
                const Icon = t.icon;
                return (
                  <button key={t.key} onClick={() => { setImportType(t.key); setAnalysis(null); }} data-testid={`brand-import-type-${t.key}`}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${importType === t.key ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
                    <Icon size={13} /> {t.label}
                  </button>
                );
              })}
            </div>

            {importType === "url" ? (
              <div className="mt-3 flex gap-2">
                <input value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="https://yourbrand.com"
                  data-testid="brand-import-url" className="flex-1 rounded-lg border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm text-white outline-none focus:border-lime" />
                <Button onClick={() => runAnalysis()} disabled={analyzing} data-testid="brand-import-analyze"
                  className="gap-1.5 rounded-lg bg-lime px-4 text-xs font-semibold text-[#0A0A0A] hover:bg-lime-hover">
                  {analyzing ? <Loader2 size={14} className="animate-spin" /> : "Analyze"}
                </Button>
              </div>
            ) : (
              <div className="mt-3">
                <input ref={importFileRef} type="file" accept={IMPORT_TYPES.find((t) => t.key === importType)?.accept}
                  className="hidden" data-testid="brand-import-file-input" onChange={(e) => runAnalysis(e.target.files?.[0])} />
                <Button variant="secondary" onClick={() => importFileRef.current?.click()} disabled={analyzing} data-testid="brand-import-analyze"
                  className="gap-2 rounded-lg border border-white/10 bg-white/5 text-xs text-white hover:bg-white/10">
                  {analyzing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {analyzing ? "Analyzing…" : `Upload ${importType} to analyze`}
                </Button>
              </div>
            )}

            {analysis && (
              <div className="mt-4 rounded-lg border border-white/10 bg-[#0A0A0A] p-4" data-testid="brand-import-result">
                {Object.keys(analysis.colors || {}).length > 0 && (
                  <div className="flex items-center gap-1.5">
                    {Object.entries(analysis.colors).map(([k, hex]) => (
                      <span key={k} title={`${k}: ${hex}`} className="h-6 w-6 rounded-full border border-white/20" style={{ background: hex }} />
                    ))}
                  </div>
                )}
                {Object.keys(analysis.fonts || {}).length > 0 && (
                  <p className="mt-2.5 text-xs text-zinc-400">Fonts: {Object.values(analysis.fonts).join(", ")}</p>
                )}
                {analysis.style && <p className="mt-2.5 text-xs leading-relaxed text-zinc-300">{analysis.style}</p>}
                {analysis.voice && <p className="mt-2 text-xs leading-relaxed text-zinc-300">{analysis.voice}</p>}
                <p className="mt-3 text-[11px] italic leading-relaxed text-zinc-600">{analysis.source_note}</p>
                <Button onClick={applyAnalysis} data-testid="brand-import-apply"
                  className="mt-3 gap-1.5 rounded-lg bg-lime px-3 py-1.5 text-xs font-semibold text-[#0A0A0A] hover:bg-lime-hover">
                  {applied ? <Check size={13} /> : <Sparkles size={13} />} {applied ? "Applied" : "Apply to the form above"}
                </Button>
              </div>
            )}
          </section>

          <Button onClick={save} disabled={saving} data-testid="brand-save"
            className="w-full gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover sm:w-auto">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {form.id ? "Save brand kit" : "Create brand kit"}
          </Button>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-xl border border-white/10 bg-[#121212] p-5">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">
              <Palette size={13} className="text-lime" /> Live preview
            </div>
            <div className="mt-4 aspect-square w-full overflow-hidden rounded-xl" data-testid="brand-preview">
              <VisualCard brand={form} spec={{
                template: "cover", theme: "brand", index: 0, total: 1,
                title: form.name && form.name !== "Default brand" ? `${form.name} — this is your cover slide` : "This is your cover slide",
              }} />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-zinc-600">
              Pick the <span className="text-zinc-400">Brand</span> theme anywhere a graphic is generated to render it in these colours.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls = "mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A0A0A] px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-zinc-700 focus:border-lime";

const Field = ({ label, value, onChange, placeholder, testid, className = "" }) => (
  <div className={className}>
    <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">{label}</label>
    <input value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      data-testid={testid} className={inputCls} />
  </div>
);

const FontField = ({ label, value, onChange, testid, className = "" }) => {
  // A detected font from brand analysis might not be in the curated list —
  // keep it selectable rather than silently dropping it.
  const options = BRAND_FONTS.some((f) => f.key === value) || !value
    ? BRAND_FONTS
    : [{ key: value, label: `${value} (detected)` }, ...BRAND_FONTS];
  return (
    <div className={className}>
      <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">{label}</label>
      <select value={value || "Inter"} onChange={(e) => onChange(e.target.value)} data-testid={testid}
        className={`${inputCls} [color-scheme:dark]`} style={{ fontFamily: "inherit" }}>
        {options.map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
      </select>
    </div>
  );
};

const Area = ({ label, value, onChange, placeholder, testid, rows = 3, className = "" }) => (
  <div className={className}>
    <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">{label}</label>
    <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows}
      data-testid={testid} className={`${inputCls} resize-none leading-relaxed`} />
  </div>
);

function TagList({ label, values = [], onChange, placeholder, testid, className = "" }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v || values.includes(v)) { setDraft(""); return; }
    onChange([...values, v]); setDraft("");
  };
  return (
    <div className={className}>
      <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">{label}</label>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {values.map((v) => (
          <span key={v} className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 py-1 pl-2.5 pr-1.5 text-xs text-zinc-300">
            {v}
            <button onClick={() => onChange(values.filter((x) => x !== v))} className="text-zinc-600 hover:text-magic"><X size={12} /></button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} data-testid={testid}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          className="flex-1 rounded-lg border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-700 focus:border-lime" />
        <Button variant="secondary" onClick={add} data-testid={`${testid}-add`}
          className="gap-1 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-white hover:bg-white/10"><Plus size={14} /></Button>
      </div>
    </div>
  );
}
