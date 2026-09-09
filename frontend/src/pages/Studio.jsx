import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { api, pollTask, apiErrorMessage } from "@/lib/api";
import { PLATFORM_LIST } from "@/lib/platforms";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Sparkles, Image as ImageIcon, Video, Music, Loader2, Type, Download, Send, Copy } from "lucide-react";

const TABS = [
  { key: "text", label: "Write", icon: Type },
  { key: "image", label: "Image", icon: ImageIcon },
  { key: "video", label: "Video", icon: Video },
  { key: "music", label: "Music", icon: Music },
];

export default function Studio() {
  const [tab, setTab] = useState("text");
  return (
    <div data-testid="studio-page">
      <div className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">Content Studio</div>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Generate anything, publish everywhere</h1>

      <Tabs value={tab} onValueChange={setTab} className="mt-7">
        <TabsList className="h-auto w-full justify-start gap-1 rounded-xl border border-white/10 bg-[#121212] p-1.5">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <TabsTrigger key={t.key} value={t.key} data-testid={`studio-tab-${t.key}`}
                className="gap-2 rounded-lg px-4 py-2 text-sm data-[state=active]:bg-lime data-[state=active]:text-[#0A0A0A] data-[state=active]:shadow-none">
                <Icon size={16} /> {t.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="text" className="mt-6"><TextGen /></TabsContent>
        <TabsContent value="image" className="mt-6"><MediaGen kind="image" /></TabsContent>
        <TabsContent value="video" className="mt-6"><MediaGen kind="video" /></TabsContent>
        <TabsContent value="music" className="mt-6"><MediaGen kind="music" /></TabsContent>
      </Tabs>
    </div>
  );
}

function TextGen() {
  const navigate = useNavigate();
  const [brief, setBrief] = useState("");
  const [platform, setPlatform] = useState("twitter");
  const [tone, setTone] = useState("engaging");
  const [out, setOut] = useState("");
  const [loading, setLoading] = useState(false);

  const write = async () => {
    if (!brief.trim()) return;
    setLoading(true); setOut("");
    try {
      const { data } = await api.post("/ai/write", { brief, platform, tone });
      setOut(data.content);
    } catch (e) { toast.error(apiErrorMessage(e, "Generation failed.")); } finally { setLoading(false); }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-white/10 bg-[#121212] p-5">
        <label className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Brief</label>
        <textarea data-testid="studio-text-brief" value={brief} onChange={(e) => setBrief(e.target.value)} rows={6}
          placeholder="What do you want to say? Paste notes, an angle, or a rough draft…"
          className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-[#0A0A0A] p-3 text-sm text-white outline-none focus:border-lime" />

        <label className="mt-4 block font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Platform</label>
        <div className="mt-2 flex flex-wrap gap-2">
          {PLATFORM_LIST.map((p) => (
            <button key={p.key} onClick={() => setPlatform(p.key)} data-testid={`studio-platform-${p.key}`}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${platform === p.key ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
              {p.name}
            </button>
          ))}
        </div>

        <label className="mt-4 block font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Tone</label>
        <div className="mt-2 flex flex-wrap gap-2">
          {["engaging", "professional", "witty", "bold", "inspirational"].map((t) => (
            <button key={t} onClick={() => setTone(t)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-colors ${tone === t ? "border-iris bg-iris/10 text-iris" : "border-white/10 text-zinc-400 hover:text-white"}`}>{t}</button>
          ))}
        </div>

        <Button data-testid="studio-write-button" onClick={write} disabled={loading}
          className="mt-5 w-full gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover">
          {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />} Write it
        </Button>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#121212] p-5">
        <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Output</div>
        <div className="mt-3 min-h-[220px] whitespace-pre-wrap rounded-lg border border-white/10 bg-[#0A0A0A] p-4 text-sm leading-relaxed text-zinc-200">
          {out || <span className="text-zinc-600">Your generated post will appear here.</span>}
        </div>
        {out && (
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={() => { navigator.clipboard.writeText(out); toast.success("Copied"); }}
              className="gap-2 rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10" data-testid="studio-copy-text">
              <Copy size={16} /> Copy
            </Button>
            <Button onClick={() => navigate("/composer", { state: { content: out, platforms: [platform] } })}
              className="gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover" data-testid="studio-send-composer">
              <Send size={16} /> Send to Composer
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

const IMAGE_MODELS = [
  { value: "gpt-image-2", label: "GPT Image 2" },
  { value: "nano-banana-2", label: "Nano Banana Pro" },
  { value: "qwen-image-3", label: "Qwen Image 3" },
  { value: "flux-dev", label: "FLUX Dev" },
  { value: "z-image", label: "Z-Image" },
];
const IMAGE_SIZES = ["1:1", "4:5", "3:2", "2:3", "16:9", "9:16", "4:3", "3:4"];
const IMAGE_QUALITY = ["low", "medium", "high"];

const VIDEO_MODELS = [
  { value: "seedance-2-fast", label: "Seedance 2 Fast", res: ["480p", "720p"] },
  { value: "seedance-2", label: "Seedance 2", res: ["720p", "1080p"] },
];
const VIDEO_ASPECT = ["16:9", "9:16", "1:1", "4:3"];
const VIDEO_DURATIONS = [4, 5, 6, 8, 10];

function Field({ label, children }) {
  return (
    <div className="flex-1">
      <label className="block font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function StudioSelect({ value, onChange, options, testid }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid={testid}
      className="w-full cursor-pointer rounded-lg border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-lime [color-scheme:dark]"
    >
      {options.map((o) => {
        const val = typeof o === "object" ? o.value : o;
        const lab = typeof o === "object" ? o.label : String(o);
        return <option key={val} value={val}>{lab}</option>;
      })}
    </select>
  );
}

function MediaGen({ kind }) {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [fileUrl, setFileUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [instrumental, setInstrumental] = useState(false);

  // image controls
  const [imgModel, setImgModel] = useState("gpt-image-2");
  const [imgSize, setImgSize] = useState("1:1");
  const [imgQuality, setImgQuality] = useState("medium");
  // video controls
  const [vidModel, setVidModel] = useState("seedance-2-fast");
  const [vidRes, setVidRes] = useState("720p");
  const [vidDuration, setVidDuration] = useState(5);
  const [vidAspect, setVidAspect] = useState("16:9");
  const [vidAudio, setVidAudio] = useState(false);

  const vidResOptions = (VIDEO_MODELS.find((m) => m.value === vidModel) || VIDEO_MODELS[0]).res;

  const onVideoModel = (m) => {
    setVidModel(m);
    const allowed = (VIDEO_MODELS.find((x) => x.value === m) || VIDEO_MODELS[0]).res;
    if (!allowed.includes(vidRes)) setVidRes(allowed[0]);
  };

  const buildOptions = () => {
    if (kind === "image") {
      const o = { model: imgModel, size: imgSize };
      if (imgModel.startsWith("gpt-image")) o.quality = imgQuality;
      return o;
    }
    if (kind === "video") {
      return { model: vidModel, resolution: vidRes, duration: Number(vidDuration), aspect_ratio: vidAspect, generate_audio: vidAudio };
    }
    return { instrumental };
  };

  const run = async () => {
    if (!prompt.trim()) return;
    setLoading(true); setFileUrl(""); setStatus("submitting"); setProgress(0);
    try {
      const { data } = await api.post("/ai/generate", { kind, prompt, options: buildOptions() });
      setStatus("running");
      const result = await pollTask(data.task_id, (u) => { setStatus(u.status); setProgress(u.progress || 0); });
      const f = (result.files || []).find((x) => x.file_url);
      if (f) setFileUrl(f.file_url);
      setStatus("finished");
      toast.success(`${kind} generated`);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Generation failed"));
      setStatus("failed");
    } finally { setLoading(false); }
  };

  const currentModelLabel = kind === "image"
    ? (IMAGE_MODELS.find((m) => m.value === imgModel) || {}).label
    : kind === "video"
      ? (VIDEO_MODELS.find((m) => m.value === vidModel) || {}).label
      : "Suno V4.5";

  const labels = {
    image: { title: "Image generation", ph: "A paper-cut illustration of a city at sunrise, editorial style…" },
    video: { title: "Video generation", ph: "A cinematic drone shot flying over a neon city after rain…" },
    music: { title: "Music generation", ph: "An upbeat lo-fi track for a productivity reel, warm and driving…" },
  }[kind];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-white/10 bg-[#121212] p-5">
        <div className="flex items-center justify-between">
          <label className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">{labels.title}</label>
          <span className="font-mono text-[10px] text-zinc-600">{currentModelLabel}</span>
        </div>
        <textarea data-testid={`studio-${kind}-prompt`} value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5}
          placeholder={labels.ph}
          className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-[#0A0A0A] p-3 text-sm text-white outline-none focus:border-lime" />

        {kind === "image" && (
          <div className="mt-4 space-y-3" data-testid="image-controls">
            <Field label="Model">
              <StudioSelect value={imgModel} onChange={setImgModel} options={IMAGE_MODELS} testid="studio-image-model" />
            </Field>
            <div className="flex gap-3">
              <Field label="Aspect / Size">
                <StudioSelect value={imgSize} onChange={setImgSize} options={IMAGE_SIZES} testid="studio-image-size" />
              </Field>
              {imgModel.startsWith("gpt-image") && (
                <Field label="Quality">
                  <StudioSelect value={imgQuality} onChange={setImgQuality} options={IMAGE_QUALITY} testid="studio-image-quality" />
                </Field>
              )}
            </div>
          </div>
        )}

        {kind === "video" && (
          <div className="mt-4 space-y-3" data-testid="video-controls">
            <Field label="Model">
              <StudioSelect value={vidModel} onChange={onVideoModel} options={VIDEO_MODELS} testid="studio-video-model" />
            </Field>
            <div className="flex gap-3">
              <Field label="Resolution">
                <StudioSelect value={vidRes} onChange={setVidRes} options={vidResOptions} testid="studio-video-resolution" />
              </Field>
              <Field label="Duration (s)">
                <StudioSelect value={vidDuration} onChange={setVidDuration} options={VIDEO_DURATIONS} testid="studio-video-duration" />
              </Field>
              <Field label="Aspect">
                <StudioSelect value={vidAspect} onChange={setVidAspect} options={VIDEO_ASPECT} testid="studio-video-aspect" />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              <input type="checkbox" checked={vidAudio} onChange={(e) => setVidAudio(e.target.checked)} className="accent-lime" data-testid="studio-video-audio" />
              Generate audio track
            </label>
          </div>
        )}

        {kind === "music" && (
          <label className="mt-3 flex items-center gap-2 text-sm text-zinc-400">
            <input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} className="accent-lime" data-testid="studio-music-instrumental" />
            Instrumental (no vocals)
          </label>
        )}

        <Button data-testid={`studio-generate-${kind}`} onClick={run} disabled={loading}
          className="mt-5 w-full gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover">
          {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />} Generate {kind}
        </Button>
        {kind !== "image" && <p className="mt-3 text-xs text-zinc-600">Video & music can take 1–4 minutes. Keep this tab open.</p>}
      </div>

      <div className={`rounded-xl border bg-[#121212] p-5 ${loading ? "generating-pulse border-lime/40" : "border-white/10"}`}>
        <div className="flex items-center justify-between">
          <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Preview</div>
          {loading && <span className="font-mono text-[11px] text-lime">{status} · {progress}%</span>}
        </div>
        <div className="mt-3 flex min-h-[240px] items-center justify-center rounded-lg border border-white/10 bg-[#0A0A0A] p-3">
          {loading && (
            <div className="text-center">
              <Loader2 size={28} className="mx-auto animate-spin text-lime" />
              <div className="mt-3 font-mono text-xs text-zinc-500">Generating your {kind}…</div>
            </div>
          )}
          {!loading && !fileUrl && <div className="text-sm text-zinc-600">Output appears here</div>}
          {!loading && fileUrl && kind === "image" && <img src={fileUrl} alt="generated" className="max-h-[360px] w-full rounded-lg object-contain" data-testid="studio-result-image" />}
          {!loading && fileUrl && kind === "video" && <video src={fileUrl} controls className="w-full rounded-lg" data-testid="studio-result-video" />}
          {!loading && fileUrl && kind === "music" && <audio src={fileUrl} controls className="w-full" data-testid="studio-result-music" />}
        </div>
        {fileUrl && (
          <div className="mt-4 flex gap-2">
            <a href={fileUrl} target="_blank" rel="noreferrer">
              <Button variant="secondary" className="gap-2 rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10"><Download size={16} /> Open</Button>
            </a>
            <Button onClick={() => navigate("/composer", { state: { mediaUrl: fileUrl, mediaType: kind } })}
              className="gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover" data-testid={`studio-use-${kind}`}>
              <Send size={16} /> Use in post
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
