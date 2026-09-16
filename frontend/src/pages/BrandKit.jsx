import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { toPng } from "html-to-image";
import { api, apiErrorMessage } from "@/lib/api";
import { useBrandKits } from "@/lib/useBrand";
import { PLATFORM_LIST } from "@/lib/platforms";
import { groupFontsByCategory, fontStack, useAllFontsLoaded, useFontCatalog } from "@/lib/fonts";
import { CustomFontsPanel, FontNotice } from "@/components/CustomFonts";
import { BrandGuidelineDoc } from "@/components/BrandGuidelineDoc";
import { COLOR_FIELDS, TYPE_ROLES, WEIGHTS, LOGO_POSITIONS, getTypeStyle } from "@/lib/brandGuideline";
import { KnowledgeBase } from "@/components/KnowledgeBase";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Save, Loader2, Plus, X, Upload, ImageOff, Sparkles, Image as ImageIcon,
  FileText, Link as LinkIcon, Check, Shapes, Star, Trash2, Moon, Sun, Type, Download, ScrollText,
  Plug, ExternalLink, Palette,
} from "lucide-react";

const TABS = [
  { key: "brand", label: "Brand" },
  { key: "connections", label: "Connections" },
];

const emptyGuideline = () => ({
  logos: { color: "", black_on_white: "", white_on_black: "" },
  logo_clear_space: "", logo_min_size: "", logo_dos: [], logo_donts: [],
  imagery_mood: "", imagery_color: "", icon_style: "",
  voice_attributes: [], voice_do: "", voice_dont: "",
  doc_owner: "", version: "v1.0",
  naming_conventions: "", logo_position: "", logo_placement_notes: "",
  color_usage: "", typography: {},
});

const LOGO_VARIANTS = [
  { key: "color", label: "Full color" },
  { key: "black_on_white", label: "Black on white" },
  { key: "white_on_black", label: "White on black" },
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
  hashtags: [], cta: "", banned_words: [], guideline: emptyGuideline(), is_default: false,
});

