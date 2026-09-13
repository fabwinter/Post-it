import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, pollTask, apiErrorMessage } from "@/lib/api";
import { MediaPicker } from "@/components/MediaPicker";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Sparkles, Loader2, Download, Send, Plus, X, Upload, Shuffle, Music,
} from "lucide-react";

// Re-verified against each model's real input schema (poyo_get_model_schema,
// 2026-09-11) — sizes, resolution tiers and quality levels genuinely differ
// per model, same reasoning as VIDEO_MODELS below. refMax is each model's
// declared image_urls cap (undeclared caps get a conservative default).
// gpt-image-2 -> gpt-image-2.5-sunburst (adds xhigh/max quality and 4K) and
// flux-dev -> seedream-5.0-pro (flux-dev's schema has no resolution/quality
// control at all — seedream-5.0-pro is a stronger like-for-like) are the two
// swaps from the previous lineup; everything else was already current.
const IMAGE_MODELS = [
  {
    value: "gpt-image-2.5-sunburst", label: "GPT Image 2.5",
    sizes: ["auto", "1:1", "2:3", "3:2", "4:3", "3:4", "4:5", "5:4", "16:9", "9:16", "21:9"], defaultSize: "1:1",
    qualities: ["low", "medium", "high", "xhigh", "max"], defaultQuality: "medium",
    resolutions: ["1K", "2K", "4K"], defaultResolution: "1K",
    refMax: 6,
  },
  {
    value: "nano-banana-2", label: "Nano Banana 2",
    sizes: ["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"], defaultSize: "auto",
    qualities: null,
    resolutions: ["1K", "2K", "4K"], defaultResolution: "1K",
    refMax: 4,
  },
  {
    value: "nano-banana-pro", label: "Nano Banana Pro",
    sizes: ["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"], defaultSize: "auto",
    qualities: null,
    resolutions: ["1K", "2K", "4K"], defaultResolution: "1K",
    refMax: 4,
  },
  {
    value: "seedream-5.0-pro", label: "Seedream 5 Pro",
    sizes: ["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9"], defaultSize: "1:1",
    qualities: null,
    resolutions: ["1K", "2K"], defaultResolution: "1K",
    refMax: 8,
  },
  {
    value: "qwen-image-3", label: "Qwen Image 3",
    sizes: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"], defaultSize: "1:1",
    qualities: null,
    resolutions: ["1K", "2K"], defaultResolution: "1K",
    refMax: 3,
  },
  {
    value: "z-image", label: "Z-Image",
    sizes: ["1:1", "4:3", "3:4", "16:9", "9:16"], defaultSize: "1:1",
    qualities: null,
    resolutions: null,
    refMax: 1,
  },
];

