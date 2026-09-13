import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "@/lib/api";
import { useCustomTemplates } from "@/lib/useCustomTemplates";
import { Button } from "@/components/ui/button";
import { MediaPicker } from "@/components/MediaPicker";
import { MediaGenerator } from "@/components/MediaGenerator";
import { VisualCard, ASPECT_CLASS } from "@/components/VisualCard";
import { toast } from "sonner";
import {
  Images, Send, Download, Trash2, Image as ImageIcon, Video, Music, Mic, Upload, Sparkles, Plus, Loader2,
  LayoutTemplate, Wand, Pencil, FileText, Presentation, Shapes, Type as TypeIcon, Square as ShapeIcon, Film,
} from "lucide-react";

const KIND_ICON = { image: ImageIcon, video: Video, music: Music, voice: Mic, audio: Music, file: Upload };

// Every reusable thing lives here: what you've uploaded, what's been
// generated, saved slide designs, saved elements, and the raw generators
// that produce more of the first two — one home for everything a post can
// reuse, instead of scattered across five pages that each held one kind.
const TABS = [
  { key: "generated", label: "Generated", icon: Sparkles },
  { key: "uploads", label: "Your uploads", icon: Upload },
  { key: "image", label: "Image", icon: ImageIcon },
  { key: "video", label: "Video", icon: Video },
  { key: "music", label: "Music", icon: Music },
  { key: "voice", label: "Voice", icon: Mic },
  { key: "designs", label: "Designs", icon: LayoutTemplate },
  { key: "elements", label: "Elements", icon: Shapes },
];
const GENERATOR_TABS = ["image", "video", "music", "voice"];

