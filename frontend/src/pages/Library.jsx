import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { MediaPicker } from "@/components/MediaPicker";
import { toast } from "sonner";
import { Images, Send, Download, Trash2, Image as ImageIcon, Video, Music, Mic, Upload, Sparkles, Plus, Loader2 } from "lucide-react";

const KIND_ICON = { image: ImageIcon, video: Video, music: Music, voice: Mic, audio: Music, file: Upload };

const TABS = [
  { key: "generated", label: "Generated", icon: Sparkles },
  { key: "uploads", label: "Your uploads", icon: Upload },
];

export default function Library() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("generated");
  const [media, setMedia] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
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
      <div className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">Media library</div>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Everything you can drop into a post</h1>

      <div className="mt-6 flex items-center gap-1.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} data-testid={`library-tab-${t.key}`}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${tab === t.key ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
        <Button onClick={() => setPickerOpen(true)} disabled={adding} data-testid="library-add"
          title="Upload a file or add one from Stock"
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-lime p-0 text-[#0A0A0A] hover:bg-lime-hover disabled:opacity-60">
          {adding ? <Loader2 size={15} className="animate-spin" /> : <Plus size={16} />}
        </Button>
      </div>

      {loading && <div className="mt-10 text-sm text-zinc-600">Loading…</div>}

      {!loading && items.length === 0 && (
        <div className="mt-10 flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 p-16 text-center">
          <Images size={28} className="text-zinc-600" />
          <div className="mt-3 text-sm text-zinc-500">{tab === "uploads" ? "Nothing uploaded yet." : "No media yet."}</div>
          {tab === "generated" ? (
            <Button onClick={() => navigate("/studio")} className="mt-4 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover" data-testid="library-go-studio">
              Generate in Studio
            </Button>
          ) : (
            <>
              <p className="mt-2 max-w-xs text-xs text-zinc-600">Uploads from any "Add media" button in the Composer or Studio show up here automatically — or add one straight from here.</p>
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

      <MediaPicker open={pickerOpen} onOpenChange={setPickerOpen} onSelect={addPicked} />
    </div>
  );
}
