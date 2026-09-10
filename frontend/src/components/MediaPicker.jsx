import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Search, Loader2, Image as ImageIcon, Film, Play, Upload, Music2, Trash2 } from "lucide-react";

const TYPE_ICON = { image: ImageIcon, video: Film, audio: Music2 };
const TYPE_LABEL = { image: "Photos", video: "Video", audio: "Audio" };
const ACCEPT = { image: "image/*", video: "video/*", audio: "audio/*" };

// One picker for every "attach media" moment in the app: search free stock
// (Pexels, photos & video only) or browse/upload your own files (Vercel
// Blob, any of the three types). `defaultType` opens on the right kind;
// `orientation` narrows Pexels results to the aspect the slide actually
// needs. Uploading picks the file immediately — a fresh upload is exactly
// the thing you meant to attach, so there's no second click.
export function MediaPicker({ open, onOpenChange, defaultType = "image", orientation, onSelect }) {
  const [type, setType] = useState(defaultType);
  const [source, setSource] = useState("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [uploads, setUploads] = useState([]);
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const canSearch = type !== "audio"; // Pexels has no audio catalog

  useEffect(() => {
    if (!open) return;
    const t = defaultType;
    setType(t);
    setSource(t === "audio" ? "uploads" : "search");
    setResults([]); setSearched(false); setNotConfigured(false);
  }, [open, defaultType]);

  useEffect(() => { if (open && source === "search") setTimeout(() => inputRef.current?.focus(), 50); }, [open, source]);

  const loadUploads = useCallback(async (t) => {
    setUploadsLoading(true);
    try {
      const { data } = await api.get("/uploads", { params: { kind: t ?? type, limit: 60 } });
      setUploads(data);
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't load your uploads.")); }
    finally { setUploadsLoading(false); }
  }, [type]);

  useEffect(() => { if (open && source === "uploads") loadUploads(type); }, [open, source, type, loadUploads]);

  const search = async (q, t) => {
    const term = (q ?? query).trim();
    if (!term) return;
    setLoading(true); setSearched(true);
    try {
      const { data } = await api.get("/stock/search", { params: { q: term, type: t ?? type, per_page: 30, orientation } });
      setResults(data.results || []);
      setNotConfigured(false);
    } catch (e) {
      const msg = apiErrorMessage(e, "Search failed.");
      if (/not configured/i.test(msg)) setNotConfigured(true);
      else toast.error(msg);
      setResults([]);
    } finally { setLoading(false); }
  };

  const switchType = (t) => {
    setType(t);
    if (t === "audio") setSource("uploads");
    if (source === "search" && query.trim()) search(query, t);
  };

  const pick = (item) => { onSelect(item); onOpenChange(false); };

  const uploadFile = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      // Let the browser set Content-Type (with the multipart boundary) itself —
      // setting it explicitly here would strip that boundary and break the upload.
      const { data } = await api.post("/upload", form);
      toast.success("Uploaded");
      pick({ id: data.id, type: data.kind, url: data.url, thumbnail: data.kind === "image" ? data.url : undefined, source: "upload", filename: data.filename });
    } catch (e) {
      toast.error(apiErrorMessage(e, "Upload failed."));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeUpload = async (e, id) => {
    e.stopPropagation();
    const prev = uploads;
    setUploads((s) => s.filter((u) => u.id !== id));
    try { await api.delete(`/uploads/${id}`); }
    catch (err) { toast.error(apiErrorMessage(err, "Delete failed.")); setUploads(prev); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col border-white/10 bg-[#0A0A0A] p-0 text-white sm:max-w-lg">
        <SheetTitle className="sr-only">Add media</SheetTitle>
        <div className="border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="font-display text-base font-semibold">Add media</span>
            {source === "search" && <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">via Pexels</span>}
          </div>

          <div className="mt-3 flex gap-1.5">
            {canSearch && (
              <button onClick={() => setSource("search")} data-testid="media-source-search"
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${source === "search" ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
                <Search size={13} /> Search
              </button>
            )}
            <button onClick={() => setSource("uploads")} data-testid="media-source-uploads"
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${source === "uploads" ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
              <Upload size={13} /> Your files
            </button>
            <div className="ml-auto flex gap-1">
              {(["image", "video", "audio"]).map((t) => {
                const Icon = TYPE_ICON[t];
                return (
                  <button key={t} onClick={() => switchType(t)} data-testid={`media-type-${t}`} title={TYPE_LABEL[t]}
                    className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-colors ${type === t ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-500 hover:text-white"}`}>
                    <Icon size={13} />
                  </button>
                );
              })}
            </div>
          </div>

          {source === "search" ? (
            <div className="mt-3 flex gap-2">
              <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} data-testid="media-query"
                onKeyDown={(e) => e.key === "Enter" && search()}
                placeholder={`Search free ${type === "video" ? "stock video" : "stock photos"}…`}
                className="flex-1 rounded-lg border border-white/10 bg-[#121212] px-3 py-2.5 text-sm text-white outline-none focus:border-lime placeholder:text-zinc-600" />
              <Button onClick={() => search()} disabled={loading} data-testid="media-search"
                className="gap-1.5 rounded-lg bg-lime px-3 font-semibold text-[#0A0A0A] hover:bg-lime-hover">
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              </Button>
            </div>
          ) : (
            <div className="mt-3">
              <input ref={fileRef} type="file" accept={ACCEPT[type]} className="hidden" data-testid="media-upload-input"
                onChange={(e) => uploadFile(e.target.files?.[0])} />
              <Button onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="media-upload-button"
                className="w-full gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover">
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                Upload {type === "video" ? "a video" : type === "audio" ? "an audio file" : "a photo"}
              </Button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {source === "search" && notConfigured && (
            <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-sm text-zinc-500">
              Stock media isn't connected yet. Add a free <span className="text-zinc-300">PEXELS_API_KEY</span> (see backend/.env.example) to enable this.
            </div>
          )}
          {source === "search" && !notConfigured && !searched && !loading && (
            <div className="flex min-h-[200px] items-center justify-center text-center text-sm text-zinc-600">
              Search millions of free, licensed {type === "video" ? "clips" : "photos"} to drop straight into your post.
            </div>
          )}
          {source === "search" && !notConfigured && searched && !loading && results.length === 0 && (
            <div className="flex min-h-[200px] items-center justify-center text-center text-sm text-zinc-600">No results for that search.</div>
          )}
          {source === "search" && (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {results.map((r) => (
                <button key={r.id} onClick={() => pick(r)} data-testid={`media-result-${r.id}`}
                  className="group relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-[#121212] transition-colors hover:border-lime">
                  <img src={r.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
                  {r.type === "video" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                      <Play size={20} className="text-white drop-shadow" fill="white" />
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5 text-left font-mono text-[9px] text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100">
                    {r.credit}
                  </div>
                </button>
              ))}
            </div>
          )}

          {source === "uploads" && (
            <>
              {uploadsLoading && (
                <div className="flex justify-center py-10"><Loader2 className="animate-spin text-zinc-600" /></div>
              )}
              {!uploadsLoading && uploads.length === 0 && (
                <div className="flex min-h-[200px] flex-col items-center justify-center gap-1 text-center text-sm text-zinc-600">
                  <span>Nothing uploaded yet.</span>
                  <span className="text-xs text-zinc-700">Uploaded files show up here every time — reuse them on any post.</span>
                </div>
              )}
              {type === "audio" ? (
                <div className="space-y-2">
                  {uploads.map((u) => (
                    <button key={u.id} onClick={() => pick({ id: u.id, type: "audio", url: u.url, source: "upload", filename: u.filename })}
                      data-testid={`media-result-${u.id}`}
                      className="group flex w-full items-center gap-2.5 rounded-lg border border-white/10 bg-[#121212] p-3 text-left transition-colors hover:border-lime">
                      <Music2 size={16} className="flex-shrink-0 text-lime" />
                      <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{u.filename}</span>
                      <button onClick={(e) => removeUpload(e, u.id)} data-testid={`media-delete-${u.id}`}
                        className="flex-shrink-0 text-zinc-600 opacity-0 transition-opacity hover:text-magic group-hover:opacity-100"><Trash2 size={14} /></button>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {uploads.map((u) => (
                    <button key={u.id} onClick={() => pick({ id: u.id, type: u.kind, url: u.url, thumbnail: u.kind === "image" ? u.url : undefined, source: "upload", filename: u.filename })}
                      data-testid={`media-result-${u.id}`}
                      className="group relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-[#121212] transition-colors hover:border-lime">
                      {u.kind === "image" ? (
                        <img src={u.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <video src={u.url} className="h-full w-full object-cover" muted />
                      )}
                      {u.kind === "video" && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                          <Play size={20} className="text-white drop-shadow" fill="white" />
                        </div>
                      )}
                      <button onClick={(e) => removeUpload(e, u.id)} data-testid={`media-delete-${u.id}`}
                        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md bg-black/60 text-white opacity-0 transition-opacity hover:text-magic group-hover:opacity-100">
                        <Trash2 size={12} />
                      </button>
                      <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5 text-left font-mono text-[9px] text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100">
                        {u.filename}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
