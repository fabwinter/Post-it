import { useCallback, useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { api, apiErrorMessage } from "@/lib/api";
import { toast } from "sonner";
import { ICON_MAP, ICON_ELEMENTS, STICKER_ELEMENTS, SHAPE_ELEMENTS } from "@/lib/elementLibrary";
import { Loader2, Upload, Trash2, Type as TypeIcon, Square as ShapeIcon, Film } from "lucide-react";

const TABS = [
  { key: "shapes", label: "Shapes" },
  { key: "icons", label: "Icons" },
  { key: "stickers", label: "Stickers" },
  { key: "uploads", label: "Your library" },
];

// A palette of things to drop onto a slide: code-defined shapes/icons/
// stickers (they never change, so nothing to fetch) plus a personal set of
// saved elements — uploaded logos/badges/stamps, and anything saved
// straight off a slide (a styled text box, a shape, an image) via the
// property panel's "Save to library" action — persisted once and available
// on every future post. Picking anything hands its element definition
// straight to the caller, which drops it onto the active slide.
export function ElementsLibrary({ open, onOpenChange, onPick }) {
  const [tab, setTab] = useState("shapes");
  const [uploads, setUploads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  // No kind filter — this tab shows every saved element, not just image
  // uploads, so a text/shape element saved off a slide shows up here too.
  const loadUploads = useCallback(() => {
    setLoading(true);
    return api.get("/library/elements")
      .then(({ data }) => setUploads(data))
      .catch(() => setUploads([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (open && tab === "uploads") loadUploads(); }, [open, tab, loadUploads]);

  const uploadNew = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data: up } = await api.post("/upload", form);
      // The backend already classifies what came in (_upload_kind), so a
      // clip lands as a video element and a still as an image one without
      // the picker having to sniff the file itself. A clip defaults bigger
      // and to cover: a logo wants to sit inside its box, footage wants to
      // fill it.
      const isVideo = up.kind === "video";
      const { data: saved } = await api.post("/library/elements", {
        name: up.filename, kind: "upload",
        element: isVideo
          ? { type: "video", url: up.url, fit: "cover", w: 50, h: 35, effects: {} }
          : { type: "image", url: up.url, fit: "contain", w: 30, h: 30 },
      });
      setUploads((s) => [saved, ...s]);
      toast.success("Saved to your library");
      onPick(saved.element);
    } catch (e) { toast.error(apiErrorMessage(e, "Upload failed.")); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const removeUpload = async (e, item) => {
    e.stopPropagation();
    if (!window.confirm(`Remove "${item.name}" from your library? This can't be undone.`)) return;
    const prev = uploads;
    setUploads((s) => s.filter((u) => u.id !== item.id));
    try { await api.delete(`/library/elements/${item.id}`); }
    catch (err) { toast.error(apiErrorMessage(err, "Delete failed.")); setUploads(prev); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col border-white/10 bg-[#0A0A0A] p-0 text-white sm:max-w-md">
        <SheetTitle className="sr-only">Elements library</SheetTitle>
        <div className="border-b border-white/10 px-5 py-4">
          <span className="font-display text-base font-semibold">Elements library</span>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)} data-testid={`library-tab-${t.key}`}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${tab === t.key ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4" data-testid="library-panel">
          {tab === "shapes" && (
            <div className="grid grid-cols-4 gap-2.5">
              {SHAPE_ELEMENTS.map((s) => (
                <button key={s.key} onClick={() => onPick(s.def)} data-testid={`library-shape-${s.key}`}
                  className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-[#121212] p-2 hover:border-lime">
                  <div style={{ width: 28, height: s.def.shape === "ellipse" ? 28 : 16, background: s.def.color, borderRadius: s.def.shape === "ellipse" ? "50%" : 4 }} />
                  <span className="text-[10px] text-zinc-500">{s.label}</span>
                </button>
              ))}
            </div>
          )}
          {tab === "icons" && (
            <div className="grid grid-cols-4 gap-2.5">
              {ICON_ELEMENTS.map((it) => {
                const Icon = ICON_MAP[it.key];
                return (
                  <button key={it.key} onClick={() => onPick(it.def)} data-testid={`library-icon-${it.key}`}
                    className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-[#121212] p-2 hover:border-lime">
                    <Icon size={22} className="text-lime" />
                    <span className="truncate text-[10px] capitalize text-zinc-500">{it.label}</span>
                  </button>
                );
              })}
            </div>
          )}
          {tab === "stickers" && (
            <div className="grid grid-cols-4 gap-2.5">
              {STICKER_ELEMENTS.map((s) => (
                <button key={s.key} onClick={() => onPick(s.def)} data-testid={`library-sticker-${s.key}`}
                  className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-white/10 bg-[#121212] p-2 hover:border-lime">
                  <span className="text-2xl">{s.emoji}</span>
                  <span className="text-[10px] text-zinc-500">{s.label}</span>
                </button>
              ))}
            </div>
          )}
          {tab === "uploads" && (
            <>
              <input ref={fileRef} type="file" accept="image/*,video/mp4,video/quicktime,video/webm"
                className="hidden" data-testid="library-upload-input"
                onChange={(e) => uploadNew(e.target.files?.[0])} />
              <Button onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="library-upload-button"
                className="w-full gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover">
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Upload a logo, image or video
              </Button>
              {loading && <div className="mt-6 flex justify-center"><Loader2 className="animate-spin text-zinc-600" /></div>}
              {!loading && uploads.length === 0 && (
                <div className="mt-6 flex min-h-[160px] flex-col items-center justify-center gap-1 text-center text-sm text-zinc-600">
                  <span>Nothing saved yet.</span>
                  <span className="text-xs text-zinc-700">Upload a logo, or save any element off a slide — it's here for every future post.</span>
                </div>
              )}
              <div className="mt-3 grid grid-cols-3 gap-2.5">
                {uploads.map((u) => (
                  <button key={u.id} onClick={() => onPick(u.element)} data-testid={`library-upload-${u.id}`} title={u.name}
                    className="group relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-[#121212] hover:border-lime">
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
                    <button onClick={(e) => removeUpload(e, u)} data-testid={`library-upload-delete-${u.id}`}
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md bg-black/60 text-white opacity-0 transition-opacity hover:text-magic group-hover:opacity-100">
                      <Trash2 size={12} />
                    </button>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
