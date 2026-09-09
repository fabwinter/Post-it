import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Images, Send, Download, Image as ImageIcon, Video, Music, Mic } from "lucide-react";

const KIND_ICON = { image: ImageIcon, video: Video, music: Music, voice: Mic };

export default function Library() {
  const navigate = useNavigate();
  const [media, setMedia] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/media").then(({ data }) => setMedia(data)).finally(() => setLoading(false));
  }, []);

  return (
    <div data-testid="library-page">
      <div className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">Media library</div>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Everything you've generated</h1>

      {loading && <div className="mt-10 text-sm text-zinc-600">Loading…</div>}

      {!loading && media.length === 0 && (
        <div className="mt-10 flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 p-16 text-center">
          <Images size={28} className="text-zinc-600" />
          <div className="mt-3 text-sm text-zinc-500">No media yet.</div>
          <Button onClick={() => navigate("/studio")} className="mt-4 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover" data-testid="library-go-studio">
            Generate in Studio
          </Button>
        </div>
      )}

      <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {media.map((m) => {
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
      </div>
    </div>
  );
}
