import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { api, pollTask, apiErrorMessage } from "@/lib/api";
import { useTextModels } from "@/lib/useTextModels";
import { PLATFORM_LIST } from "@/lib/platforms";
import { ModelPicker } from "@/components/ModelPicker";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Sparkles, Image as ImageIcon, Video, Music, Mic, Loader2, Type, Download, Send, Copy } from "lucide-react";

const TABS = [
  { key: "text", label: "Write", icon: Type },
  { key: "image", label: "Image", icon: ImageIcon },
  { key: "video", label: "Video", icon: Video },
  { key: "music", label: "Music", icon: Music },
  { key: "voice", label: "Voice Over", icon: Mic },
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
        <TabsContent value="voice" className="mt-6"><MediaGen kind="voice" /></TabsContent>
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
  const { models, default: defaultModel } = useTextModels("gemini-3-flash-preview");
  const [model, setModel] = useState("");

  const write = async () => {
    if (!brief.trim()) return;
    setLoading(true); setOut("");
    try {
      const { data } = await api.post("/ai/write", { brief, platform, tone, model: model || defaultModel });
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

        <label className="mt-4 block font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Model</label>
        <div className="mt-2">
          <ModelPicker value={model || defaultModel} onChange={setModel} models={models} testid="studio-text-model" />
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
  { value: "nano-banana-2", label: "Nano Banana 2" },
  { value: "nano-banana-pro", label: "Nano Banana Pro" },
  { value: "qwen-image-3", label: "Qwen Image 3" },
  { value: "flux-dev", label: "FLUX Dev" },
  { value: "z-image", label: "Z-Image" },
];
const IMAGE_SIZES = ["1:1", "4:5", "3:2", "2:3", "16:9", "9:16", "4:3", "3:4"];
const IMAGE_QUALITY = ["low", "medium", "high"];

// Verified against each model's real input schema (poyo_get_model_schema) —
// they genuinely differ: some have no resolution field, duration is a fixed
// enum for some and a free range for others, and the audio flag is named
// generate_audio, sound, or audio depending on the model (or doesn't exist).
// resolutions/aspects: null means the model has no such field at all.
const VIDEO_MODELS = [
  {
    value: "seedance-2-fast", label: "Seedance 2 Fast",
    resolutions: ["480p", "720p"], defaultResolution: "720p",
    durations: { type: "range", min: 4, max: 15 }, defaultDuration: 5,
    aspects: ["auto", "1:1", "21:9", "4:3", "3:4", "16:9", "9:16"], defaultAspect: "16:9",
    audioField: "generate_audio", defaultAudio: false,
  },
  {
    value: "seedance-2", label: "Seedance 2",
    resolutions: ["480p", "720p", "1080p", "4k"], defaultResolution: "720p",
    durations: { type: "range", min: 4, max: 15 }, defaultDuration: 5,
    aspects: ["auto", "1:1", "21:9", "4:3", "3:4", "16:9", "9:16"], defaultAspect: "16:9",
    audioField: "generate_audio", defaultAudio: false,
  },
  {
    value: "seedance-2.5", label: "Seedance 2.5",
    resolutions: ["480p", "720p", "1080p"], defaultResolution: "720p",
    durations: { type: "range", min: 4, max: 30 }, defaultDuration: 5,
    aspects: ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], defaultAspect: "16:9",
    audioField: "generate_audio", defaultAudio: false,
  },
  {
    value: "kling-3.0-turbo/pro", label: "Kling 3.0 Turbo Pro",
    resolutions: null,
    durations: { type: "range", min: 3, max: 15 }, defaultDuration: 5,
    aspects: ["16:9", "9:16", "1:1"], defaultAspect: "16:9",
    audioField: null,
  },
  {
    value: "veo3.1-quality-official", label: "Veo 3.1 Quality",
    resolutions: ["720p", "1080p", "4k"], defaultResolution: "1080p",
    durations: { type: "enum", values: [4, 6, 8] }, defaultDuration: 8,
    aspects: ["auto", "16:9", "9:16"], defaultAspect: "16:9",
    audioField: "sound", defaultAudio: true,
  },
  {
    value: "veo3.1-fast-official", label: "Veo 3.1 Fast",
    resolutions: ["720p", "1080p", "4k"], defaultResolution: "1080p",
    durations: { type: "enum", values: [4, 6, 8] }, defaultDuration: 8,
    aspects: ["auto", "16:9", "9:16"], defaultAspect: "16:9",
    audioField: "sound", defaultAudio: true,
  },
  {
    value: "sora-2-official", label: "Sora 2",
    resolutions: null,
    durations: { type: "enum", values: [4, 8, 12, 16, 20] }, defaultDuration: 4,
    aspects: ["16:9", "9:16"], defaultAspect: "16:9",
    audioField: null,
  },
  {
    value: "runway-gen-4.5", label: "Runway Gen-4.5",
    resolutions: null,
    durations: { type: "enum", values: [5, 10] }, defaultDuration: 5,
    aspects: ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"], defaultAspect: "16:9",
    audioField: null,
  },
  {
    value: "wan3.0-text-to-video", label: "Wan 3.0",
    resolutions: ["480p", "720p", "1080p"], defaultResolution: "720p",
    durations: { type: "range", min: 2, max: 30 }, defaultDuration: 5,
    aspects: ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"], defaultAspect: "adaptive",
    audioField: "audio", defaultAudio: true,
  },
  {
    value: "hailuo-03", label: "Hailuo 03",
    resolutions: ["2K"], defaultResolution: "2K",
    durations: { type: "range", min: 5, max: 15 }, defaultDuration: 5,
    aspects: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], defaultAspect: "16:9",
    audioField: null,
  },
  {
    value: "hailuo-2.3", label: "Hailuo 2.3",
    resolutions: ["768p", "1080p"], defaultResolution: "768p",
    durations: { type: "enum", values: [6, 10] }, defaultDuration: 6,
    aspects: null,
    audioField: null,
  },
];

