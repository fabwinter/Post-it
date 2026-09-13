import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "@/lib/api";
import { useCustomTemplates } from "@/lib/useCustomTemplates";
import { VisualCard, ASPECT_CLASS } from "@/components/VisualCard";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useState } from "react";
import {
  Upload, FileText, Image as ImageIcon, Presentation, Trash2, LayoutTemplate, Pencil, Wand, Loader2,
} from "lucide-react";

const CUSTOM_TYPES = [
  { key: "pptx", label: "PowerPoint", icon: Presentation, accept: ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  { key: "pdf", label: "PDF", icon: FileText, accept: ".pdf,application/pdf" },
  { key: "image", label: "Image", icon: ImageIcon, accept: "image/*" },
];

// Every saved slide design, starter and custom — separate from Batch (which
// writes fresh copy in a chosen voice) because these two things were both
// called "template" on one page, and only one of them is a layout.
export default function Designs() {
  const navigate = useNavigate();
  const [customType, setCustomType] = useState("pptx");
  const [converting, setConverting] = useState(false);
  const customFileRef = useRef(null);
  const { templates: customTemplates, loading: loadingCustom, reload: reloadCustom } = useCustomTemplates();

  // Uploads the file, then extracts its real layout (slide text, page text,
  // or a dominant-color palette) into a reusable, saved design.
  const convertFile = async (file) => {
    if (!file) return;
    setConverting(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const { data: up } = await api.post("/upload", body);
      await api.post("/templates/from-file", { source_type: customType, source_url: up.url });
      await reloadCustom();
      toast.success("Design saved — use it from the Composer.");
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't convert that file.")); }
    finally { setConverting(false); if (customFileRef.current) customFileRef.current.value = ""; }
  };

  const deleteCustomTemplate = async (tpl) => {
    if (!window.confirm(`Delete "${tpl.name}"? This can't be undone.`)) return;
    try {
      await api.delete(`/templates/custom/${tpl.id}`);
      await reloadCustom();
      toast.success("Deleted");
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't delete that design.")); }
  };

  const openInComposer = (tpl) => navigate("/composer", { state: { applyCustomTemplateId: tpl.id } });
  const editTemplate = (tpl) => navigate("/composer", { state: { editTemplateId: tpl.id } });

  return (
    <div data-testid="designs-page">
      <div className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">Designs</div>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Every layout, ready to fill</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-500">
        Starter layouts ship with the app — each one lays out the words for you and stays fully draggable in the
        Composer. Or add your own: upload a PowerPoint, PDF, or image and its real structure becomes a reusable
        design. Building from either writes fresh content into that structure; it never copies the source's wording.
      </p>

      <div className="mt-7 rounded-xl border border-white/10 bg-[#121212] p-5" data-testid="templates-custom">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <LayoutTemplate size={15} className="text-lime" /> Upload a design
        </h3>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {CUSTOM_TYPES.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.key} onClick={() => setCustomType(t.key)} data-testid={`templates-custom-type-${t.key}`}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${customType === t.key ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
                <Icon size={13} /> {t.label}
              </button>
            );
          })}
        </div>

        <div className="mt-3">
          <input ref={customFileRef} type="file" accept={CUSTOM_TYPES.find((t) => t.key === customType)?.accept}
            className="hidden" data-testid="templates-custom-file-input" onChange={(e) => convertFile(e.target.files?.[0])} />
          <Button variant="secondary" onClick={() => customFileRef.current?.click()} disabled={converting} data-testid="templates-custom-convert"
            className="gap-2 rounded-lg border border-white/10 bg-white/5 text-xs text-white hover:bg-white/10">
            {converting ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {converting ? "Converting…" : `Upload ${customType === "pptx" ? "PowerPoint" : customType} to convert`}
          </Button>
        </div>
      </div>

      {/* Each card carries min-w-0 because a grid item defaults to
          min-width:auto and so can't shrink below its own min-content —
          which `truncate` (white-space:nowrap) makes the full untruncated
          width of the description. Below sm there's no grid-cols-* class,
          so the implicit track is `auto` and had nothing else holding it
          back: the cards sat at ~592px in a 390px viewport and scrolled
          the whole page sideways. sm:grid-cols-2 was never affected —
          Tailwind's grid-cols-* already expand to minmax(0, 1fr). */}
      {!loadingCustom && customTemplates.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2" data-testid="designs-grid">
          {customTemplates.map((tpl) => (
            <div key={tpl.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-[#121212] p-3" data-testid={`templates-custom-item-${tpl.id}`}>
              <div className={`relative w-[84px] flex-none overflow-hidden rounded-md border border-white/10 bg-[#050505] ${tpl.format === "reel" ? ASPECT_CLASS["9:16"] : ASPECT_CLASS["4:5"]}`}
                data-testid={`templates-custom-thumb-${tpl.id}`}>
                {tpl.preview ? (
                  <VisualCard spec={tpl.preview} scale={0.19} className="pointer-events-none" />
                ) : Object.keys(tpl.colors || {}).length > 0 ? (
                  <div className="flex h-full flex-col">
                    {Object.values(tpl.colors).slice(0, 4).map((hex, i) => (
                      <span key={i} className="flex-1" style={{ background: hex }} />
                    ))}
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-zinc-700"><LayoutTemplate size={18} /></div>
                )}
              </div>
              <div className="min-w-[9rem] flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-white">{tpl.name}</span>
                  {tpl.builtin && <span className="flex-none rounded-full border border-lime/40 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-lime">Starter</span>}
                </div>
                {tpl.description && <div className="mt-0.5 truncate text-[11px] text-zinc-500">{tpl.description}</div>}
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                  {!tpl.builtin && <span className="uppercase">{tpl.source_kind}</span>}
                  <span>{!tpl.builtin && "· "}{tpl.slides.length} slide{tpl.slides.length === 1 ? "" : "s"} · {tpl.format}</span>
                </div>
              </div>
              {/* Once wrapped onto its own line the actions read better
                  across than stacked in a narrow column, so they only
                  become a column again at the width that fits them beside
                  the text. */}
              <div className="flex w-full flex-none flex-row items-stretch gap-1.5 sm:w-auto sm:flex-col">
                <Button onClick={() => openInComposer(tpl)} data-testid={`templates-custom-use-${tpl.id}`}
                  className="h-7 gap-1 rounded-lg bg-lime px-2.5 text-[11px] font-semibold text-[#0A0A0A] hover:bg-lime-hover">
                  <Wand size={12} /> Use
                </Button>
                {!tpl.builtin && (
                  <Button variant="secondary" onClick={() => editTemplate(tpl)} data-testid={`templates-custom-edit-${tpl.id}`}
                    className="h-7 gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 text-[11px] text-white hover:bg-white/10">
                    <Pencil size={12} /> Edit
                  </Button>
                )}
                {!tpl.builtin && (
                  <Button variant="secondary" onClick={() => deleteCustomTemplate(tpl)} data-testid={`templates-custom-delete-${tpl.id}`}
                    className="h-7 w-7 rounded-lg border border-white/10 bg-white/5 p-0 text-zinc-400 hover:text-white">
                    <Trash2 size={13} />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