// Re-verified against each model's real input schema (poyo_get_model_schema,
// 2026-09-11) — every one of these was still current and every declared
// field still matched exactly. The one change: sora-2-official ->
// sora-2-pro-official, a strict upgrade (adds a resolution tier the base
// model has no field for at all). Fields genuinely differ across models:
// some have no resolution field, duration is a fixed enum for some and a
// free range for others, and the audio flag is named generate_audio, sound,
// or audio depending on the model (or doesn't exist). resolutions/aspects:
// null means the model has no such field at all. refImages: the
// reference-image field this model's schema actually declares — field
// name, how many, and (hailuo-2.3 only) a single scalar URL rather than an
// array. null means this model has no image-to-video path at all.
const VIDEO_MODELS = [
  {
    value: "seedance-2-fast", label: "Seedance 2 Fast",
    resolutions: ["480p", "720p"], defaultResolution: "720p",
    durations: { type: "range", min: 4, max: 15 }, defaultDuration: 5,
    aspects: ["auto", "1:1", "21:9", "4:3", "3:4", "16:9", "9:16"], defaultAspect: "16:9",
    audioField: "generate_audio", defaultAudio: false,
    refImages: { field: "image_urls", max: 2 },
  },
  {
    value: "seedance-2", label: "Seedance 2",
    resolutions: ["480p", "720p", "1080p", "4k"], defaultResolution: "720p",
    durations: { type: "range", min: 4, max: 15 }, defaultDuration: 5,
    aspects: ["auto", "1:1", "21:9", "4:3", "3:4", "16:9", "9:16"], defaultAspect: "16:9",
    audioField: "generate_audio", defaultAudio: false,
    refImages: { field: "image_urls", max: 2 },
  },
  {
    value: "seedance-2.5", label: "Seedance 2.5",
    resolutions: ["480p", "720p", "1080p"], defaultResolution: "720p",
    durations: { type: "range", min: 4, max: 30 }, defaultDuration: 5,
    aspects: ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], defaultAspect: "16:9",
    audioField: "generate_audio", defaultAudio: false,
    refImages: { field: "image_urls", max: 2 },
  },
  {
    value: "kling-3.0-turbo/pro", label: "Kling 3.0 Turbo Pro",
    resolutions: null,
    durations: { type: "range", min: 3, max: 15 }, defaultDuration: 5,
    aspects: ["16:9", "9:16", "1:1"], defaultAspect: "16:9",
    audioField: null,
    refImages: { field: "image_urls", max: 1 },
  },
  {
    value: "veo3.1-quality-official", label: "Veo 3.1 Quality",
    resolutions: ["720p", "1080p", "4k"], defaultResolution: "1080p",
    durations: { type: "enum", values: [4, 6, 8] }, defaultDuration: 8,
    aspects: ["auto", "16:9", "9:16"], defaultAspect: "16:9",
    audioField: "sound", defaultAudio: true,
    refImages: { field: "image_urls", max: 3 },
  },
  {
    value: "veo3.1-fast-official", label: "Veo 3.1 Fast",
    resolutions: ["720p", "1080p", "4k"], defaultResolution: "1080p",
    durations: { type: "enum", values: [4, 6, 8] }, defaultDuration: 8,
    aspects: ["auto", "16:9", "9:16"], defaultAspect: "16:9",
    audioField: "sound", defaultAudio: true,
    refImages: { field: "image_urls", max: 3 },
  },
  {
    value: "sora-2-pro-official", label: "Sora 2 Pro",
    resolutions: ["720p", "1024p", "1080p"], defaultResolution: "1024p",
    durations: { type: "enum", values: [4, 8, 12, 16, 20] }, defaultDuration: 4,
    aspects: ["auto", "16:9", "9:16"], defaultAspect: "16:9",
    audioField: null,
    refImages: { field: "image_urls", max: 1 },
  },
  {
    value: "runway-gen-4.5", label: "Runway Gen-4.5",
    resolutions: null,
    durations: { type: "enum", values: [5, 10] }, defaultDuration: 5,
    aspects: ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"], defaultAspect: "16:9",
    audioField: null,
    refImages: { field: "image_urls", max: 1 },
  },
  {
    value: "wan3.0-text-to-video", label: "Wan 3.0",
    resolutions: ["480p", "720p", "1080p"], defaultResolution: "720p",
    durations: { type: "range", min: 2, max: 30 }, defaultDuration: 5,
    aspects: ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"], defaultAspect: "adaptive",
    audioField: "audio", defaultAudio: true,
    refImages: { field: "image_urls", max: 2 },
  },
  {
    value: "hailuo-03", label: "Hailuo 03",
    resolutions: ["2K"], defaultResolution: "2K",
    durations: { type: "range", min: 5, max: 15 }, defaultDuration: 5,
    aspects: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], defaultAspect: "16:9",
    audioField: null,
    refImages: { field: "image_urls", max: 2 },
  },
  {
    value: "hailuo-2.3", label: "Hailuo 2.3",
    resolutions: ["768p", "1080p"], defaultResolution: "768p",
    durations: { type: "enum", values: [6, 10] }, defaultDuration: 6,
    aspects: null,
    audioField: null,
    refImages: { field: "start_image_url", max: 1, single: true },
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

// A row of picked reference images: thumbnails you can remove, plus an "Add"
// tile up to the model's real limit. Shared by the Image and Video tabs.
function ReferenceImages({ images, max, onAdd, onRemove, hint }) {
  if (!max) return null;
  return (
    <div>
      <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">
        Reference images (optional) · {images.length}/{max}
      </label>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {images.map((img, i) => (
          <div key={i} className="group relative h-14 w-14 overflow-hidden rounded-lg border border-white/10" data-testid={`studio-ref-image-${i}`}>
            <img src={img.thumbnail || img.url} alt="" className="h-full w-full object-cover" />
            <button onClick={() => onRemove(i)} data-testid={`studio-ref-remove-${i}`}
              className="absolute inset-0 flex items-center justify-center bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100">
              <X size={16} />
            </button>
          </div>
        ))}
        {images.length < max && (
          <button onClick={onAdd} data-testid="studio-ref-add"
            className="flex h-14 w-14 items-center justify-center rounded-lg border-2 border-dashed border-white/15 text-zinc-600 hover:border-lime/40 hover:text-lime">
            <Plus size={16} />
          </button>
        )}
      </div>
      {hint && <p className="mt-1.5 text-xs text-zinc-600">{hint}</p>}
    </div>
  );
}

// The image/video/music/voice generator — one prompt box, a model-specific
// options panel, and a preview pane that turns into "Use in post" once
// something comes back. Used identically from the Library (where all
// generated/reusable media lives) and from a Composer deep link ("Generate
// clip" on a reel scene, which opens this with the scene's own prompt
// already in the box).
export function MediaGenerator({ kind, initialPrompt = "" }) {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState(initialPrompt || "");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [fileUrl, setFileUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [instrumental, setInstrumental] = useState(false);

  // image controls
  const [imgModel, setImgModel] = useState(IMAGE_MODELS[0].value);
  const [imgSize, setImgSize] = useState(IMAGE_MODELS[0].defaultSize);
  const [imgQuality, setImgQuality] = useState(IMAGE_MODELS[0].defaultQuality);
  const [imgResolution, setImgResolution] = useState(IMAGE_MODELS[0].defaultResolution);
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
  // reference images (image + video) — a still turned into an edit or into
  // the first/last frame of a clip, not just described in the prompt.
  const [refImages, setRefImages] = useState([]);
  // mashup (music only) — two of your own tracks blended into a new one.
  const [mashupTracks, setMashupTracks] = useState([null, null]);
  // One MediaPicker instance serves three different actions — which one
  // depends on why it was opened: add a reference image, fill a mashup slot,
  // or attach an existing file in place of generating.
  const [picker, setPicker] = useState(null); // null | {mode:"ref"} | {mode:"mashup", slot} | {mode:"use"}

  const currentImageModel = IMAGE_MODELS.find((m) => m.value === imgModel) || IMAGE_MODELS[0];
  const currentVideoModel = VIDEO_MODELS.find((m) => m.value === vidModel) || VIDEO_MODELS[0];
  const currentVoiceModel = VOICE_MODELS.find((m) => m.value === voiceModel) || VOICE_MODELS[0];
  const refMax = kind === "image" ? currentImageModel.refMax : currentVideoModel.refImages?.max || 0;

  // Switching models resets format options to that model's own defaults —
  // simpler and safer than trying to carry over a combination the new model
  // might reject outright (several of these declare additionalProperties: false).
  const onImageModel = (v) => {
    const m = IMAGE_MODELS.find((x) => x.value === v) || IMAGE_MODELS[0];
    setImgModel(v);
    setImgSize(m.defaultSize);
    setImgQuality(m.defaultQuality || "");
    setImgResolution(m.defaultResolution || "");
    setRefImages((s) => s.slice(0, m.refMax));
  };
  const onVideoModel = (v) => {
    const m = VIDEO_MODELS.find((x) => x.value === v) || VIDEO_MODELS[0];
    setVidModel(v);
    setVidRes(m.defaultResolution || "");
    setVidDuration(m.defaultDuration);
    setVidAspect(m.defaultAspect || "");
    setVidAudio(m.defaultAudio || false);
    setRefImages((s) => s.slice(0, m.refImages?.max || 0));
  };

  const addRefImage = (item) => setRefImages((s) => [...s, item].slice(0, refMax));
  const removeRefImage = (i) => setRefImages((s) => s.filter((_, idx) => idx !== i));

  const buildOptions = () => {
    if (kind === "image") {
      const o = { model: imgModel, size: imgSize };
      if (currentImageModel.qualities) o.quality = imgQuality;
      if (currentImageModel.resolutions) o.resolution = imgResolution;
      if (refImages.length) o.image_urls = refImages.map((r) => r.url);
      return o;
    }
    if (kind === "video") {
      const o = { model: vidModel, duration: Number(vidDuration) };
      if (currentVideoModel.resolutions) o.resolution = vidRes;
      if (currentVideoModel.aspects) o.aspect_ratio = vidAspect;
      if (currentVideoModel.audioField) o[currentVideoModel.audioField] = vidAudio;
      if (currentVideoModel.refImages && refImages.length) {
        const urls = refImages.map((r) => r.url);
        o[currentVideoModel.refImages.field] = currentVideoModel.refImages.single ? urls[0] : urls;
      }
      return o;
    }
    if (kind === "voice") {
      const o = { model: voiceModel, voice: voiceName, stability: Number(voiceStability) };
      if (currentVoiceModel.speed) o.speed = Number(voiceSpeed);
      return o;
    }
    const o = { instrumental, mv: musicVersion };
    if (mashupTracks[0] && mashupTracks[1]) o.reference_urls = mashupTracks.map((t) => t.url);
    return o;
  };

  const isMashup = kind === "music" && mashupTracks[0] && mashupTracks[1];

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

  const onPickerSelect = (item) => {
    if (picker?.mode === "ref") {
      addRefImage(item);
    } else if (picker?.mode === "mashup") {
      setMashupTracks((s) => s.map((t, i) => (i === picker.slot ? item : t)));
    } else {
      // Skips generation entirely — an uploaded or stock file is already the
      // finished thing, so it lands straight in the same preview + "Use in
      // post" flow a generated result would.
      setFileUrl(item.url); setStatus("finished"); setProgress(100); setLoading(false);
      toast.success("Attached");
    }
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
              <StudioSelect value={imgModel} onChange={onImageModel} options={IMAGE_MODELS} testid="studio-image-model" />
            </Field>
            <div className="flex flex-wrap gap-3">
              <Field label="Aspect / Size">
                <StudioSelect value={imgSize} onChange={setImgSize} options={currentImageModel.sizes} testid="studio-image-size" />
              </Field>
              {currentImageModel.resolutions && (
                <Field label="Resolution">
                  <StudioSelect value={imgResolution} onChange={setImgResolution} options={currentImageModel.resolutions} testid="studio-image-resolution" />
                </Field>
              )}
              {currentImageModel.qualities && (
                <Field label="Quality">
                  <StudioSelect value={imgQuality} onChange={setImgQuality} options={currentImageModel.qualities} testid="studio-image-quality" />
                </Field>
              )}
            </div>
            <ReferenceImages images={refImages} max={refMax} onAdd={() => setPicker({ mode: "ref" })} onRemove={removeRefImage}
              hint="Turns this from a text prompt into an edit of your photo — e.g. “put this product in a studio setting.”" />
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
            {currentVideoModel.refImages && (
              <ReferenceImages images={refImages} max={refMax} onAdd={() => setPicker({ mode: "ref" })} onRemove={removeRefImage}
                hint={refMax > 1 ? "First image is the starting frame; a second is the ending frame." : "Animates this photo into the clip's starting frame."} />
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
            <div>
              <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">
                <Shuffle size={11} /> Mashup two of your tracks (optional)
              </label>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {[0, 1].map((i) => (
                  <button key={i} onClick={() => setPicker({ mode: "mashup", slot: i })} data-testid={`studio-mashup-slot-${i}`}
                    className="flex items-center gap-1.5 rounded-lg border border-dashed border-white/15 bg-[#0A0A0A] px-2.5 py-2 text-left text-xs text-zinc-400 hover:border-lime/40 hover:text-white">
                    {mashupTracks[i] ? (
                      <>
                        <Music size={12} className="flex-shrink-0 text-lime" />
                        <span className="min-w-0 flex-1 truncate">{mashupTracks[i].filename || "Track " + (i + 1)}</span>
                        <X size={12} className="flex-shrink-0 text-zinc-600 hover:text-magic"
                          onClick={(e) => { e.stopPropagation(); setMashupTracks((s) => s.map((t, idx) => idx === i ? null : t)); }} />
                      </>
                    ) : (
                      <><Upload size={12} className="flex-shrink-0" /> Track {i + 1}</>
                    )}
                  </button>
                ))}
              </div>
              {isMashup && <p className="mt-1.5 text-xs text-zinc-600">The prompt above guides how these two are blended.</p>}
            </div>
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
          {loading ? <Loader2 size={18} className="animate-spin" /> : isMashup ? <Shuffle size={18} /> : <Sparkles size={18} />}
          {isMashup ? "Blend into new music" : `Generate ${kind === "voice" ? "voice over" : kind}`}
        </Button>
        {kind !== "image" && <p className="mt-3 text-xs text-zinc-600">Video, music & voice over can take 1–4 minutes. Keep this tab open.</p>}

        <button onClick={() => setPicker({ mode: "use" })} data-testid={`studio-use-existing-${kind}`}
          className="mt-3 flex w-full items-center justify-center gap-1.5 text-xs text-zinc-500 hover:text-white">
          <Upload size={12} /> Or use a file you already have — no generation needed
        </button>
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

      <MediaPicker
        open={picker !== null}
        onOpenChange={(open) => !open && setPicker(null)}
        defaultType={picker?.mode === "ref" ? "image" : picker?.mode === "mashup" ? "audio" : (kind === "voice" || kind === "music") ? "audio" : kind}
        onSelect={onPickerSelect}
      />
    </div>
  );
}
