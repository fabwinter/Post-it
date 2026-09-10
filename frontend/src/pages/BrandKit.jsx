import { useEffect, useRef, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";
import { useBrand } from "@/lib/useBrand";
import { VisualCard } from "@/components/VisualCard";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Palette, Save, Loader2, Plus, X, Upload, ImageOff, Sparkles, Image as ImageIcon,
  FileText, Link as LinkIcon, Check, Shapes,
} from "lucide-react";

const COLOR_FIELDS = [
  { key: "bg", label: "Background" },
  { key: "fg", label: "Text" },
  { key: "accent", label: "Accent" },
  { key: "sub", label: "Muted" },
];

const IMPORT_TYPES = [
  { key: "image", label: "Image", icon: ImageIcon, accept: "image/*" },
  { key: "svg", label: "SVG", icon: Shapes, accept: ".svg,image/svg+xml" },
  { key: "pdf", label: "PDF", icon: FileText, accept: ".pdf,application/pdf" },
  { key: "url", label: "Website URL", icon: LinkIcon },
];

export default function BrandKit() {
  const { brand, loading, reload } = useBrand();
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

  useEffect(() => { if (!loading) setForm(brand); }, [loading, brand]);

  if (!form) {
    return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-zinc-600" /></div>;
  }

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  const setColor = (k, v) => setForm((s) => ({ ...s, colors: { ...s.colors, [k]: v } }));

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
      await api.put("/brand-kit", {
        name: form.name, colors: form.colors, fonts: form.fonts, logo_url: form.logo_url || null,
        handle: form.handle, voice: form.voice, style: form.style, audience: form.audience,
        hashtags: form.hashtags, cta: form.cta, banned_words: form.banned_words,
      });
      await reload();
      toast.success("Brand kit saved — every generation uses it from now on.");
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
    setForm((s) => ({
      ...s,
      colors: Object.keys(analysis.colors || {}).length ? { ...s.colors, ...analysis.colors } : s.colors,
      fonts: Object.keys(analysis.fonts || {}).length ? { ...s.fonts, ...analysis.fonts } : s.fonts,
      logo_url: analysis.logo_url || s.logo_url,
      voice: analysis.voice || s.voice,
      style: analysis.style || s.style,
      name: (!s.name || s.name === "Default brand") && analysis.detected_name ? analysis.detected_name : s.name,
    }));
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

      <div className="mt-7 grid gap-6 lg:grid-cols-[1fr_minmax(0,340px)]">
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
            <h3 className="font-display text-base font-semibold">Palette</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {COLOR_FIELDS.map((c) => (
                <div key={c.key}>
                  <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">{c.label}</label>
                  <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-white/10 bg-[#0A0A0A] px-2 py-1.5">
                    <input type="color" value={form.colors?.[c.key] || "#000000"} data-testid={`brand-color-${c.key}`}
                      onChange={(e) => setColor(c.key, e.target.value)}
                      className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0" />
                    <input value={form.colors?.[c.key] || ""} onChange={(e) => setColor(c.key, e.target.value)}
                      className="w-full bg-transparent font-mono text-xs text-zinc-300 outline-none" />
                  </div>
                </div>
              ))}
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
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save brand kit
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