const DURATION_CANDIDATES = [2, 3, 4, 5, 6, 8, 10, 12, 15, 16, 20, 30];
function durationOptions(model) {
  if (model.durations.type === "enum") return model.durations.values;
  const { min, max } = model.durations;
  return DURATION_CANDIDATES.filter((d) => d >= min && d <= max);
}

// Verified against elevenlabs-tts-turbo-2-5 and elevenlabs-v3-tts's real
// schemas — turbo-2.5 additionally supports speed/style knobs v3 doesn't.
const VOICE_MODELS = [
  { value: "elevenlabs-tts-turbo-2-5", label: "ElevenLabs Turbo v2.5", speed: true },
  { value: "elevenlabs-v3-tts", label: "ElevenLabs v3", speed: false },
];
const VOICE_NAME_SUGGESTIONS = ["Rachel", "Aria", "Sarah", "Laura"];

// Verified against the generate-music model's real input schema
// (poyo_get_model_schema) — mv is a required enum, exactly these six values.
const MUSIC_VERSIONS = [
  { value: "V5_5", label: "V5.5 — personalized to your taste" },
  { value: "V5", label: "V5 — best expression, faster" },
  { value: "V4_5PLUS", label: "V4.5+ — richer sound" },
  { value: "V4_5", label: "V4.5 — smarter prompts" },
  { value: "V4_5ALL", label: "V4.5 (all)" },
  { value: "V4", label: "V4 — better vocals" },
];

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
  const [vidModel, setVidModel] = useState(VIDEO_MODELS[0].value);
  const [vidRes, setVidRes] = useState(VIDEO_MODELS[0].defaultResolution);
  const [vidDuration, setVidDuration] = useState(VIDEO_MODELS[0].defaultDuration);
  const [vidAspect, setVidAspect] = useState(VIDEO_MODELS[0].defaultAspect);
  const [vidAudio, setVidAudio] = useState(VIDEO_MODELS[0].defaultAudio);
  // music controls
  const [musicVersion, setMusicVersion] = useState("V4_5");
  // voice controls
  const [voiceModel, setVoiceModel] = useState(VOICE_MODELS[0].value);
  const [voiceName, setVoiceName] = useState("Rachel");
  const [voiceStability, setVoiceStability] = useState(0.5);
  const [voiceSpeed, setVoiceSpeed] = useState(1);

  const currentVideoModel = VIDEO_MODELS.find((m) => m.value === vidModel) || VIDEO_MODELS[0];
  const currentVoiceModel = VOICE_MODELS.find((m) => m.value === voiceModel) || VOICE_MODELS[0];

  // Switching models resets format options to that model's own defaults —
  // simpler and safer than trying to carry over a combination the new model
  // might reject outright (several of these declare additionalProperties: false).
  const onVideoModel = (v) => {
    const m = VIDEO_MODELS.find((x) => x.value === v) || VIDEO_MODELS[0];
    setVidModel(v);
    setVidRes(m.defaultResolution || "");
    setVidDuration(m.defaultDuration);
    setVidAspect(m.defaultAspect || "");
    setVidAudio(m.defaultAudio || false);
  };

  const buildOptions = () => {
    if (kind === "image") {
      const o = { model: imgModel, size: imgSize };
      if (imgModel.startsWith("gpt-image")) o.quality = imgQuality;
      return o;
    }
    if (kind === "video") {
      const o = { model: vidModel, duration: Number(vidDuration) };
      if (currentVideoModel.resolutions) o.resolution = vidRes;
      if (currentVideoModel.aspects) o.aspect_ratio = vidAspect;
      if (currentVideoModel.audioField) o[currentVideoModel.audioField] = vidAudio;
      return o;
    }
    if (kind === "voice") {
      const o = { model: voiceModel, voice: voiceName, stability: Number(voiceStability) };
      if (currentVoiceModel.speed) o.speed = Number(voiceSpeed);
      return o;
    }
    return { instrumental, mv: musicVersion };
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
      ? currentVideoModel.label
      : kind === "voice"
        ? currentVoiceModel.label
        : (MUSIC_VERSIONS.find((m) => m.value === musicVersion) || {}).label;

  const labels = {
    image: { title: "Image generation", ph: "A paper-cut illustration of a city at sunrise, editorial style…" },
    video: { title: "Video generation", ph: "A cinematic drone shot flying over a neon city after rain…" },
    music: { title: "Music generation", ph: "An upbeat lo-fi track for a productivity reel, warm and driving…" },
    voice: { title: "Voice over", ph: "Write the script to turn into a voice over…" },
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
            <div className="flex flex-wrap gap-3">
              {currentVideoModel.resolutions && (
                <Field label="Resolution">
                  <StudioSelect value={vidRes} onChange={setVidRes} options={currentVideoModel.resolutions} testid="studio-video-resolution" />
                </Field>
              )}
              <Field label="Duration (s)">
                <StudioSelect value={vidDuration} onChange={setVidDuration} options={durationOptions(currentVideoModel)} testid="studio-video-duration" />
              </Field>
              {currentVideoModel.aspects && (
                <Field label="Aspect">
                  <StudioSelect value={vidAspect} onChange={setVidAspect} options={currentVideoModel.aspects} testid="studio-video-aspect" />
                </Field>
              )}
            </div>
            {currentVideoModel.audioField && (
              <label className="flex items-center gap-2 text-sm text-zinc-400">
                <input type="checkbox" checked={vidAudio} onChange={(e) => setVidAudio(e.target.checked)} className="accent-lime" data-testid="studio-video-audio" />
                Generate audio track
              </label>
            )}
          </div>
        )}

        {kind === "music" && (
          <div className="mt-4 space-y-3" data-testid="music-controls">
            <Field label="Model">
              <StudioSelect value={musicVersion} onChange={setMusicVersion} options={MUSIC_VERSIONS} testid="studio-music-model" />
            </Field>
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              <input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} className="accent-lime" data-testid="studio-music-instrumental" />
              Instrumental (no vocals)
            </label>
          </div>
        )}

        {kind === "voice" && (
          <div className="mt-4 space-y-3" data-testid="voice-controls">
            <div className="flex gap-3">
              <Field label="Model">
                <StudioSelect value={voiceModel} onChange={setVoiceModel} options={VOICE_MODELS} testid="studio-voice-model" />
              </Field>
              <Field label="Voice">
                <input list="studio-voice-suggestions" value={voiceName} onChange={(e) => setVoiceName(e.target.value)}
                  data-testid="studio-voice-name"
                  className="w-full rounded-lg border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-lime" />
                <datalist id="studio-voice-suggestions">
                  {VOICE_NAME_SUGGESTIONS.map((v) => <option key={v} value={v} />)}
                </datalist>
              </Field>
            </div>
            <div className="flex gap-3">
              <Field label={`Stability · ${voiceStability}`}>
                <input type="range" min="0" max="1" step="0.05" value={voiceStability}
                  onChange={(e) => setVoiceStability(e.target.value)} data-testid="studio-voice-stability"
                  className="w-full accent-lime" />
              </Field>
              {currentVoiceModel.speed && (
                <Field label={`Speed · ${voiceSpeed}x`}>
                  <input type="range" min="0.7" max="1.2" step="0.01" value={voiceSpeed}
                    onChange={(e) => setVoiceSpeed(e.target.value)} data-testid="studio-voice-speed"
                    className="w-full accent-lime" />
                </Field>
              )}
            </div>
          </div>
        )}

        <Button data-testid={`studio-generate-${kind}`} onClick={run} disabled={loading}
          className="mt-5 w-full gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover">
          {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />} Generate {kind === "voice" ? "voice over" : kind}
        </Button>
        {kind !== "image" && <p className="mt-3 text-xs text-zinc-600">Video, music & voice over can take 1–4 minutes. Keep this tab open.</p>}
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
          {!loading && fileUrl && (kind === "music" || kind === "voice") && <audio src={fileUrl} controls className="w-full" data-testid={`studio-result-${kind}`} />}
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