const CUSTOM_TYPES = [
  { key: "pptx", label: "PowerPoint", icon: Presentation, accept: ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  { key: "pdf", label: "PDF", icon: FileText, accept: ".pdf,application/pdf" },
  { key: "image", label: "Image", icon: ImageIcon, accept: "image/*" },
];

export default function Library() {
  const navigate = useNavigate();
  const { state } = useLocation();
  // A Composer deep link ("Generate clip" on a reel scene) hands over which
  // generator to open on and the prompt to open it with, the same way
  // Studio's old kind/prompt state worked.
  const [tab, setTab] = useState(state?.tab && TABS.some((t) => t.key === state.tab) ? state.tab : "generated");
  const [media, setMedia] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (tab !== "generated" && tab !== "uploads") return;
    setLoading(true);
    const req = tab === "uploads" ? api.get("/uploads") : api.get("/media");
    req.then(({ data }) => (tab === "uploads" ? setUploads(data) : setMedia(data)))
      .catch((e) => toast.error(apiErrorMessage(e, "Couldn't load.")))
      .finally(() => setLoading(false));
  }, [tab]);

  const removeUpload = async (upload) => {
    if (!window.confirm(`Delete "${upload.filename || "this file"}"? This can't be undone.`)) return;
    const prev = uploads;
    setUploads((s) => s.filter((u) => u.id !== upload.id));
    try { await api.delete(`/uploads/${upload.id}`); toast.success("Deleted"); }
    catch (e) { toast.error(apiErrorMessage(e, "Delete failed.")); setUploads(prev); }
  };

  // The "+" opens the same picker as every "Add media" moment elsewhere in
  // the app — search Stock or upload a file — but here the result needs to
  // land IN the library rather than attach to a post. A direct upload has
  // already done that by the time onSelect fires (MediaPicker posts to
  // /api/upload itself); a Stock pick is still just a live Pexels URL, so
  // it's downloaded into the user's own storage here — "add to your
  // library" should mean a durable copy, not a link that outlives Pexels
  // only by luck.
  const addPicked = async (item) => {
    setTab("uploads");
    if (item.source === "upload") {
      // The picker's own "Your files" tab lists what's already here (handy
      // when attaching to a post) — re-picking one from it isn't a new
      // addition, so it's a no-op rather than a duplicate-looking entry.
      if (uploads.some((u) => u.id === item.id)) return;
      setUploads((s) => [{ id: item.id, url: item.url, filename: item.filename, kind: item.type, created_at: new Date().toISOString() }, ...s]);
      toast.success("Added to your library");
      return;
    }
    setAdding(true);
    try {
      const { data } = await api.post("/uploads/from-url", { url: item.url, filename: item.credit ? `${item.credit} - ${item.id}` : undefined });
      setUploads((s) => [data, ...s]);
      toast.success("Saved to your library");
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't save that."));
    } finally {
      setAdding(false);
    }
  };

  const items = tab === "uploads" ? uploads : media;

  return (
    <div data-testid="library-page">
      <div className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">Library</div>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Everything you can drop into a post</h1>

      {/* Same scrollable-strip treatment as the old Content Studio tabs —
          eight tabs is too many to fit a phone width, so this scrolls
          instead of wrapping into a second row that pushes content down. */}
      <div className="relative mt-6">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.key} onClick={() => setTab(t.key)} data-testid={`library-tab-${t.key}`}
                className={`flex flex-none items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${tab === t.key ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
                <Icon size={13} /> {t.label}
              </button>
            );
          })}
          {(tab === "generated" || tab === "uploads") && (
            <Button onClick={() => setPickerOpen(true)} disabled={adding} data-testid="library-add"
              title="Upload a file or add one from Stock"
              className="ml-1 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-lime p-0 text-[#0A0A0A] hover:bg-lime-hover disabled:opacity-60">
              {adding ? <Loader2 size={15} className="animate-spin" /> : <Plus size={16} />}
            </Button>
          )}
        </div>
        <div className="pointer-events-none absolute right-0 top-0 h-9 w-10 rounded-r-full bg-gradient-to-l from-[#0A0A0A] to-transparent sm:hidden" />
      </div>

      {GENERATOR_TABS.includes(tab) && (
        // Keyed by tab so switching kind (image -> video -> image) starts
        // each generator fresh instead of one instance whose prompt/options
        // stay stuck from whichever kind was open before.
        <div className="mt-7"><MediaGenerator key={tab} kind={tab} initialPrompt={tab === state?.tab ? state?.prompt || "" : ""} /></div>
      )}
      {tab === "designs" && <div className="mt-7"><DesignsPanel /></div>}
      {tab === "elements" && <div className="mt-7"><ElementsPanel /></div>}

      {(tab === "generated" || tab === "uploads") && (
        <>
          {loading && <div className="mt-10 text-sm text-zinc-600">Loading…</div>}

          {!loading && items.length === 0 && (
            <div className="mt-10 flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 p-16 text-center">
              <Images size={28} className="text-zinc-600" />
              <div className="mt-3 text-sm text-zinc-500">{tab === "uploads" ? "Nothing uploaded yet." : "No media yet."}</div>
              {tab === "generated" ? (
                <Button onClick={() => setTab("image")} className="mt-4 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover" data-testid="library-go-studio">
                  Generate something
                </Button>
              ) : (
                <>
                  <p className="mt-2 max-w-xs text-xs text-zinc-600">Uploads from any "Add media" button in the Composer show up here automatically — or add one straight from here.</p>
                  <Button onClick={() => setPickerOpen(true)} className="mt-4 gap-1.5 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover">
                    <Plus size={14} /> Upload or add from Stock
                  </Button>
                </>
              )}
            </div>
          )}

          <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tab === "generated" && media.map((m) => {
              const file = (m.files || []).find((f) => f.file_url);
              if (!file) return null;
              const Icon = KIND_ICON[m.kind] || ImageIcon;
              return (
                <div key={m.id} className="group overflow-hidden rounded-xl border border-white/10 bg-[#121212]" data-testid={`library-item-${m.id}`}>
                  <div className="flex aspect-video items-center justify-center overflow-hidden bg-[#0A0A0A]">
                    {m.kind === "image" && <img src={file.file_url} alt={m.prompt} className="h-full w-full object-cover" />}
                    {m.kind === "video" && <video src={file.file_url} className="h-full w-full object-cover" muted />}
                    {(m.kind === "music" || m.kind === "voice") && (
                      <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-iris/20 to-lime/10">
                        <Icon size={30} className="text-lime" />
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="flex items-center gap-2">
                      <Icon size={13} className="text-lime" />
                      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">{m.kind}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-zinc-300">{m.prompt}</p>
                    {(m.kind === "music" || m.kind === "voice") && <audio src={file.file_url} controls className="mt-3 w-full" />}
                    <div className="mt-3 flex gap-2">
                      <a href={file.file_url} target="_blank" rel="noreferrer" className="flex-1">
                        <Button variant="secondary" className="h-8 w-full gap-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-white hover:bg-white/10"><Download size={13} /> Open</Button>
                      </a>
                      <Button onClick={() => navigate("/composer", { state: { mediaUrl: file.file_url, mediaType: m.kind } })}
                        className="h-8 flex-1 gap-1.5 rounded-lg bg-lime text-xs font-semibold text-[#0A0A0A] hover:bg-lime-hover" data-testid={`library-use-${m.id}`}><Send size={13} /> Use</Button>
                    </div>
                  </div>
                </div>
              );
            })}

            {tab === "uploads" && uploads.map((u) => {
              const Icon = KIND_ICON[u.kind] || Upload;
              return (
                <div key={u.id} className="group overflow-hidden rounded-xl border border-white/10 bg-[#121212]" data-testid={`library-upload-${u.id}`}>
                  <div className="flex aspect-video items-center justify-center overflow-hidden bg-[#0A0A0A]">
                    {u.kind === "image" && <img src={u.url} alt={u.filename} className="h-full w-full object-cover" />}
                    {u.kind === "video" && <video src={u.url} className="h-full w-full object-cover" muted />}
                    {(u.kind === "audio" || u.kind === "file") && (
                      <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-iris/20 to-lime/10">
                        <Icon size={30} className="text-lime" />
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="flex items-center gap-2">
                      <Icon size={13} className="text-lime" />
                      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">{u.kind}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-zinc-300">{u.filename}</p>
                    {u.kind === "audio" && <audio src={u.url} controls className="mt-3 w-full" />}
                    <div className="mt-3 flex gap-2">
                      <Button onClick={() => navigate("/composer", { state: { mediaUrl: u.url, mediaType: u.kind } })}
                        className="h-8 flex-1 gap-1.5 rounded-lg bg-lime text-xs font-semibold text-[#0A0A0A] hover:bg-lime-hover" data-testid={`library-use-${u.id}`}><Send size={13} /> Use</Button>
                      <Button variant="ghost" onClick={() => removeUpload(u)} data-testid={`library-delete-${u.id}`}
                        className="h-8 px-2.5 text-zinc-500 hover:text-magic"><Trash2 size={14} /></Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <MediaPicker open={pickerOpen} onOpenChange={setPickerOpen} onSelect={addPicked} />
    </div>
  );
}

// Every saved slide design, starter and custom. Folded in from the
// standalone Designs page — it's the same kind of reusable asset as
// everything else here, not a destination of its own.
function DesignsPanel() {
  const navigate = useNavigate();
  const [customType, setCustomType] = useState("pptx");
  const [converting, setConverting] = useState(false);
  const customFileRef = useRef(null);
  const { templates: customTemplates, loading: loadingCustom, reload: reloadCustom } = useCustomTemplates();

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
    <div data-testid="library-designs-panel">
      <p className="max-w-2xl text-sm leading-relaxed text-zinc-500">
        Starter layouts ship with the app — each one lays out the words for you and stays fully draggable in the
        Composer. Or add your own: upload a PowerPoint, PDF, or image and its real structure becomes a reusable
        design. Building from either writes fresh content into that structure; it never copies the source's wording.
      </p>

      <div className="mt-5 rounded-xl border border-white/10 bg-[#121212] p-5" data-testid="templates-custom">
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

// Personal elements: a logo you uploaded, or anything saved straight off a
// slide (a styled text box, a shape, an image) via the property panel's
// "Save to library" action. The code-defined shapes/icons/stickers palette
// stays Composer-only (it's a fixed picker, nothing to browse or manage);
// this tab is for what's actually yours.
function ElementsPanel() {
  const [uploads, setUploads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const loadUploads = useCallback(() => {
    setLoading(true);
    return api.get("/library/elements")
      .then(({ data }) => setUploads(data))
      .catch(() => setUploads([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadUploads(); }, [loadUploads]);

  const uploadNew = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data: up } = await api.post("/upload", form);
      const isVideo = up.kind === "video";
      const { data: saved } = await api.post("/library/elements", {
        name: up.filename, kind: "upload",
        element: isVideo
          ? { type: "video", url: up.url, fit: "cover", w: 50, h: 35, effects: {} }
          : { type: "image", url: up.url, fit: "contain", w: 30, h: 30 },
      });
      setUploads((s) => [saved, ...s]);
      toast.success("Saved to your library");
    } catch (e) { toast.error(apiErrorMessage(e, "Upload failed.")); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const removeUpload = async (item) => {
    if (!window.confirm(`Remove "${item.name}" from your library? This can't be undone.`)) return;
    const prev = uploads;
    setUploads((s) => s.filter((u) => u.id !== item.id));
    try { await api.delete(`/library/elements/${item.id}`); toast.success("Removed"); }
    catch (e) { toast.error(apiErrorMessage(e, "Delete failed.")); setUploads(prev); }
  };

  return (
    <div data-testid="library-elements-panel">
      <input ref={fileRef} type="file" accept="image/*,video/mp4,video/quicktime,video/webm"
        className="hidden" data-testid="library-elements-upload-input"
        onChange={(e) => uploadNew(e.target.files?.[0])} />
      <Button onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="library-elements-upload-button"
        className="gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover">
        {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Upload a logo, image or video
      </Button>

      {loading && <div className="mt-6 flex justify-center"><Loader2 className="animate-spin text-zinc-600" /></div>}
      {!loading && uploads.length === 0 && (
        <div className="mt-6 flex min-h-[160px] flex-col items-center justify-center gap-1 text-center text-sm text-zinc-600">
          <span>Nothing saved yet.</span>
          <span className="text-xs text-zinc-700">Upload a logo, or save any element off a slide — it's here for every future post.</span>
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6" data-testid="library-elements-list">
        {uploads.map((u) => (
          <div key={u.id} className="group relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-[#121212]" data-testid={`library-elements-item-${u.id}`} title={u.name}>
            {u.element?.type === "video" ? (
              u.element.url && (
                <>
                  <video src={u.element.url} muted loop playsInline preload="metadata"
                    className="h-full w-full object-cover"
                    onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                    onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} />
                  <span className="pointer-events-none absolute bottom-1 left-1 flex items-center gap-1 rounded bg-black/70 px-1 py-0.5 text-[9px] text-white">
                    <Film size={9} /> clip
                  </span>
                </>
              )
            ) : u.element?.type === "image" ? (
              u.element.url && <img src={u.element.url} alt="" className="h-full w-full object-contain p-2" />
            ) : u.element?.type === "text" ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-1.5">
                <TypeIcon size={16} className="text-zinc-500" />
                <span className="line-clamp-2 text-center text-[9px] leading-tight text-zinc-400" style={{ color: u.element.color }}>
                  {u.element.text || "Text"}
                </span>
              </div>
            ) : u.element?.type === "shape" ? (
              <div className="flex h-full w-full items-center justify-center">
                <div style={{
                  width: 28, height: u.element.shape === "ellipse" ? 28 : 16,
                  background: u.element.color || "#E2FF3D",
                  borderRadius: u.element.shape === "ellipse" ? "50%" : 4,
                }} />
              </div>
            ) : (
              <div className="flex h-full w-full items-center justify-center text-zinc-700"><ShapeIcon size={18} /></div>
            )}
            <button onClick={() => removeUpload(u)} data-testid={`library-elements-delete-${u.id}`}
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md bg-black/60 text-white opacity-0 transition-opacity hover:text-magic group-hover:opacity-100">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