export default function BrandKit() {
  const location = useLocation();
  const state = location.state || {};
  const [tab, setTab] = useState(state.tab === "connections" ? "connections" : "brand");
  const { kits, loading, reload } = useBrandKits();
  const [selectedId, setSelectedId] = useState(undefined); // undefined = not landed yet, null = new unsaved kit
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingVariant, setUploadingVariant] = useState(null); // key of the logo variant currently uploading, or null
  const [downloadingGuideline, setDownloadingGuideline] = useState(false);
  const logoInputRef = useRef(null);
  const guidelineRef = useRef(null);

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

  // Connections needs none of the brand-kit data above (or its load state) —
  // publishing setup lives here now because it's part of the brand/account
  // setup, not because it depends on a kit being selected.
  const tabsBar = (
    <div className="mt-6 flex flex-wrap gap-1.5" data-testid="brand-tabs">
      {TABS.map((t) => (
        <button key={t.key} onClick={() => setTab(t.key)} data-testid={`brand-tab-${t.key}`}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${tab === t.key ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
          {t.key === "brand" ? <Palette size={13} /> : <Plug size={13} />} {t.label}
        </button>
      ))}
    </div>
  );

  if (tab === "connections") {
    return (
      <div data-testid="brand-page">
        <div className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">Brand kit</div>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Where posts actually go</h1>
        {tabsBar}
        <ConnectionsPanel />
      </div>
    );
  }

  if (!form) {
    return (
      <div data-testid="brand-page">
        <div className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">Brand kit</div>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Teach it your brand once</h1>
        {tabsBar}
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-zinc-600" /></div>
      </div>
    );
  }

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  const mode = form.color_mode === "light" ? "light" : "dark";
  const setColor = (k, v) => setForm((s) => ({ ...s, colors: { ...s.colors, [mode]: { ...s.colors[mode], [k]: v } } }));
  const setGuideline = (k, v) => setForm((s) => ({ ...s, guideline: { ...emptyGuideline(), ...s.guideline, [k]: v } }));
  const setLogoVariant = (key, url) => setForm((s) => ({
    ...s, guideline: { ...emptyGuideline(), ...s.guideline, logos: { ...emptyGuideline().logos, ...s.guideline?.logos, [key]: url } },
  }));

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

  const uploadLogoVariant = async (key, file, inputEl) => {
    if (!file) return;
    setUploadingVariant(key);
    try {
      const body = new FormData();
      body.append("file", file);
      const { data } = await api.post("/upload", body);
      setLogoVariant(key, data.url);
      toast.success("Logo uploaded");
    } catch (e) { toast.error(apiErrorMessage(e, "Upload failed.")); }
    finally { setUploadingVariant(null); if (inputEl) inputEl.value = ""; }
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        name: form.name, colors: form.colors, color_mode: form.color_mode, fonts: form.fonts,
        logo_url: form.logo_url || null, handle: form.handle, voice: form.voice, style: form.style,
        audience: form.audience, hashtags: form.hashtags, cta: form.cta, banned_words: form.banned_words,
        guideline: form.guideline,
      };
      const { data } = form.id ? await api.put(`/brand-kits/${form.id}`, payload) : await api.post("/brand-kits", payload);
      setSelectedId(data.id); setForm(data);
      await reload();
      toast.success("Brand kit saved — every generation can use it from now on.");
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't save the brand kit.")); }
    finally { setSaving(false); }
  };

  // The whole kit, colours/fonts/voice plus every knowledge document it can
  // see, as one JSON file — the only way any of it leaves this database.
  const exportKit = async () => {
    if (!form.id) return;
    setExporting(true);
    try {
      const { data } = await api.get(`/brand-kits/${form.id}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(form.name || "brand-kit").replace(/\W+/g, "-").toLowerCase()}-backup.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Downloaded — brand kit and knowledge base, in one file.");
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't export the brand kit.")); }
    finally { setExporting(false); }
  };

  // The one-page guideline reflects the form live (including unsaved edits)
  // so what you download always matches what's on screen — but it's built
  // from the same data Save persists, so downloading right after Save is
  // exactly what a teammate would see if they opened this kit later.
  const downloadGuideline = async () => {
    if (!guidelineRef.current) return;
    setDownloadingGuideline(true);
    try {
      const url = await toPng(guidelineRef.current, { pixelRatio: 2, cacheBust: true });
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(form.name || "brand-guideline").replace(/\W+/g, "-").toLowerCase()}-guideline.png`;
      a.click();
      toast.success("Downloaded brand guideline");
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't export the guideline.")); }
    finally { setDownloadingGuideline(false); }
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
      {tabsBar}
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

      <div className="mt-5 space-y-5">
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
              <h3 className="font-display text-base font-semibold">Colour Palette</h3>
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
                      aria-label={`${c.label} colour`}
                      onChange={(e) => setColor(c.key, e.target.value)}
                      className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0" />
                    <input value={form.colors?.[mode]?.[c.key] || ""} onChange={(e) => setColor(c.key, e.target.value)}
                      data-testid={`brand-color-${c.key}-hex`}
                      aria-label={`${c.label} hex`}
                      className="w-full bg-transparent font-mono text-xs text-zinc-300 outline-none" />
                  </div>
                  <p className="mt-1 text-xs text-zinc-400">{c.usage}</p>
                </div>
              ))}
            </div>
            <Area className="mt-4" label="Colour usage" value={form.guideline?.color_usage}
              onChange={(v) => setGuideline("color_usage", v)} rows={2}
              placeholder="Describe approved combinations, proportions and exceptions."
              testid="brand-guideline-color-usage" />
          </section>

          <section className="rounded-xl border border-white/10 bg-[#121212] p-5">
            <h3 className="flex items-center gap-2 font-display text-base font-semibold"><Type size={15} className="text-lime" /> Typography</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <FontField label="Display / headings" value={form.fonts?.display} onChange={(v) => set("fonts", { ...form.fonts, display: v })} testid="brand-font-display" />
              <FontField label="Body text" value={form.fonts?.body} onChange={(v) => set("fonts", { ...form.fonts, body: v })} testid="brand-font-body" />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-zinc-400">
              Default families above also apply to generated graphics. The hierarchy below defines the guideline sheet;
              sizes are CSS pixels at its full 850px reference width, not post-template sizes.
            </p>
            <div className="mt-4 space-y-4">
              {TYPE_ROLES.map((role) => {
                const type = getTypeStyle(form, role);
                const raw = form.guideline?.typography?.[role.key] || {};
                const update = (key, value) => setGuideline("typography", {
                  ...form.guideline?.typography, [role.key]: { ...raw, [key]: value },
                });
                return (
                  <fieldset key={role.key} className="min-w-0 rounded-lg border border-white/10 p-3">
                    <legend className="px-1 text-sm font-medium">{role.label}</legend>
                    <FontField label="Font family" value={type.font} onChange={(v) => update("font", v)} testid={`brand-type-${role.key}-font`} />
                    <button type="button" className="mt-2 text-xs text-lime" data-testid={`brand-type-${role.key}-inherit`}
                      onClick={() => update("font", "")}>Use default {role.font} family</button>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <NumericField label="Size (px)" value={raw.size ?? type.size} min={6} max={96} step={0.5}
                        onChange={(v) => update("size", v)} testid={`brand-type-${role.key}-size`} />
                      <label className="text-xs text-zinc-400">Weight
                        <select className={inputCls} value={type.weight} data-testid={`brand-type-${role.key}-weight`}
                          onChange={(e) => update("weight", Number(e.target.value))}>
                          {Object.entries(WEIGHTS).map(([value, label]) => <option key={value} value={value}>{label} ({value})</option>)}
                        </select>
                      </label>
                      <NumericField label="Line height (ratio)" value={raw.line_height ?? type.line_height} min={1} max={3} step={0.1}
                        onChange={(v) => update("line_height", v)} testid={`brand-type-${role.key}-line-height`} />
                    </div>
                    <Field className="mt-3" label="Usage" value={type.usage} onChange={(v) => update("usage", v)}
                      testid={`brand-type-${role.key}-usage`} />
                  </fieldset>
                );
              })}
            </div>
            <div className="mt-5 border-t border-white/10 pt-4">
              <h4 className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">Your own fonts</h4>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                Most of the list above is served for you. A font you licensed elsewhere isn't ours to serve, so
                add the file here and it joins the pickers like any other — on every device, and in exports.
              </p>
              <div className="mt-3"><CustomFontsPanel /></div>
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

          <section className="rounded-xl border border-white/10 bg-[#121212] p-5" data-testid="brand-guideline-fields">
            <h3 className="flex items-center gap-2 font-display text-base font-semibold">
              <ScrollText size={15} className="text-lime" /> Brand Guideline
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
              The extra detail a one-page guideline needs beyond a graphic theme — logo rules, imagery direction
              and how the voice reads in practice. Everything above (colors, fonts, voice, audience) feeds the
              same page automatically.
            </p>
            <Field className="mt-4" label="Naming conventions" value={form.guideline?.naming_conventions}
              onChange={(v) => setGuideline("naming_conventions", v)}
              placeholder="Approved brand spelling, capitalisation and product names."
              testid="brand-guideline-naming" />

            <label className="mt-1 block font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">Logo lockups</label>
            <div className="mt-1.5 grid gap-3 sm:grid-cols-3">
              {LOGO_VARIANTS.map((v) => (
                <LogoVariantUpload key={v.key} label={v.label} url={form.guideline?.logos?.[v.key]}
                  uploading={uploadingVariant === v.key} dark={v.key === "white_on_black"}
                  onUpload={(file, el) => uploadLogoVariant(v.key, file, el)}
                  onUrlChange={(url) => setLogoVariant(v.key, url)}
                  onRemove={() => setLogoVariant(v.key, "")}
                  testid={`brand-guideline-logo-${v.key}`} />
              ))}
            </div>

            <label className="mt-4 block text-xs text-zinc-400">Preferred logo position
              <select className={inputCls} value={form.guideline?.logo_position || ""}
                onChange={(e) => setGuideline("logo_position", e.target.value)} data-testid="brand-guideline-logo-position">
                {LOGO_POSITIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <Field className="mt-4" label="Logo placement notes" value={form.guideline?.logo_placement_notes}
              onChange={(v) => setGuideline("logo_placement_notes", v)}
              placeholder="Safe-area offsets, alignment and format-specific exceptions."
              testid="brand-guideline-logo-placement-notes" />
            <p className="mt-2 text-xs text-zinc-400">Placement is documented on the guideline, not automatically applied to post templates.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Logo clear space" value={form.guideline?.logo_clear_space}
                onChange={(v) => setGuideline("logo_clear_space", v)}
                placeholder="Keep a margin ≥ the height of the icon mark on every side." testid="brand-guideline-clear-space" />
              <Field label="Logo minimum size" value={form.guideline?.logo_min_size}
                onChange={(v) => setGuideline("logo_min_size", v)}
                placeholder="24px digital / 0.5in print" testid="brand-guideline-min-size" />
            </div>
            <TagList className="mt-4" label="Logo do's" values={form.guideline?.logo_dos} testid="brand-guideline-logo-dos"
              onChange={(v) => setGuideline("logo_dos", v)} placeholder="Use approved source files" />
            <TagList className="mt-4" label="Logo don'ts" values={form.guideline?.logo_donts} testid="brand-guideline-logo-donts"
              onChange={(v) => setGuideline("logo_donts", v)} placeholder="Recolor or stretch" />

            <Area className="mt-4" label="Photography mood" value={form.guideline?.imagery_mood}
              onChange={(v) => setGuideline("imagery_mood", v)}
              placeholder="Natural light, candid, optimistic — avoid staged stock photography." rows={2} testid="brand-guideline-imagery-mood" />
            <Area className="mt-4" label="Photography color" value={form.guideline?.imagery_color}
              onChange={(v) => setGuideline("imagery_color", v)}
              placeholder="Warm, slightly desaturated; avoid heavy filters." rows={2} testid="brand-guideline-imagery-color" />
            <Area className="mt-4" label="Icon style" value={form.guideline?.icon_style}
              onChange={(v) => setGuideline("icon_style", v)}
              placeholder="Outline only, 1.5-2px stroke, 24px grid. Never mix filled and outline." rows={2} testid="brand-guideline-icon-style" />

            <TagList className="mt-4" label="Voice attributes" values={form.guideline?.voice_attributes} testid="brand-guideline-voice-attributes"
              onChange={(v) => setGuideline("voice_attributes", v)} placeholder="Confident" />
            <Field className="mt-4" label="Voice — do this" value={form.guideline?.voice_do}
              onChange={(v) => setGuideline("voice_do", v)}
              placeholder="[Product] now supports X — here's how to turn it on." testid="brand-guideline-voice-do" />
            <Field className="mt-4" label="Voice — not this" value={form.guideline?.voice_dont}
              onChange={(v) => setGuideline("voice_dont", v)}
              placeholder="We are thrilled and honored to announce our latest revolutionary innovation!!!" testid="brand-guideline-voice-dont" />

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Document owner" value={form.guideline?.doc_owner}
                onChange={(v) => setGuideline("doc_owner", v)} placeholder="Name, Role" testid="brand-guideline-owner" />
              <Field label="Version" value={form.guideline?.version}
                onChange={(v) => setGuideline("version", v)} placeholder="v1.0" testid="brand-guideline-version" />
            </div>
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

          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={saving} data-testid="brand-save"
              className="gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {form.id ? "Save brand kit" : "Create brand kit"}
            </Button>
            {form.id && (
              <Button variant="secondary" onClick={exportKit} disabled={exporting} data-testid="brand-export"
                className="gap-2 rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10">
                {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Export backup
              </Button>
            )}
          </div>

          {/* The knowledge base attaches to a saved kit, so it appears once
              there is an id to attach it to. */}
          {form.id ? (
            <KnowledgeBase brandKitId={form.id} brandName={form.name} />
          ) : (
            <section className="rounded-xl border border-dashed border-white/10 p-5 text-xs text-zinc-600" data-testid="knowledge-locked">
              Save this kit to start building its knowledge base — values, philosophy, previous work and house
              rules the writer should draw on.
            </section>
          )}
      </div>

      <section className="mt-6 rounded-xl border border-white/10 bg-[#121212] p-5" data-testid="brand-guideline-preview">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-display text-base font-semibold">
            <ScrollText size={15} className="text-lime" /> Brand Guideline — one-page summary
          </h3>
          <div className="flex items-center gap-2">
            <Button onClick={save} disabled={saving} data-testid="brand-guideline-save"
              className="h-8 gap-1.5 rounded-lg bg-lime px-3 text-xs font-semibold text-[#0A0A0A] hover:bg-lime-hover">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {form.id ? "Save" : "Create brand kit"}
            </Button>
            <Button variant="secondary" onClick={downloadGuideline} disabled={downloadingGuideline} data-testid="brand-guideline-download"
              className="h-8 gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-white hover:bg-white/10">
              {downloadingGuideline ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download PNG
            </Button>
          </div>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
          Everything above, laid out on one page — logo usage, palette, type, imagery direction and voice.
          Updates live as you edit; the Save button here (or the one at the top of the form) keeps it for next time.
        </p>
        <div className="mt-4 overflow-x-auto rounded-lg">
          <BrandGuidelineDoc ref={guidelineRef} brand={form} />
        </div>
      </section>
    </div>
  );
}

// Folded in from the old standalone Connections page — publishing setup is
// brand/account setup, not a destination of its own, so it lives as a tab
// here instead of its own nav entry.
function ConnectionsPanel() {
  const [connections, setConnections] = useState([]);
  const [connLoading, setConnLoading] = useState(true);

  useEffect(() => {
    api.get("/connections").then(({ data }) => setConnections(data)).finally(() => setConnLoading(false));
  }, []);

  const statusOf = (key) => (connections.find((c) => c.platform === key) || {}).status || "not_connected";

  return (
    <div className="mt-6" data-testid="connections-page">
      <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">
        Nothing is connected yet, so scheduled posts sit in the calendar until a platform is wired up here.
        Each one needs its own developer app registered on that platform before CreateOS can publish to it —
        that's a one-time setup only you can do, since it requires your own accounts and credentials.
      </p>

      {!connLoading && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PLATFORM_LIST.map((p) => {
            const status = statusOf(p.key);
            const connected = status === "connected";
            const I = p.icon;
            return (
              <div key={p.key} className="flex items-center justify-between rounded-xl border border-white/10 bg-[#121212] p-4" data-testid={`connection-${p.key}`}>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#0A0A0A]">
                    <I size={18} style={{ color: p.color }} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">{p.name}</div>
                    <div className={`mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${connected ? "text-lime" : "text-zinc-600"}`}>
                      {connected ? "Connected" : "Not connected"}
                    </div>
                  </div>
                </div>
                <button
                  disabled
                  title="Publishing needs a developer app registered on this platform first — ask in chat to set one up."
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-500 opacity-60"
                >
                  <Plug size={13} /> Connect
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-8 flex items-start gap-3 rounded-xl border border-white/10 bg-[#121212] p-5">
        <ExternalLink size={18} className="mt-0.5 flex-shrink-0 text-zinc-500" />
        <div className="text-sm leading-relaxed text-zinc-400">
          <span className="font-semibold text-white">Want to connect one now?</span> Ask to set up publishing for a
          specific platform — X and LinkedIn are usually the fastest to register. You'll create a developer app on
          that platform's own site and paste back a client ID and secret, the same way the PoYo and Cloudflare keys
          were added.
        </div>
      </div>
    </div>
  );
}

const inputCls ="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A0A0A] px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-zinc-700 focus:border-lime";

const NumericField = ({ label, value, min, max, step, onChange, testid }) => (
  <label className="text-xs text-zinc-400">{label}
    <input type="number" value={value} min={min} max={max} step={step} className={inputCls}
      data-testid={testid} onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => {
        const n = Number(e.target.value);
        if (e.target.value === "" || !Number.isFinite(n)) onChange("");
        else onChange(Math.min(max, Math.max(min, n)));
      }} />
  </label>
);

const Field = ({ label, value, onChange, placeholder, testid, className = "" }) => (
  <div className={className}>
    <label htmlFor={testid} className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">{label}</label>
    <input id={testid} value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      data-testid={testid} className={inputCls} />
  </div>
);

// One of the three logo lockups a guideline shows side by side — its own
// upload, thumbnail (on a dark or light chip, matching what the logo is
// meant to sit on) and a paste-a-URL fallback, same pattern as the main
// Identity logo field but compact enough to repeat three times.
const LogoVariantUpload = ({ label, url, uploading, dark, onUpload, onUrlChange, onRemove, testid }) => {
  const inputRef = useRef(null);
  return (
    <div>
      <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">{label}</label>
      <div className={`mt-1.5 flex h-16 items-center justify-center overflow-hidden rounded-lg border border-white/10 ${dark ? "bg-black" : "bg-white"}`}
        data-testid={`${testid}-preview`}>
        {url ? (
          <img src={url} alt={label} className="h-full w-full object-contain p-2" />
        ) : (
          <ImageOff size={16} className={dark ? "text-zinc-700" : "text-zinc-300"} />
        )}
      </div>
      <div className="mt-1.5 flex gap-1">
        <input ref={inputRef} type="file" accept="image/*,.svg" className="hidden" data-testid={`${testid}-input`}
          onChange={(e) => onUpload(e.target.files?.[0], inputRef.current)} />
        <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={uploading} data-testid={`${testid}-upload`}
          className="h-7 flex-1 gap-1 rounded-lg border border-white/10 bg-white/5 px-2 text-[11px] text-white hover:bg-white/10">
          {uploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />} Upload
        </Button>
        {url && (
          <Button variant="ghost" onClick={onRemove} data-testid={`${testid}-remove`}
            className="h-7 w-7 flex-none p-0 text-zinc-500 hover:text-magic"><X size={12} /></Button>
        )}
      </div>
      <input value={url || ""} onChange={(e) => onUrlChange(e.target.value)} placeholder="or paste a URL" data-testid={`${testid}-url`}
        className="mt-1 w-full rounded-lg border border-white/10 bg-[#0A0A0A] px-2 py-1.5 text-[11px] text-zinc-400 outline-none placeholder:text-zinc-700 focus:border-lime" />
    </div>
  );
};

const FontField = ({ label, value, onChange, testid, className = "" }) => {
  useAllFontsLoaded();
  const catalog = useFontCatalog();
  // A detected font from brand analysis might not be in the curated list —
  // keep it selectable rather than silently dropping it.
  const options = catalog.some((f) => f.key === value) || !value
    ? catalog
    : [{ key: value, label: `${value} (detected)` }, ...catalog];
  const groups = groupFontsByCategory(options);
  return (
    <div className={className}>
      <label htmlFor={testid} className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">{label}</label>
      <select id={testid} value={value || "Inter"} onChange={(e) => onChange(e.target.value)} data-testid={testid}
        className={`${inputCls} [color-scheme:dark]`} style={{ fontFamily: "inherit" }}>
        {groups.map(({ category, fonts }) => (
          <optgroup key={category} label={category}>
            {fonts.map((f) => <option key={f.key} value={f.key} style={{ fontFamily: fontStack(f.key) }}>{f.label || f.key}</option>)}
          </optgroup>
        ))}
      </select>
      <FontNotice fontKey={value} testid={`${testid}-notice`} />
    </div>
  );
};

const Area = ({ label, value, onChange, placeholder, testid, rows = 3, className = "" }) => (
  <div className={className}>
    <label htmlFor={testid} className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">{label}</label>
    <textarea id={testid} value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows}
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
