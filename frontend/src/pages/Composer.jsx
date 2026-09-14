import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toPng } from "html-to-image";
import JSZip from "jszip";
import { api, pollTask, apiErrorMessage } from "@/lib/api";
import { useTextModels } from "@/lib/useTextModels";
import { useBrandKit, useBrandKits, activeColors } from "@/lib/useBrand";
import { PLATFORM_LIST, platformOf } from "@/lib/platforms";
import { usePlatformSpecs, specFor, aspectFor, FORMAT_LABEL, FALLBACK_SPECS } from "@/lib/platformSpecs";
import { openHistory } from "@/lib/historyBus";
import { PostPreview } from "@/components/PostPreview";
import { ModelPicker } from "@/components/ModelPicker";
import { VisualCard, ASPECT_CLASS, ASPECT_RATIO, THEME_LIST, themeFor } from "@/components/VisualCard";
import { SlideEditor } from "@/components/SlideEditor";
import { CanvasEditor } from "@/components/CanvasEditor";
import { ReelPlayer } from "@/components/ReelPlayer";
import { VideoClipEditor } from "@/components/VideoClipEditor";
import { ReelExportDialog } from "@/components/ReelExportDialog";
import { MediaPicker } from "@/components/MediaPicker";
import { useTemplateStyles } from "@/lib/templateStyles";
import { useCustomTemplates } from "@/lib/useCustomTemplates";
import { elementsFromSpec, newElement, useCardScale, clampPos } from "@/lib/slideElements";
import { materializeTemplateSlides } from "@/lib/templateEdit";
import { groupFontsByCategory, fontStack, useAllFontsLoaded, useFontCatalog } from "@/lib/fonts";
import { FontNotice } from "@/components/CustomFonts";
import { reelTimeline, normalizeClip, formatSeconds, withLength, deriveCaptionWords } from "@/lib/videoClip";
import { ElementsLibrary } from "@/components/ElementsLibrary";
import { ComposerFromSource } from "@/components/ComposerFromSource";
import { ComposerVisualPanel } from "@/components/ComposerVisualPanel";
import { ComposerBatchPanel } from "@/components/ComposerBatchPanel";
import { ComposerIdeaPanel } from "@/components/ComposerIdeaPanel";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Sparkles, Loader2, Save, CalendarClock, Send, Wand2, Trash2, X, GraduationCap,
  Plus, ChevronLeft, ChevronRight, Download, ImagePlus, History, Hash, Film, Layers,
  Search, Wand, Palette, Upload, FileText, Image as ImageIcon, Presentation,
  Type, Square, LayoutTemplate, Undo2, Redo2, Copy, ChevronsUp, ChevronsDown, AlignLeft, AlignCenter, AlignRight,
  Shapes, CopyPlus, BookmarkPlus, Maximize2, PlayCircle, SquarePen, Lightbulb, Repeat, LayoutGrid,
  Music, Volume2, VolumeX, RefreshCw,
} from "lucide-react";

// The first four are the ones PoYo's TTS model schema documents as its own
// examples. The rest are specific ElevenLabs voices picked by ID rather than
// name — the turbo-2.5 model's `voice` field explicitly accepts either
// ("voice name or compatible voice ID"), so a real voice ID works exactly
// like a preset name. Three of the six have public names/descriptions
// findable outside ElevenLabs' own (unreachable from here) voice pages;
// the other three don't turn up anywhere public — likely private or
// recently added — so they're labeled plainly rather than guessed at.
// Either way, picking one only steers what a scene records next (a fresh
// build, or a per-scene retake); it never silently re-records takes
// already sitting on the reel.
const VOICE_PRESETS = [
  { key: "Rachel", label: "Rachel", desc: "Warm, professional — the default" },
  { key: "Aria", label: "Aria", desc: "Bright, expressive" },
  { key: "Sarah", label: "Sarah", desc: "Calm, measured" },
  { key: "Laura", label: "Laura", desc: "Confident, upbeat" },
  { key: "Qggl4b0xRMiqOwhPtVWT", label: "Clara", desc: "Warm, soothing, American accent" },
  { key: "M7ya1YbaeFaPXljg9BpK", label: "Hannah", desc: "Natural Australian accent" },
  { key: "jQQiXyFE3PBHLF8znAIb", label: "Custom voice — AU", desc: "Australian, urban Sydney accent, early-mid 30s" },
  { key: "vChnJZ1Cu89g2XXumPfT", label: "Custom voice 1", desc: "No public description found for this voice ID" },
  { key: "uWAhmTxbFR3p3HsniNS9", label: "Custom voice 2", desc: "No public description found for this voice ID" },
  { key: "VyyyOgRmsqOzaZXnKWnI", label: "Custom voice 3", desc: "No public description found for this voice ID" },
];

// The four ways a post can start here — icons/labels for the mode switcher
// above the topic/build controls.
const START_MODES = [
  { key: "topic", label: "Topic", icon: Lightbulb },
  { key: "source", label: "Source", icon: Repeat },
  { key: "visual", label: "Visual", icon: Shapes },
  { key: "batch", label: "Batch", icon: LayoutGrid },
];

// Pexels only accepts these three; map a platform's aspect onto the closest one
// so results aren't a mismatched crop away from unusable.
const orientationFor = (aspect) => {
  if (aspect === "9:16") return "portrait";
  if (aspect === "16:9" || aspect === "1.91:1") return "landscape";
  return aspect === "4:5" ? "portrait" : "square";
};

// A beat of silence after the line finishes reading, before the cut — a
// scene that ends the instant the voice stops feels clipped.
const VOICE_PAD_SECONDS = 0.5;

// Quiet enough to sit under a voiceover without a fight — there's no real
// ducking yet (ducking is per-line, this is a flat level for the whole
// track), so it has to be low enough to work for the loudest line.
const DEFAULT_MUSIC_VOLUME = 0.18;

const emptySlide = (index, total, theme = "midnight") => ({
  type: "visual", caption: "",
  spec: { template: index === 0 ? "cover" : "slide", theme, index, total, title: "", heading: "", body: "" },
});

// Reads the one starting platform from wherever it might arrive — the new
// `start` intent, or a stale pre-refactor `state.platforms` array a caller
// hasn't been updated to send yet. Needed synchronously at mount (to pick
// the platform's native format before first paint), before the
// location.key effect below gets a chance to run.
const initialPlatform = (state) => state.start?.platform || state.platforms?.[0] || "instagram";

// One-release compatibility: a browser-history entry created before this
// deploy (a back button mid-session) still carries the old flat keys
// instead of a single `start` intent. Translates them into the new shape
// so a stale entry isn't silently dropped — delete this, and the flat
// `state.*` reads it covers, once nothing in the wild can still produce
// them (this deploy plus one).
function normalizeLegacyStart(state) {
  if (state.postId) return { from: "post", value: state.postId };
  if (state.plan) return { from: "plan", value: state.plan };
  if (state.editTemplateId) return { from: "design", value: state.editTemplateId, mode: "edit" };
  if (state.applyCustomTemplateId) return { from: "design", value: state.applyCustomTemplateId };
  if (state.visual) return { from: "visual", value: state.visual };
  if (state.brief) return { from: "brief", value: state.brief };
  if (state.content) return { from: "draft", value: { content: state.content, platform: state.platforms?.[0] } };
  if (state.mediaUrl) return { from: "media", value: { url: state.mediaUrl, type: state.mediaType } };
  if (["topic", "source", "visual", "batch"].includes(state.startTab)) return { from: state.startTab };
  if (state.presetDate || state.brandKitId) return { from: "topic", presetDate: state.presetDate, brandKitId: state.brandKitId };
  return null;
}

export default function Composer() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state || {};
  const specs = usePlatformSpecs();
  const [brandKitId, setBrandKitId] = useState(null);
  const { brand } = useBrandKit(brandKitId);
  const { kits: brandKits } = useBrandKits();

  const [postId, setPostId] = useState(null);
  const [title, setTitle] = useState("Untitled post");
  const [content, setContent] = useState("");
  const [platforms, setPlatforms] = useState(() => [initialPlatform(state)]);
  // Start on the platform's native format — opening the Composer for Instagram
  // should offer a carousel, not a single graphic you then have to switch.
  const [format, setFormat] = useState(
    () => FALLBACK_SPECS[initialPlatform(state)]?.default_format || "single"
  );
  const [assets, setAssets] = useState([]);
  const [hashtags, setHashtags] = useState([]);
  const [altText, setAltText] = useState("");
  const [contentByPlatform, setContentByPlatform] = useState({});
  const [platformTab, setPlatformTab] = useState(null);
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState("");
  // A reel's background score — {url, volume, credit}, or {} for none.
  // Separate from a scene's own clip/voice: one track underscores the
  // whole reel rather than resetting per scene.
  const [music, setMusic] = useState({});
  const [scheduleAt, setScheduleAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  // Set to the idea's index while the Idea panel's own "Build" is running
  // for that idea, so only that one card shows a spinner — `building`
  // above stays reserved for "Build whole post" acting on the brief.
  const [buildingIdeaIndex, setBuildingIdeaIndex] = useState(null);
  // True while a fresh reel's scenes are each getting a real spoken take —
  // runs in the background after the script itself has already landed, so
  // it never blocks seeing/editing the scenes, only how long they hold.
  const [voiceSynthesizing, setVoiceSynthesizing] = useState(false);
  // True while a fresh reel's scenes are each getting real footage from a
  // stock search — same background-fill shape as voice, running alongside
  // it rather than after it, since the two touch different fields.
  const [visualFilling, setVisualFilling] = useState(false);
  // True while a fresh reel's background score is generating — the third
  // and last of the three things a script alone doesn't have yet.
  const [musicLoading, setMusicLoading] = useState(false);
  const [musicError, setMusicError] = useState(false);
  // The real reason a score failed — a toast says this once and is gone;
  // this sits next to the retry button so a failure that only shows up
  // against the real PoYo backend (never seen against the e2e fake) is
  // actually diagnosable from a screenshot instead of a guess.
  const [musicErrorMessage, setMusicErrorMessage] = useState("");
  // Per-scene state for voice/footage, keyed by scene index — lets a single
  // scene whose take or search failed show its own retry control and its
  // own spinner, instead of only the reel-wide toast the first pass gave.
  const [sceneVoiceLoading, setSceneVoiceLoading] = useState({});
  const [sceneVoiceError, setSceneVoiceError] = useState({});
  const [sceneVisualLoading, setSceneVisualLoading] = useState({});
  const [sceneVisualError, setSceneVisualError] = useState({});
  // Which of the curated voices a scene's take (or retake) records in —
  // a reel-wide choice rather than per scene, since a reel reads as one
  // voice throughout.
  const [voicePreset, setVoicePreset] = useState(VOICE_PRESETS[0].key);
  const [brief, setBrief] = useState("");
  // Folded in from the old Write page's own tone picker — "Caption only"
  // used to always write as "engaging" with no way to change it.
  const [briefTone, setBriefTone] = useState("engaging");
  // How this post is starting: a topic (the default — brief + AI write/
  // build), a source to repurpose, a generated visual, or one pick from a
  // batch of drafts. Folded in from three standalone pages that each did
  // one of these and then handed off to the Composer; startFrom below
  // switches this the moment an intent names one of these modes.
  const [startMode, setStartMode] = useState("topic");
  const { models, default: defaultModel } = useTextModels("gemini-3-flash-preview");
  const [model, setModel] = useState("");
  const [coach, setCoach] = useState(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [selectedElementId, setSelectedElementId] = useState(null);
  const [renderingSlide, setRenderingSlide] = useState(null);
  const [stockTarget, setStockTarget] = useState(null); // "slide-image" | "slide-video" | "media" | "element-new" | "element-replace"
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  // Reels get a second way to look at the deck: the canvas edits one scene,
  // the player watches all of them end to end at their real lengths.
  const [reelView, setReelView] = useState("canvas");
  const [exportOpen, setExportOpen] = useState(false);
  const [clipUploading, setClipUploading] = useState(false);
  // Which surface asked for the elements library — a scene's footage, or
  // just another element to drop on the canvas.
  const [libraryTarget, setLibraryTarget] = useState(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [styleTemplate, setStyleTemplate] = useState("hooks");
  const [restyling, setRestyling] = useState(false);
  const templates = useTemplateStyles();
  const [customTemplateId, setCustomTemplateId] = useState(null);
  // Set to true only when a "design" intent applies a design (never a
  // manual dropdown pick) — the one-time signal for the sync effect below
  // to adopt that design's native format, once.
  const pendingTemplateSync = useRef(false);
  const { templates: customTemplates, loading: customTemplatesLoading, reload: reloadCustomTemplates } = useCustomTemplates();
  const [templateUploadType, setTemplateUploadType] = useState("pptx");
  const [templateUploading, setTemplateUploading] = useState(false);
  const templateFileRef = useRef(null);
  const cardRef = useRef(null);
  const previewBoxRef = useRef(null);
  const previewScale = useCardScale(previewBoxRef, 0.45);
  // Every saved template can be built for any post size — its layout is
  // percentage-based, so it reflows to a different aspect ratio the moment
  // the deck's format changes. Ones already built for the format in view
  // sort first as the obvious picks; everything else stays one click away,
  // labeled with its native size so it's clear it'll be resized to fit.
  const sortedCustomTemplates = [...customTemplates].sort((a, b) => {
    const am = a.format === format, bm = b.format === format;
    return am === bm ? 0 : am ? -1 : 1;
  });

  // Editing an existing saved template (opened from the Template Library's
  // "Edit" button) rather than drafting a post: the deck below is the
  // template's own layout materialized into real editable slides, and
  // "Save changes" overwrites that same template instead of creating a
  // new post or a new template.
  const [editingTemplateId, setEditingTemplateId] = useState(null);
  const [editingTemplateName, setEditingTemplateName] = useState("");
  const [savingTemplateEdit, setSavingTemplateEdit] = useState(false);
  const templateEditLoaded = useRef(false);
  useEffect(() => {
    if (!editingTemplateId || templateEditLoaded.current || customTemplatesLoading) return;
    const tpl = customTemplates.find((t) => t.id === editingTemplateId);
    if (!tpl) { templateEditLoaded.current = true; setEditingTemplateId(null); toast.error("That design no longer exists."); return; }
    templateEditLoaded.current = true;
    setFormat(tpl.format);
    setEditingTemplateName(tpl.name);
    setAssets(materializeTemplateSlides(tpl));
    setActive(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTemplateId, customTemplates, customTemplatesLoading]);

  const primary = platforms[0] || "instagram";
  const pspec = specFor(specs, primary);
  const aspect = aspectFor(specs, primary, format);
  const aspectCls = ASPECT_CLASS[aspect] || "aspect-square";
  // How wide the inline canvas is allowed to get. It takes the flexible
  // grid track now, so the only thing that has to be capped is height —
  // a 9:16 card at the full column width would be taller than the screen.
  const inlineCanvasMaxW = Math.round(Math.min(560, 520 / (ASPECT_RATIO[aspect] || 1)));
  const isDeck = format === "carousel" || format === "reel" || format === "thread";
  const isReel = format === "reel";
  const anyVoiceError = Object.values(sceneVoiceError).some(Boolean);
  const anyVisualError = Object.values(sceneVisualError).some(Boolean);

  // Applying a plan is the whole idea→post shortcut landing: copy, hashtags,
  // format and every slide arrive together, already on-brand.
  const applyPlan = (plan) => {
    setTitle(plan.title || "Untitled post");
    setContent(plan.caption || "");
    setHashtags(plan.hashtags || []);
    setAltText(plan.alt_text || "");
    setContentByPlatform({});
    setFormat(plan.format || "single");
    setAssets(plan.assets || []);
    setActive(0);
    if (plan.platform) setPlatforms([plan.platform]);
    // A fresh reel script has a line for every scene and no way to say it
    // yet, and a shot idea with no shot — give it both automatically, the
    // same click that wrote the script. The two run side by side (voice
    // sets clip.hold and spec.voice; visuals sets clip.url) rather than one
    // after the other, since they touch different fields on the same scene.
    setMusic({});
    if (plan.format === "reel" && (plan.assets || []).some((a) => a.type === "scene")) {
      synthesizeReelVoices(plan.assets);
      autoFillReelVisuals(plan.assets);
      synthesizeReelMusic(plan.title || plan.hook || plan.caption || "");
    }
  };

  // Loads a URL into a throwaway <audio> element just long enough to read
  // its real duration — the only way to know how long a spoken line
  // actually runs. Resolves null (never rejects) so one bad take can't sink
  // the rest of the reel; the scene just keeps its previous/default hold.
  const probeAudioDuration = (url) => new Promise((resolve) => {
    const el = document.createElement("audio");
    el.preload = "metadata";
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    el.addEventListener("loadedmetadata", () => done(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null), { once: true });
    el.addEventListener("error", () => done(null), { once: true });
    setTimeout(() => done(null), 15000);
    el.src = url;
  });

  // One scene's take — shared by the reel-wide background fill below and by
  // a single scene's own "retry"/"re-record" button, so a failure (or a
  // hand-edited line) never means redoing every other scene's take too.
  // Resolves true/false rather than throwing: the caller decides what a
  // failure means (a silent count for the bulk fill, a toast for a retry).
  const synthesizeSceneVoice = async (index, text) => {
    const body = (text ?? assets[index]?.spec?.body ?? "").trim();
    if (!body) return false;
    setSceneVoiceLoading((s) => ({ ...s, [index]: true }));
    setSceneVoiceError((s) => ({ ...s, [index]: false }));
    try {
      const { data } = await api.post("/ai/generate", { kind: "voice", prompt: body, options: { timestamps: true, voice: voicePreset } });
      const result = await pollTask(data.task_id);
      const url = (result.files || []).find((f) => f.file_url)?.file_url;
      if (!url) throw new Error("No voice file came back");
      const duration = await probeAudioDuration(url);
      const words = deriveCaptionWords(body, duration, result.alignment);
      setAssets((s) => s.map((asset, idx) => {
        if (idx !== index) return asset;
        const clip = duration ? withLength(asset.spec.clip, duration + VOICE_PAD_SECONDS) : asset.spec.clip;
        return { ...asset, spec: { ...asset.spec, voice: { url, duration: duration || null, words }, clip } };
      }));
      return true;
    } catch {
      setSceneVoiceError((s) => ({ ...s, [index]: true }));
      return false;
    } finally {
      setSceneVoiceLoading((s) => ({ ...s, [index]: false }));
    }
  };

  const retrySceneVoice = async (index) => {
    const ok = await synthesizeSceneVoice(index);
    if (ok) toast.success(`Scene ${index + 1}'s voiceover updated`);
    else toast.error(`Couldn't record scene ${index + 1}'s voiceover.`);
  };

  // The one thing that makes a reel feel produced instead of guessed: every
  // scene gets a real recorded take of its own line, and the scene holds
  // the screen for exactly as long as that take runs (plus a short pad) —
  // not a flat default that's wrong for a four-word line and a forty-word
  // one alike. Runs in the background so the script is usable immediately;
  // each scene's card just gets longer (or shorter) as its take comes in.
  // One bad line only costs that scene its custom timing (and leaves it a
  // retry button), never the reel.
  const synthesizeReelVoices = async (sceneAssets) => {
    const lines = sceneAssets.filter((a) => (a.spec?.body || "").trim());
    if (!lines.length) return;
    setVoiceSynthesizing(true);
    try {
      const results = await Promise.all(sceneAssets.map((a, i) => synthesizeSceneVoice(i, a.spec?.body)));
      const done = results.filter(Boolean).length;
      if (done === lines.length) toast.success("Voiceover recorded for every scene");
      else if (done > 0) toast.error(`Voiceover recorded for ${done} of ${lines.length} scenes`);
      else toast.error("Couldn't record the voiceover — scenes kept their default timing.");
    } finally {
      setVoiceSynthesizing(false);
    }
  };

  // One scene's footage search — shared the same way synthesizeSceneVoice is,
  // so a scene whose search came up empty gets its own retry instead of
  // waiting on the whole reel to be rebuilt.
  const fillSceneVisual = async (index, query) => {
    const asset = assets[index];
    const q = (query ?? asset?.spec?.video_prompt ?? asset?.spec?.heading ?? "").trim();
    if (!q) return false;
    setSceneVisualLoading((s) => ({ ...s, [index]: true }));
    setSceneVisualError((s) => ({ ...s, [index]: false }));
    try {
      const orientation = orientationFor(aspectFor(specs, primary, "reel"));
      const { data } = await api.get("/stock/search", { params: { q, type: "video", per_page: 1, orientation } });
      const pick = (data.results || []).find((r) => r.url);
      if (!pick) throw new Error("No footage found");
      setAssets((s) => s.map((a, idx) => {
        if (idx !== index) return a;
        const clip = normalizeClip({
          ...a.spec.clip, url: pick.url, credit: pick.credit || "", kind: "video",
          natural: null, start: 0, end: null,
        });
        return { ...a, spec: { ...a.spec, video_url: pick.url, video_credit: pick.credit || "", clip } };
      }));
      return true;
    } catch {
      setSceneVisualError((s) => ({ ...s, [index]: true }));
      return false;
    } finally {
      setSceneVisualLoading((s) => ({ ...s, [index]: false }));
    }
  };

  const retrySceneVisual = async (index) => {
    const ok = await fillSceneVisual(index);
    if (ok) toast.success(`Scene ${index + 1}'s footage updated`);
    else toast.error(`Couldn't find footage for scene ${index + 1}.`);
  };

  // Every scene ships with a shot idea and no shot. The fast, default take:
  // search free stock footage for it and drop the first usable clip
  // straight in, the same shape a manual "Stock video" pick already
  // produces — a search is a fetch, not a generation, so a whole reel's
  // worth of footage lands about as fast as its voice recordings do.
  // Preserves whatever hold synthesizeReelVoices has already set (or will
  // set moments later): only the footage changes here, never the timing.
  const autoFillReelVisuals = async (sceneAssets) => {
    const withPrompt = sceneAssets.filter((a) => (a.spec?.video_prompt || a.spec?.heading || "").trim());
    if (!withPrompt.length) return;
    setVisualFilling(true);
    try {
      const results = await Promise.all(sceneAssets.map((a, i) => fillSceneVisual(i, a.spec?.video_prompt || a.spec?.heading)));
      const done = results.filter(Boolean).length;
      if (done === withPrompt.length) toast.success("Footage found for every scene");
      else if (done > 0) toast.error(`Footage found for ${done} of ${withPrompt.length} scenes`);
      else toast.error("Couldn't find footage — scenes kept their themed background.");
    } finally {
      setVisualFilling(false);
    }
  };

  // A background score for the whole reel — one track, not per scene,
  // generated from what the post is actually about so it isn't generic
  // stock elevator music. Instrumental by default: a second voice under
  // the one already reading the script would only compete with it. Takes a
  // plain seed string rather than a plan object so it can be re-triggered
  // — a failed generation's retry, or "give me a different one" — from
  // whatever the post is titled/captioned right now, not just at build time.
  const synthesizeReelMusic = async (seedText) => {
    const seed = (seedText || "").slice(0, 80).trim();
    const prompt = `Upbeat, unobtrusive instrumental background music for a short vertical video${seed ? ` about: ${seed}` : ""}.`;
    setMusicLoading(true);
    setMusicError(false);
    setMusicErrorMessage("");
    try {
      const { data } = await api.post("/ai/generate", {
        kind: "music", prompt,
        options: { instrumental: true, style: "Upbeat, cinematic, unobtrusive instrumental", title: seed || "Background score" },
      });
      // Music renders slower than the other kinds under load — the generic
      // 6-minute default (shared with image/video) was cutting off takes
      // that were still genuinely in progress, not stuck.
      const result = await pollTask(data.task_id, null, { timeout: 480000 });
      const url = (result.files || []).find((f) => f.file_url)?.file_url;
      if (!url) throw new Error("No music file came back");
      setMusic({ url, volume: DEFAULT_MUSIC_VOLUME, credit: "" });
      toast.success("Background music ready");
    } catch (e) {
      const msg = apiErrorMessage(e, "Couldn't generate background music.");
      setMusicError(true);
      setMusicErrorMessage(msg);
      toast.error(msg);
    } finally {
      setMusicLoading(false);
    }
  };

  const removeMusic = () => setMusic({});
  const setMusicVolume = (v) => setMusic((m) => (m.url ? { ...m, volume: v } : m));

  // The one door in: everywhere that used to hand the Composer its own
  // loose location.state key (postId, plan, brief, content, visual,
  // mediaUrl, startTab, applyCustomTemplateId, editTemplateId, presetDate…
  // 12 keys, any combination) now sends a single `start` intent instead —
  // one shape for every caller to construct, one reader here instead of a
  // dozen scattered checks. Keyed on location.key, not just mount: several
  // flows navigate here from Composer itself (a redirect from a retired
  // page, History's "Use" while already composing) — a same-path
  // navigation doesn't remount the component, so without this its own new
  // intent would silently never be picked up. That exact gap was live: an
  // intent arriving this way used to only reach the handful of keys read
  // inside this effect, while the rest (content, mediaUrl, startTab, the
  // template pickers…) were mount-only useState initializers that a
  // same-path navigation never re-ran — so History's "Use" silently did
  // nothing for 5 of its 8 kinds when clicked from inside an open Composer.
  useEffect(() => {
    const start = state.start || normalizeLegacyStart(state);
    if (start) startFrom(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  const startFrom = (start) => {
    const { from, value, platform, brandKitId: startBrandKitId, presetDate, mode } = start;
    if (startBrandKitId) setBrandKitId(startBrandKitId);
    if (presetDate) setScheduleAt(toLocalInput(presetDate));
    if (platform) setPlatforms([platform]);

    switch (from) {
      case "post":
        setStartMode("topic");
        api.get(`/posts/${value}`).then(({ data }) => {
          setPostId(data.id); setTitle(data.title); setContent(data.content);
          setPlatforms(data.platforms.length ? data.platforms : ["instagram"]);
          setFormat(data.format || "single");
          setAssets(data.assets || []);
          setHashtags(data.hashtags || []);
          setAltText(data.alt_text || "");
          setContentByPlatform(data.content_by_platform || {});
          setMediaUrl((data.media_urls || [])[0] || ""); setMediaType(data.media_type || "");
          setMusic(data.music || {});
          if (data.brand_kit_id) setBrandKitId(data.brand_kit_id);
          if (data.scheduled_time) setScheduleAt(toLocalInput(data.scheduled_time));
        }).catch((e) => toast.error(apiErrorMessage(e, "Couldn't load that post.")));
        break;
      // The idea→post shortcut: copy, hashtags, format and every slide
      // arrive together, already on-brand.
      case "plan":
        applyPlan(value);
        setStartMode("topic");
        break;
      // A topic to auto-write from — unlike "draft" below, this triggers
      // the AI call rather than dropping in literal text.
      case "brief":
        setBrief(value);
        generate(value);
        setStartMode("topic");
        break;
      // Literal text ready to use as-is: History's write/restyle/repurpose/
      // batch/coach kinds all resolve to exactly this shape, the same one
      // the Source and Batch panels apply from while composing.
      case "draft":
        applyDraft(value);
        break;
      // A deck arriving from the Visual panel (or a deep link with one
      // already generated) comes as specs, not a flattened PNG. With no
      // value, this just opens the Visual tab so a new one can be made.
      case "visual":
        setStartMode("visual");
        if (value) { applyVisual(value); setStartMode("topic"); }
        break;
      case "media":
        setMediaUrl(value.url); setMediaType(value.type || "");
        setStartMode("topic");
        break;
      // A saved design: `mode: "edit"` opens it for in-place editing
      // (Save overwrites the design); the default applies it once to the
      // post being composed, same as picking it from the dropdown below —
      // pendingTemplateSync is the signal that lets that one application
      // adopt the design's native format, which a manual dropdown pick
      // deliberately doesn't (see the sync effect below).
      case "design":
        if (mode === "edit") {
          setEditingTemplateId(value);
        } else {
          pendingTemplateSync.current = true;
          setCustomTemplateId(value);
        }
        setStartMode("topic");
        break;
      case "source":
        setStartMode("source");
        break;
      case "batch":
        setStartMode("batch");
        break;
      default:
        setStartMode("topic");
    }
  };

  // Turns a generated card/deck (from the Visual panel) into editable
  // slides on the post currently open here — used both by a "visual"
  // intent arriving with a value already set, and by the panel's own live
  // "Use in post" while composing (the only caller that also passes a
  // content/platforms override, from its own generated summary).
  const applyVisual = ({ data, template, theme = "midnight" }, content, platformsArg) => {
    setAssets(visualToAssets(data, template, theme));
    setFormat(data?.slides ? "carousel" : "single");
    setContent((c) => content || c || summaryOf(data, template));
    if (platformsArg) setPlatforms(platformsArg);
  };

  // The Source and Batch panels both resolve to "here's a caption, maybe a
  // platform to go with it" — apply it to the post currently open and drop
  // back to the plain topic view so the result is immediately visible.
  const applyDraft = ({ content, platform }) => {
    setContent(content);
    if (platform) setPlatforms([platform]);
    setStartMode("topic");
    toast.success("Applied to this post");
  };

  // Keep the format legal for whatever platform is selected first — an
  // Instagram carousel doesn't mean anything once you switch to X.
  useEffect(() => {
    if (!pspec.formats.includes(format)) setFormat(pspec.default_format);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primary]);

  useEffect(() => { if (active > assets.length - 1) setActive(Math.max(0, assets.length - 1)); }, [assets, active]);
  useEffect(() => { setSelectedElementId(null); }, [active]);

  // ---- undo / redo over the visual deck ----
  // Every `assets` change (a slide edit, a dragged element, a new slide) is a
  // history point. Rapid-fire changes — typing in a text field, dragging a
  // handle — land within the same ~500ms window and coalesce into one undo
  // step instead of one per keystroke/pixel, which is what "undo" actually
  // means to someone using it.
  const historyRef = useRef({ past: [], future: [], last: 0 });
  const prevAssetsRef = useRef(assets);
  const skipHistoryRef = useRef(false);
  // Bumped whenever past/future changes, purely so the undo/redo buttons'
  // disabled state re-renders — the stack itself lives in a ref so pushing
  // to it on every keystroke doesn't itself trigger a render.
  const [historyTick, setHistoryTick] = useState(0);
  useEffect(() => {
    if (skipHistoryRef.current) { skipHistoryRef.current = false; prevAssetsRef.current = assets; return; }
    const h = historyRef.current;
    const now = Date.now();
    if (!(now - h.last < 500 && h.past.length)) {
      h.past.push(prevAssetsRef.current);
      if (h.past.length > 60) h.past.shift();
      h.future = [];
    }
    h.last = now;
    prevAssetsRef.current = assets;
    setHistoryTick((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets]);
  const undo = () => {
    const h = historyRef.current;
    if (!h.past.length) return;
    const prev = h.past.pop();
    h.future.push(prevAssetsRef.current);
    skipHistoryRef.current = true;
    setAssets(prev);
  };
  const redo = () => {
    const h = historyRef.current;
    if (!h.future.length) return;
    const next = h.future.pop();
    h.past.push(prevAssetsRef.current);
    skipHistoryRef.current = true;
    setAssets(next);
  };
  const canUndo = historyTick >= 0 && historyRef.current.past.length > 0;
  const canRedo = historyTick >= 0 && historyRef.current.future.length > 0;
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return; // don't fight native field undo
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Voice/footage/music generate in the background after a reel's script
  // lands — closing or reloading the tab mid-build abandons whichever of
  // them hasn't landed yet (there's nothing server-side to resume it from),
  // silently: no error, the post just never gets its score. A warning here
  // is the cheapest real guard against that, short of making the fills
  // resumable jobs.
  const buildingInBackground = voiceSynthesizing || visualFilling || musicLoading;
  const buildingRef = useRef(buildingInBackground);
  buildingRef.current = buildingInBackground;
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (!buildingRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // A "design" intent's own apply (from the Library's Designs tab, not a
  // dropdown pick made here) adopts that design's native format once, so
  // it opens looking the way it was built. After that the format
  // and the design selection are independent — a design's layout is
  // percentages, so switching format just reflows it onto a different
  // aspect ratio instead of un-selecting it. Only an outright deletion of
  // the selected design clears the picker.
  useEffect(() => {
    if (customTemplatesLoading || !customTemplateId) return;
    const t = customTemplates.find((x) => x.id === customTemplateId);
    if (!t) { pendingTemplateSync.current = false; setCustomTemplateId(null); return; }
    if (pendingTemplateSync.current) {
      pendingTemplateSync.current = false;
      if (t.format !== format) setFormat(t.format);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customTemplateId, customTemplates, customTemplatesLoading]);

  const togglePlatform = (k) => setPlatforms((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  const generate = async (b) => {
    const useBrief = b || brief || content;
    if (!useBrief.trim()) { toast.error("Add a brief or some text first."); return; }
    setAiLoading(true);
    try {
      const { data } = await api.post("/ai/write", { brief: useBrief, platform: primary, tone: briefTone, model: model || defaultModel, brand_kit_id: brandKitId || undefined });
      setContent(data.content);
    } catch (e) { toast.error(apiErrorMessage(e, "AI write failed.")); } finally { setAiLoading(false); }
  };

  // Shared by "Build whole post" (the brief in the box) and the Idea
  // panel's per-idea Build (a topic that never touches the brief field) —
  // ideaIndex distinguishes which button shows the loading spinner.
  const buildFromTopic = async (topic, ideaIndex = null) => {
    if (!topic.trim()) { toast.error("Give it a topic or a brief first."); return; }
    if (ideaIndex !== null) setBuildingIdeaIndex(ideaIndex); else setBuilding(true);
    try {
      const { data } = await api.post("/ai/build-post", {
        topic, platform: primary, format, slides: pspec.slides?.default, model: model || defaultModel,
        custom_template_id: customTemplateId || undefined, brand_kit_id: brandKitId || undefined,
      });
      applyPlan({ ...data, platform: primary });
      toast.success(`Built a ${FORMAT_LABEL[data.format] || data.format} for ${pspec.label}.`);
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't build the post.")); }
    finally { if (ideaIndex !== null) setBuildingIdeaIndex(null); else setBuilding(false); }
  };
  const autoBuild = () => buildFromTopic(brief || content || title);

  const runCoach = async () => {
    if (!content.trim()) { toast.error("Write something first."); return; }
    setCoachLoading(true); setCoach(null);
    try {
      const { data } = await api.post("/ai/coach", { content, platform: primary, model: model || defaultModel });
      setCoach(data.data);
    } catch (e) { toast.error(apiErrorMessage(e, "Coach feedback failed.")); } finally { setCoachLoading(false); }
  };

  // Rewrites the draft already in the box into a chosen tone of voice —
  // distinct from the Batch page, which writes N fresh posts from a topic.
  const applyStyle = async () => {
    if (!content.trim()) { toast.error("Write something first, then apply a style to it."); return; }
    setRestyling(true);
    try {
      const { data } = await api.post("/ai/restyle", {
        content, template: styleTemplate, platform: primary, model: model || defaultModel,
        brand_kit_id: brandKitId || undefined,
      });
      setContent(data.content);
      const label = templates.find((t) => t.key === styleTemplate)?.label || styleTemplate;
      toast.success(`Restyled as ${label}`);
    } catch (e) { toast.error(apiErrorMessage(e, "Restyle failed.")); } finally { setRestyling(false); }
  };

  // Upload a PPTX/PDF/image straight from the Composer and turn it into a
  // saved design for the format currently selected, then select it —
  // mirrors Designs.jsx's converter without leaving this page.
  const convertFileToTemplate = async (file) => {
    if (!file) return;
    setTemplateUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const { data: up } = await api.post("/upload", body);
      const { data: tpl } = await api.post("/templates/from-file", { source_type: templateUploadType, source_url: up.url });
      await reloadCustomTemplates();
      if (tpl.format === format) setCustomTemplateId(tpl.id);
      toast.success(`Design saved${tpl.format === format ? " and selected" : ` (built for ${FORMAT_LABEL[tpl.format] || tpl.format} — switch format to use it)`}.`);
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't convert that file.")); }
    finally { setTemplateUploading(false); if (templateFileRef.current) templateFileRef.current.value = ""; }
  };

  // ---- slide editing ----
  const patchSlide = (i, patch) => setAssets((s) => s.map((a, idx) => (idx === i ? { ...a, spec: { ...a.spec, ...patch } } : a)));
  const setAllThemes = (theme) => setAssets((s) => s.map((a) => ({ ...a, spec: { ...a.spec, theme } })));
  // Decks with a cover are numbered from 0 (cover, then 1..N); a reel
  // storyboard has no cover, so its scenes are numbered from 1.
  const renumber = (list) => {
    const hasCover = list[0]?.spec?.template === "cover";
    return list.map((a, i) => ({
      ...a,
      spec: { ...a.spec, index: hasCover ? i : i + 1, total: list.length, coverCounts: hasCover },
    }));
  };

  const addSlide = () => setAssets((s) => {
    // Match whatever the deck is already themed as; a brand-new deck
    // defaults to the account's own brand kit (when one is actually saved)
    // rather than a generic theme the user never chose.
    const theme = s[0]?.spec?.theme || (brand?.id ? "brand" : "midnight");
    const next = renumber([...s, emptySlide(s.length, s.length + 1, theme)]);
    setActive(next.length - 1);
    return next;
  });
  const removeSlide = (i) => setAssets((s) => renumber(s.filter((_, idx) => idx !== i)));
  // A copy right after the original, elements re-keyed so dragging one
  // slide's element never shares an id with the slide it was cloned from.
  const duplicateSlide = (i) => setAssets((s) => {
    const src = s[i];
    if (!src) return s;
    const clone = {
      ...src,
      spec: {
        ...src.spec,
        elements: src.spec.elements?.map((el) => ({ ...el, id: `el_${Math.random().toString(36).slice(2, 9)}` })),
      },
    };
    const next = renumber([...s.slice(0, i + 1), clone, ...s.slice(i + 1)]);
    setActive(i + 1);
    return next;
  });
  const moveSlide = (i, dir) => setAssets((s) => {
    const j = i + dir;
    if (j < 0 || j >= s.length) return s;
    const next = [...s]; [next[i], next[j]] = [next[j], next[i]];
    setActive(j);
    return renumber(next);
  });

  // ---- freeform layout editing (drag/pinch/resize elements on a slide) ----
  // "Edit layout" is a one-way door per slide: once elements exists, it (not
  // heading/body/title) is the source of truth for that slide's content.
  const enterLayoutEdit = (i) => {
    const spec = assets[i].spec;
    const theme = themeFor(spec.theme, brand);
    const els = elementsFromSpec(spec, theme, brand);
    patchSlide(i, { elements: els });
    setSelectedElementId(els[0]?.id || null);
  };
  const resetSlideLayout = (i) => setAssets((s) => s.map((a, idx) => {
    if (idx !== i) return a;
    const { elements, bg_color, ...rest } = a.spec;
    return { ...a, spec: rest };
  }));
  const patchElement = (elId, patch) => setAssets((s) => s.map((a, idx) => (idx !== active ? a : {
    ...a, spec: { ...a.spec, elements: (a.spec.elements || []).map((el) => (el.id === elId ? { ...el, ...patch } : el)) },
  })));
  const addElementToSlide = (type) => {
    const theme = themeFor(activeAsset.spec.theme, brand);
    const el = newElement(type, theme, brand);
    patchSlide(active, { elements: [...(activeAsset.spec.elements || []), el] });
    setSelectedElementId(el.id);
  };
  const removeElement = (elId) => {
    patchSlide(active, { elements: (activeAsset.spec.elements || []).filter((el) => el.id !== elId) });
    setSelectedElementId(null);
  };
  const duplicateElement = (elId) => {
    const el = (activeAsset.spec.elements || []).find((x) => x.id === elId);
    if (!el) return;
    const copy = { ...el, id: `el_${Math.random().toString(36).slice(2, 9)}`, x: clampPos(el.x + 4, el.w), y: clampPos(el.y + 4, el.h) };
    patchSlide(active, { elements: [...activeAsset.spec.elements, copy] });
    setSelectedElementId(copy.id);
  };
  // Paint order = array order, so the front of the array is the back layer.
  const reorderElement = (elId, dir) => {
    const els = activeAsset.spec.elements || [];
    const i = els.findIndex((x) => x.id === elId);
    const j = dir === "front" ? els.length - 1 : 0;
    if (i < 0 || i === j) return;
    const next = els.filter((x) => x.id !== elId);
    next.splice(j, 0, els[i]);
    patchSlide(active, { elements: next });
  };
  // Copies one element (a watermark, a badge, a logo) onto every other
  // slide — slides not yet in layout-edit mode are converted first, so
  // "apply to all" always means all, not just the ones already customized.
  const applyElementToAllSlides = (elId) => {
    const src = (activeAsset.spec.elements || []).find((x) => x.id === elId);
    if (!src) return;
    setAssets((s) => s.map((a, idx) => {
      if (idx === active) return a;
      const theme = themeFor(a.spec.theme, brand);
      const baseElements = a.spec.elements || elementsFromSpec(a.spec, theme, brand);
      const copy = { ...src, id: `el_${Math.random().toString(36).slice(2, 9)}` };
      return { ...a, spec: { ...a.spec, elements: [...baseElements, copy] } };
    }));
    toast.success(`Added to all ${assets.length} slides`);
  };
  // The reverse direction of the library: a one-off text/shape/image you
  // built on a slide, kept for every future post. Position, id and rotation
  // don't travel — they'd only ever be wrong on whatever slide it lands on
  // next — everything else about the element (its styling) does.
  const saveElementToLibrary = async (elId) => {
    const el = (activeAsset.spec.elements || []).find((x) => x.id === elId);
    if (!el) return;
    const { id, x, y, rotation, ...styling } = el;
    const kind = el.type === "image" ? "upload" : "element";
    const name = el.type === "text" ? (el.text || "Text").slice(0, 40)
      : el.type === "shape" ? `${el.shape || "rect"} shape`
      : "Image";
    try {
      await api.post("/library/elements", { name, kind, element: styling });
      toast.success("Saved to your library");
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't save to library.")); }
  };
  // A shape/icon/sticker preset from the library, or one of the user's own
  // saved uploads — either way it arrives as a ready-made element definition
  // (everything but id/x/y/rotation/opacity) and just needs to land on the
  // canvas.
  const addLibraryElement = (def) => {
    if (libraryTarget === "clip" && (def?.type === "video" || def?.type === "image") && def.url) {
      setClipSource(def.url, "", def.type);
      setLibraryOpen(false);
      setLibraryTarget(null);
      return;
    }
    const el = { id: `el_${Math.random().toString(36).slice(2, 9)}`, x: 25, y: 35, rotation: 0, opacity: 1, ...def };
    patchSlide(active, { elements: [...(activeAsset.spec.elements || []), el] });
    setSelectedElementId(el.id);
    setLibraryOpen(false);
  };

  // Saves the deck currently open here as a NEW reusable template — the
  // outline plus, for any slide that's been customized, its actual freeform
  // layout and background color — so "build whole post" can start from it
  // next time instead of from a blank AI guess.
  //
  // Once a slide has elements, enterLayoutEdit's own comment states the
  // rule: elements, not heading/body/title, are the source of truth for
  // that slide's content. spec.heading/spec.body are only ever written when
  // a slide is first generated or materialized from a template — editing a
  // role-tagged title/body element on the canvas (patchElement) updates just
  // the element, so those two fields go stale the moment that happens. The
  // backend's outline (what a template's dynamic slots get refilled with,
  // see _abstract_composer_outline) is built from heading/body alone, so
  // sending the stale ones back here is exactly how an edited headline
  // "reverts" the next time the template is reopened — this reads the
  // element's own text first and only falls back when there's no element to
  // ask, so an edit made straight on the canvas is never silently dropped.
  const templateSlidesPayload = () => assets.map((a) => {
    const els = a.spec.elements;
    const textOf = (roles) => els?.find((el) => el.type === "text" && roles.includes(el.role))?.text;
    const heading = textOf(["title", "heading"]);
    const body = textOf(["body"]);
    return {
      template: a.spec.template,
      heading: heading !== undefined ? heading : a.spec.heading,
      title: a.spec.title,
      body: body !== undefined ? body : a.spec.body,
      elements: els, bg_color: a.spec.bg_color,
      // A reel scene's stock/uploaded clip — separate from `elements`
      // because VideoClipEditor renders for every scene whether or not it's
      // ever entered freeform layout edit, so a clip needs to reach the
      // template even when there's nothing else customized to send.
      clip: a.spec.clip, video_url: a.spec.video_url,
    };
  });

  const saveAsTemplate = async () => {
    if (assets.length === 0) { toast.error("Nothing to save yet — add a slide first."); return; }
    const name = window.prompt("Name this design", editingTemplateName || (title !== "Untitled post" ? title : ""));
    if (!name || !name.trim()) return;
    setSavingTemplate(true);
    try {
      await api.post("/templates/from-composer", {
        name: name.trim(), format, theme: activeAsset?.spec?.theme || "midnight", slides: templateSlidesPayload(),
      });
      await reloadCustomTemplates();
      toast.success(`Saved "${name.trim()}" as a design`);
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't save design.")); } finally { setSavingTemplate(false); }
  };

  // Overwrites the template currently being edited in place — the edit
  // counterpart to saveAsTemplate's create. Colors, fonts, layout and slide
  // count are all whatever the deck below currently looks like.
  const saveTemplateChanges = async () => {
    if (!editingTemplateId) return;
    if (assets.length === 0) { toast.error("A design needs at least one slide."); return; }
    setSavingTemplateEdit(true);
    try {
      await api.put(`/templates/custom/${editingTemplateId}`, {
        name: editingTemplateName.trim() || undefined, format,
        theme: activeAsset?.spec?.theme || "midnight", slides: templateSlidesPayload(),
      });
      await reloadCustomTemplates();
      toast.success("Design updated");
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't save changes.")); } finally { setSavingTemplateEdit(false); }
  };

  const stopEditingTemplate = () => {
    setEditingTemplateId(null);
    templateEditLoaded.current = false;
    setAssets([]);
    setActive(0);
  };

  // A slide's image_prompt is generated art, not a stock lookup — render it and
  // hang the resulting URL on the slide so the card composites it as a backdrop.
  const renderSlideImage = async (i) => {
    const spec = assets[i]?.spec || {};
    const prompt = spec.image_prompt || spec.heading || spec.title;
    if (!prompt) { toast.error("This slide has no image prompt yet."); return; }
    setRenderingSlide(i);
    try {
      const { data } = await api.post("/ai/generate", {
        kind: "image", prompt,
        options: { model: "gpt-image-2.5-sunburst", size: aspect === "9:16" ? "9:16" : aspect === "4:5" ? "4:5" : "1:1", use_brand: true },
      });
      const result = await pollTask(data.task_id);
      const url = (result.files || []).find((f) => f.file_url)?.file_url;
      if (!url) throw new Error("No image came back");
      patchSlide(i, { image_url: url });
      toast.success("Slide image added");
    } catch (e) { toast.error(apiErrorMessage(e, "Image generation failed.")); } finally { setRenderingSlide(null); }
  };

  // ---- reel clip editing ----
  // A scene's footage and how it's cut — footage that can be a still just as
  // well as a video (clip.kind), sharing the same opacity/fit/effects/
  // transition controls either way. video_url stays the source of truth for
  // "is there a clip here" (everything else already reads it, that name
  // predating stills) regardless of what kind of media it actually holds;
  // `clip` carries the edit on top of it.
  const patchClip = (patch) => {
    const next = normalizeClip({ ...activeAsset.spec.clip, ...patch });
    patchSlide(active, { clip: next, video_url: next.url });
  };
  const setClipSource = (url, credit = "", kind = "video") => {
    // New footage means the old trim points are meaningless — they referred
    // to a different film. Length keeps whatever was pinned by hand.
    const prev = normalizeClip(activeAsset.spec.clip);
    patchSlide(active, {
      clip: normalizeClip({ ...prev, url, credit, kind, natural: null, start: 0, end: null }),
      video_url: url, video_credit: credit, image_url: "",
    });
  };
  const clearClip = () => patchSlide(active, { clip: normalizeClip({ ...activeAsset.spec.clip, url: "" }), video_url: "" });
  const uploadClipMedia = async (file) => {
    setClipUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data: up } = await api.post("/upload", form);
      if (up.kind !== "video" && up.kind !== "image") { toast.error("That file isn't a video or a photo."); return; }
      setClipSource(up.url, "", up.kind);
      toast.success(up.kind === "image" ? "Photo added" : "Clip added");
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't upload that.")); }
    finally { setClipUploading(false); }
  };

  // One handler for every place the stock picker can be opened from — which
  // field it fills depends on which target requested it.
  const onStockPick = (item) => {
    if (stockTarget === "clip-video") setClipSource(item.url, item.credit, item.type);
    else if (stockTarget === "slide-video") patchSlide(active, { video_url: item.url, video_credit: item.credit, image_url: "" });
    else if (stockTarget === "slide-image") patchSlide(active, { image_url: item.url, image_credit: item.credit, video_url: "" });
    else if (stockTarget === "media") { setMediaUrl(item.url); setMediaType(item.type); }
    else if (stockTarget === "element-new") {
      const theme = themeFor(activeAsset.spec.theme, brand);
      // The stock picker lets you switch to video mid-search (see
      // MediaPicker's own type toggle), so the element this creates has to
      // match whatever was actually picked — hardcoding "image" meant a
      // picked clip landed as an <img> element pointed at an .mp4, which
      // never renders anything.
      const type = item.type === "video" ? "video" : "image";
      const el = { ...newElement(type, theme, brand), url: item.url, w: 40, h: 40 };
      patchSlide(active, { elements: [...(activeAsset.spec.elements || []), el] });
      setSelectedElementId(el.id);
    } else if (stockTarget === "element-replace" && selectedElementId) {
      // Same reasoning as element-new: replacing an image element's source
      // with a picked video (or the reverse) has to retype the element too,
      // or the new media renders through the wrong tag.
      patchElement(selectedElementId, { url: item.url, type: item.type === "video" ? "video" : "image" });
    }
    toast.success(item.credit ? `Added — photo by ${item.credit}` : "Added");
  };

  const downloadSlide = async () => {
    if (!cardRef.current) return;
    try {
      const url = await toPng(cardRef.current, { pixelRatio: 2, cacheBust: true });
      const a = document.createElement("a");
      a.href = url; a.download = `${(title || "post").replace(/\W+/g, "-").toLowerCase()}-${active + 1}.png`; a.click();
      toast.success("Downloaded PNG");
    } catch (e) { toast.error(apiErrorMessage(e, "Export failed.")); }
  };

  // Every slide, one at a time onto the same card ref used for a single
  // download, zipped together — the only way to get a whole carousel or
  // reel storyboard out of the browser as files.
  const [downloadingAll, setDownloadingAll] = useState(false);
  const downloadAllSlides = async () => {
    if (assets.length < 2) return;
    const startedOn = active;
    setDownloadingAll(true);
    try {
      const zip = new JSZip();
      for (let i = 0; i < assets.length; i++) {
        setActive(i);
        await new Promise((r) => setTimeout(r, 260)); // let the card re-render for slide i
        if (!cardRef.current) continue;
        const dataUrl = await toPng(cardRef.current, { pixelRatio: 2, cacheBust: true });
        zip.file(`slide-${String(i + 1).padStart(2, "0")}.png`, dataUrl.split(",")[1], { base64: true });
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${(title || "post").replace(/\W+/g, "-").toLowerCase()}-slides.zip`; a.click();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded all ${assets.length} slides as a zip`);
    } catch (e) { toast.error(apiErrorMessage(e, "Export failed.")); }
    finally { setActive(startedOn); setDownloadingAll(false); }
  };

  const buildPayload = (status) => ({
    title: title || (content ? content.slice(0, 40) : "Untitled post"),
    content, platforms, status, format, assets, hashtags, alt_text: altText,
    // Only platforms someone actually customized are stored — everyone
    // else falls back to `content`, so a single-platform post (the common
    // case) round-trips with an empty object, exactly as before this existed.
    content_by_platform: Object.fromEntries(
      Object.entries(contentByPlatform).filter(([k, v]) => platforms.includes(k) && v.trim())
    ),
    media_urls: mediaUrl ? [mediaUrl] : [],
    media_type: mediaType || null,
    music,
    brand_kit_id: brandKitId || null,
    scheduled_time: status === "scheduled" && scheduleAt ? new Date(scheduleAt).toISOString() : null,
  });

  const persist = async (status) => {
    if (!content.trim() && assets.length === 0) { toast.error("Nothing to save yet."); return; }
    if (status === "scheduled" && !scheduleAt) { toast.error("Pick a date & time to schedule."); return; }
    setSaving(true);
    try {
      const payload = buildPayload(status);
      const res = postId ? await api.put(`/posts/${postId}`, payload) : await api.post("/posts", payload);
      setPostId(res.data.id);
      toast.success(status === "scheduled" ? "Post scheduled" : status === "published" ? "Marked as published" : "Draft saved");
      if (status !== "draft") navigate("/calendar");
    } catch (e) { toast.error(apiErrorMessage(e, "Save failed.")); } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!postId) { navigate("/"); return; }
    if (!window.confirm(`Delete "${title || "this post"}"? This can't be undone.`)) return;
    await api.delete(`/posts/${postId}`); toast.success("Deleted"); navigate("/");
  };

  const fullText = useMemo(
    () => [content, hashtags.join(" ")].filter(Boolean).join("\n\n"),
    [content, hashtags]
  );
  const previews = useMemo(() => (platforms.length ? platforms : ["instagram"]), [platforms]);
  const overLimit = fullText.length > (pspec.char_limit || 99999);
  const activeAsset = assets[active];

  // Ctrl/Cmd+V with an image on the clipboard (copied from another app, a
  // browser, a screenshot tool) drops it straight onto the active slide —
  // replacing the selected image element if there is one, otherwise landing
  // as a brand-new element. A paste that carries no image (plain text into
  // any of the composer's own fields) is left completely alone: we only
  // ever preventDefault once an actual image is found.
  useEffect(() => {
    const onPaste = async (e) => {
      if (!activeAsset || document.querySelector('[role="dialog"]')) return;
      const item = Array.from(e.clipboardData?.items || []).find((it) => it.kind === "file" && it.type.startsWith("image/"));
      if (!item) return;
      const file = item.getAsFile();
      if (!file) return;
      e.preventDefault();
      try {
        const form = new FormData();
        form.append("file", file);
        const { data: up } = await api.post("/upload", form);
        const selected = (activeAsset.spec.elements || []).find((x) => x.id === selectedElementId);
        if (selected?.type === "image") {
          patchElement(selected.id, { url: up.url });
          toast.success("Pasted into the selected image");
          return;
        }
        const theme = themeFor(activeAsset.spec.theme, brand);
        const el = { ...newElement("image", theme, brand), url: up.url };
        patchSlide(active, { elements: [...(activeAsset.spec.elements || []), el] });
        setSelectedElementId(el.id);
        toast.success("Pasted image onto the slide");
      } catch (err) { toast.error(apiErrorMessage(err, "Couldn't paste that image.")); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAsset, selectedElementId, active, brand]);

  return (
    <div data-testid="composer-page">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">Composer</div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Craft & schedule</h1>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" onClick={() => openHistory()} data-testid="composer-history"
            className="gap-2 text-zinc-500 hover:text-lime"><History size={16} /><span className="hidden sm:inline">History</span></Button>
          {postId && (
            <Button variant="ghost" onClick={remove} className="gap-2 text-zinc-500 hover:text-magic" data-testid="composer-delete">
              <Trash2 size={16} />
            </Button>
          )}
        </div>
      </div>

      {editingTemplateId && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-lime/30 bg-lime/5 p-4" data-testid="composer-editing-template-banner">
          <LayoutTemplate size={16} className="flex-none text-lime" />
          <div className="flex-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-lime">Editing design</div>
            <input value={editingTemplateName} onChange={(e) => setEditingTemplateName(e.target.value)}
              data-testid="composer-editing-template-name"
              className="mt-1 w-full max-w-xs rounded-lg border border-white/10 bg-[#0A0A0A] px-2.5 py-1.5 text-sm text-white outline-none focus:border-lime" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={saveTemplateChanges} disabled={savingTemplateEdit} data-testid="composer-save-template-changes"
              className="h-8 gap-1.5 rounded-lg bg-lime px-3 text-xs font-semibold text-[#0A0A0A] hover:bg-lime-hover">
              {savingTemplateEdit ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save changes
            </Button>
            <Button variant="secondary" onClick={saveAsTemplate} disabled={savingTemplate} data-testid="composer-save-template-as-new"
              className="h-8 gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-white hover:bg-white/10">
              {savingTemplate ? <Loader2 size={13} className="animate-spin" /> : <BookmarkPlus size={13} />} Save as new
            </Button>
            <Button variant="ghost" onClick={stopEditingTemplate} data-testid="composer-stop-editing-template"
              className="h-8 px-2.5 text-xs text-zinc-400 hover:text-white">Done</Button>
          </div>
        </div>
      )}

      {/* Platform + format: everything below adapts to these two */}
      <div className="mt-7 rounded-xl border border-white/10 bg-[#121212] p-5">
        <label className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Publish to</label>
        <div className="mt-3 flex flex-wrap gap-2">
          {PLATFORM_LIST.map((p) => {
            const on = platforms.includes(p.key); const I = p.icon;
            return (
              <button key={p.key} onClick={() => togglePlatform(p.key)} data-testid={`composer-platform-${p.key}`}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${on ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
                <I size={13} /> {p.name}
              </button>
            );
          })}
        </div>

        {/* Posting to more than one platform at once means one caption is
            usually wrong for at least one of them — a 2200-char Instagram
            caption saved verbatim as an X post, say. Unset platforms keep
            using the caption above; nothing changes for a single-platform post. */}
        {platforms.length > 1 && (
          <div className="mt-4 rounded-lg border border-white/10 bg-[#0A0A0A] p-3" data-testid="composer-per-platform">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">Per-platform caption</span>
              <span className="text-[10px] text-zinc-600">Unset platforms use the caption below</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {platforms.map((key) => {
                const p = platformOf(key);
                const s = specFor(specs, key);
                const Icon = p.icon;
                const custom = contentByPlatform[key]?.trim();
                const text = custom || content;
                const over = text.length > (s.char_limit || 99999);
                return (
                  <button key={key} onClick={() => setPlatformTab(platformTab === key ? null : key)}
                    data-testid={`composer-platform-tab-${key}`}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${platformTab === key ? "border-iris bg-iris/10 text-iris" : over ? "border-magic/40 text-magic" : "border-white/10 text-zinc-400 hover:text-white"}`}>
                    <Icon size={11} /> {p.name}
                    {!!custom && <span className="h-1 w-1 rounded-full bg-current" />}
                  </button>
                );
              })}
            </div>
            {platformTab && platforms.includes(platformTab) && (() => {
              const s = specFor(specs, platformTab);
              const value = contentByPlatform[platformTab] ?? "";
              const effective = value.trim() ? value : content;
              const over = effective.length > (s.char_limit || 99999);
              return (
                <div className="mt-2">
                  <textarea value={value} onChange={(e) => setContentByPlatform((c) => ({ ...c, [platformTab]: e.target.value }))}
                    rows={4} data-testid="composer-platform-caption"
                    placeholder={`Same as the caption below — type here to write a ${platformOf(platformTab).name}-only version`}
                    className="w-full resize-none rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-sm leading-relaxed text-white outline-none focus:border-iris placeholder:text-zinc-600" />
                  <div className="mt-1 flex items-center justify-between text-[10px]">
                    <span className={over ? "text-magic" : "text-zinc-600"} data-testid="composer-platform-caption-count">
                      {effective.length} / {s.char_limit} for {platformOf(platformTab).name}
                    </span>
                    {!!value.trim() && (
                      <button onClick={() => setContentByPlatform((c) => { const n = { ...c }; delete n[platformTab]; return n; })}
                        data-testid="composer-platform-caption-clear" className="text-zinc-600 hover:text-white">
                        Use default caption
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        <label className="mt-5 block font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">
          Format · {pspec.label} · {aspect}
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          {(pspec.formats || []).map((f) => (
            <button key={f} onClick={() => setFormat(f)} data-testid={`composer-format-${f}`}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${format === f ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
              {f === "reel" ? <Film size={13} /> : f === "carousel" ? <Layers size={13} /> : <Sparkles size={13} />}
              {FORMAT_LABEL[f] || f}
            </button>
          ))}
        </div>

        {brandKits.length > 0 && (
          <>
            <label className="mt-5 block font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Brand kit</label>
            <div className="mt-3 flex items-center gap-2">
              <Palette size={14} className="flex-shrink-0 text-zinc-600" />
              <select value={brandKitId || ""} onChange={(e) => setBrandKitId(e.target.value || null)} data-testid="composer-brand-kit-select"
                className="w-full max-w-xs rounded-lg border border-white/10 bg-[#0A0A0A] px-2.5 py-1.5 text-xs text-white outline-none focus:border-lime [color-scheme:dark]">
                {brandKits.map((k) => <option key={k.id || "default"} value={k.id || ""}>{k.name}{k.is_default ? " (default)" : ""}</option>)}
              </select>
              <span className="text-xs text-zinc-600">colors, fonts &amp; voice for this post</span>
            </div>
          </>
        )}
      </div>

      {/* The right column is a fixed 460px, so anything narrower than xl
          (1280px) leaves the left column too little room for its own
          canvas+controls split below — landscape tablets (iPad at ~1024-1194
          CSS px) sit right in that gap. Below xl the whole page stays one
          column instead of compounding two responsive splits into an
          unreadably narrow one. */}
      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_minmax(0,460px)]">
        {/* Editor */}
        <div className="min-w-0 space-y-5">
          <div className="rounded-xl border border-white/10 bg-[#121212] p-5">
            <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="composer-title"
              className="w-full bg-transparent font-display text-lg font-semibold text-white outline-none placeholder:text-zinc-600" placeholder="Post title" />
            <div className="my-4 h-px bg-white/10" />
            <textarea data-testid="composer-content" value={content} onChange={(e) => setContent(e.target.value)} rows={8}
              placeholder="Write your post, or generate the whole thing from a topic…"
              className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-600" />
            <div className="mt-1 text-right font-mono text-[10px] text-zinc-600">
              <span className={overLimit ? "text-magic" : ""}>{fullText.length}</span> / {pspec.char_limit}
            </div>

            <HashtagBar hashtags={hashtags} setHashtags={setHashtags} max={pspec.hashtags} />

            <label className="mt-4 block">
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">
                Alt text <span className="normal-case tracking-normal text-zinc-700">(screen readers &amp; accessibility)</span>
              </span>
              <input value={altText} onChange={(e) => setAltText(e.target.value)} data-testid="composer-alt-text"
                placeholder="Describe the visual for someone who can't see it…"
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm text-white outline-none focus:border-iris placeholder:text-zinc-600" />
            </label>

            {/* Four ways to start (or add to) this post — Topic is the
                default and stays visible even when the deck below already
                has content, since "Build whole post"/"Caption only"/Coach
                all act on the draft in progress, not just an empty one. The
                other three each resolve to a result you pick, then drop
                back to Topic so it's visible immediately below. */}
            <div className="mt-4 flex flex-wrap gap-1.5 border-t border-white/5 pt-4">
              {START_MODES.map((m) => {
                const Icon = m.icon; const on = startMode === m.key;
                return (
                  <button key={m.key} onClick={() => setStartMode(m.key)} data-testid={`composer-start-${m.key}`}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${on ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
                    <Icon size={13} /> {m.label}
                  </button>
                );
              })}
            </div>

            {startMode === "topic" && (
              <div className="mt-3">
                <ComposerIdeaPanel model={model || defaultModel} buildingIndex={buildingIdeaIndex}
                  onUseIdea={(idea) => setBrief(idea)} onBuildIdea={(idea, i) => buildFromTopic(idea, i)} />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Topic or brief…"
                    data-testid="composer-brief"
                    className="min-w-[180px] flex-1 rounded-lg border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm outline-none focus:border-iris" />
                  <ModelPicker value={model || defaultModel} onChange={setModel} models={models} testid="composer-model" className="w-auto min-w-[160px] flex-none" />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">Tone</span>
                  {["engaging", "professional", "witty", "bold", "inspirational"].map((t) => (
                    <button key={t} onClick={() => setBriefTone(t)} data-testid={`composer-tone-${t}`}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${briefTone === t ? "border-iris bg-iris/10 text-iris" : "border-white/10 text-zinc-400 hover:text-white"}`}>{t}</button>
                  ))}
                </div>
                {isReel && (
                  <VoicePresetPicker value={voicePreset} onChange={setVoicePreset} idPrefix="composer-voice-preset-pre" />
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button onClick={autoBuild} disabled={building} data-testid="composer-autobuild"
                    className="gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover">
                    {building ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Build whole post
                  </Button>
                  <Button variant="secondary" onClick={() => generate()} disabled={aiLoading} data-testid="composer-ai-write"
                    className="gap-2 rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10">
                    {aiLoading ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />} Caption only
                  </Button>
                  <Button variant="secondary" onClick={runCoach} disabled={coachLoading} data-testid="composer-coach"
                    className="gap-2 rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10">
                    {coachLoading ? <Loader2 size={16} className="animate-spin" /> : <GraduationCap size={16} />} Coach
                  </Button>
                </div>
              </div>
            )}
            {startMode === "source" && (
              <div className="mt-3 rounded-lg border border-white/10 bg-[#0A0A0A] p-4">
                <ComposerFromSource onApply={applyDraft} />
              </div>
            )}
            {startMode === "visual" && (
              <div className="mt-3 rounded-lg border border-white/10 bg-[#0A0A0A] p-4">
                <ComposerVisualPanel onApply={(v) => { applyVisual(v.visual, v.content, v.platforms); setStartMode("topic"); toast.success("Applied to this post"); }} />
              </div>
            )}
            {startMode === "batch" && (
              <div className="mt-3 rounded-lg border border-white/10 bg-[#0A0A0A] p-4">
                <ComposerBatchPanel onApply={applyDraft} />
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
              {/* "Style", not "Tone": these are copy structures (hook stack,
                  story, listicle, contrarian, how-to), and the actual tone
                  picker — engaging/professional/witty — sits in Topic mode
                  40 lines above, visible at the same time. Two controls
                  can't both be called Tone. Matches this row's own "Apply
                  style" button and testids. */}
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">Style</span>
              <select value={styleTemplate} onChange={(e) => setStyleTemplate(e.target.value)} data-testid="composer-style-select"
                className="rounded-lg border border-white/10 bg-[#0A0A0A] px-2.5 py-1.5 text-xs text-white outline-none focus:border-iris [color-scheme:dark]">
                {templates.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <Button variant="secondary" onClick={applyStyle} disabled={restyling} data-testid="composer-apply-style"
                className="h-8 gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-white hover:bg-white/10">
                {restyling ? <Loader2 size={13} className="animate-spin" /> : <Wand size={13} />} Apply style
              </Button>
              <span className="text-xs text-zinc-600">rewrites the draft above in that structure</span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">Design</span>
              <select value={customTemplateId || ""} onChange={(e) => setCustomTemplateId(e.target.value || null)}
                data-testid="composer-custom-template-select"
                className="rounded-lg border border-white/10 bg-[#0A0A0A] px-2.5 py-1.5 text-xs text-white outline-none focus:border-iris [color-scheme:dark]">
                <option value="">No design — AI picks the format</option>
                {sortedCustomTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}{t.format !== format ? ` (${FORMAT_LABEL[t.format] || t.format} — will resize)` : ""}
                  </option>
                ))}
              </select>
              {customTemplates.length === 0 && (
                <span className="text-xs text-zinc-600">No saved designs yet —</span>
              )}
              <input ref={templateFileRef} type="file"
                accept={templateUploadType === "pptx" ? ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" : templateUploadType === "pdf" ? ".pdf,application/pdf" : "image/*"}
                className="hidden" data-testid="composer-template-upload-input" onChange={(e) => convertFileToTemplate(e.target.files?.[0])} />
              <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-[#0A0A0A] p-0.5">
                {[{ k: "pptx", I: Presentation }, { k: "pdf", I: FileText }, { k: "image", I: ImageIcon }].map(({ k, I }) => (
                  <button key={k} onClick={() => setTemplateUploadType(k)} data-testid={`composer-template-upload-type-${k}`} title={k}
                    className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${templateUploadType === k ? "bg-lime/10 text-lime" : "text-zinc-500 hover:text-white"}`}>
                    <I size={12} />
                  </button>
                ))}
              </div>
              <Button variant="secondary" onClick={() => templateFileRef.current?.click()} disabled={templateUploading} data-testid="composer-template-upload"
                className="h-7 gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs text-white hover:bg-white/10">
                {templateUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Upload design
              </Button>
            </div>

            {coach && <CoachPanel coach={coach} onUseHook={(h) => setContent(h + "\n\n" + content)} />}
          </div>

          {/* Visual block */}
          <div className="rounded-xl border border-white/10 bg-[#121212] p-3 sm:p-5" data-testid="composer-visuals">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">
                {format === "reel" ? "Storyboard" : format === "carousel" ? "Slides" : "Visual"}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1">
                  <IconBtn onClick={undo} disabled={!canUndo} testid="composer-undo" title="Undo (Ctrl+Z)"><Undo2 size={13} /></IconBtn>
                  <IconBtn onClick={redo} disabled={!canRedo} testid="composer-redo" title="Redo (Ctrl+Shift+Z)"><Redo2 size={13} /></IconBtn>
                </div>
                {assets.length > 0 && !editingTemplateId && (
                  <Button variant="ghost" onClick={saveAsTemplate} disabled={savingTemplate} data-testid="composer-save-template"
                    className="h-7 gap-1.5 px-2 text-xs text-zinc-400 hover:text-white">
                    {savingTemplate ? <Loader2 size={12} className="animate-spin" /> : <BookmarkPlus size={12} />} Save as design
                  </Button>
                )}
                <div className="flex items-center gap-1.5">
                  {THEME_LIST.concat([{ key: "brand", label: brand.name || "Brand", bg: activeColors(brand).bg }]).map((th) => (
                    <button key={th.key} onClick={() => setAllThemes(th.key)} title={th.label}
                      data-testid={`composer-theme-${th.key}`}
                      className={`h-6 w-6 rounded-full border transition-transform hover:scale-110 ${activeAsset?.spec?.theme === th.key ? "border-lime" : "border-white/20"}`}
                      style={{ background: th.bg }} />
                  ))}
                </div>
              </div>
            </div>

            {/* One combined strip for the three things that build in the
                background after a reel's script lands, instead of three
                separate alert boxes stacking up — each still keeps its own
                testid/spinner so a caller can watch just the one it cares
                about, but a glance here now shows the whole build at once,
                errors included instead of only a toast that's already gone. */}
            {isReel && (voiceSynthesizing || visualFilling || musicLoading || anyVoiceError || anyVisualError || (musicError && !music.url)) && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-300"
                data-testid="composer-autofill-status">
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">Building the reel</span>
                {voiceSynthesizing ? (
                  <span className="flex items-center gap-1.5 text-iris" data-testid="composer-voice-synthesizing">
                    <Loader2 size={13} className="animate-spin" /> Voice
                  </span>
                ) : anyVoiceError ? (
                  <span className="flex items-center gap-1.5 text-magic"><RefreshCw size={12} /> Voice — a scene's take failed, retry it below</span>
                ) : null}
                {visualFilling ? (
                  <span className="flex items-center gap-1.5 text-lime" data-testid="composer-visual-filling">
                    <Loader2 size={13} className="animate-spin" /> Footage
                  </span>
                ) : anyVisualError ? (
                  <span className="flex items-center gap-1.5 text-magic"><RefreshCw size={12} /> Footage — a scene's search failed, retry it below</span>
                ) : null}
                {musicLoading ? (
                  <span className="flex items-center gap-1.5" data-testid="composer-music-generating">
                    <Loader2 size={13} className="animate-spin" /> Score
                  </span>
                ) : (musicError && !music.url) ? (
                  <>
                    <button onClick={() => synthesizeReelMusic(title || content)} data-testid="composer-music-retry"
                      title={musicErrorMessage} className="flex items-center gap-1.5 text-magic hover:text-white">
                      <RefreshCw size={12} /> Score failed — retry
                    </button>
                    {!!musicErrorMessage && (
                      <span className="basis-full font-mono text-[10px] text-magic/70" data-testid="composer-music-error">
                        {musicErrorMessage}
                      </span>
                    )}
                  </>
                ) : null}
              </div>
            )}

            {isReel && !!music.url && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2" data-testid="composer-music-row">
                <Music size={13} className="flex-none text-zinc-400" />
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">Music</span>
                <button onClick={() => setMusicVolume(music.volume > 0 ? 0 : DEFAULT_MUSIC_VOLUME)} data-testid="composer-music-mute"
                  title={music.volume > 0 ? "Mute" : "Unmute"} className="flex-none text-zinc-400 hover:text-white">
                  {music.volume > 0 ? <Volume2 size={14} /> : <VolumeX size={14} />}
                </button>
                <input type="range" min="0" max="1" step="0.02" value={music.volume ?? DEFAULT_MUSIC_VOLUME}
                  onChange={(e) => setMusicVolume(Number(e.target.value))} data-testid="composer-music-volume"
                  className="h-1.5 w-24 flex-none accent-lime" />
                <audio src={music.url} controls className="h-8 flex-1 min-w-[160px]" />
                <button onClick={() => synthesizeReelMusic(title || content)} data-testid="composer-music-regenerate"
                  title="Generate a different score" className="flex-none text-zinc-500 hover:text-white"><RefreshCw size={13} /></button>
                <Button variant="ghost" onClick={removeMusic} data-testid="composer-music-remove"
                  className="h-7 flex-none px-2 text-zinc-500 hover:text-magic"><Trash2 size={13} /></Button>
              </div>
            )}

            {isReel && assets.length > 0 && (
              <VoicePresetPicker value={voicePreset} onChange={setVoicePreset} idPrefix="composer-voice-preset" />
            )}

            {isReel && assets.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">View</span>
                {[{ k: "canvas", l: "Canvas", I: SquarePen }, { k: "play", l: "Play reel", I: PlayCircle }].map(({ k, l, I }) => (
                  <button key={k} onClick={() => setReelView(k)} data-testid={`composer-reel-view-${k}`}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      reelView === k ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"
                    }`}>
                    <I size={12} /> {l}
                  </button>
                ))}
                <span className="font-mono text-[10px] text-zinc-600" data-testid="composer-reel-duration">
                  {formatSeconds(reelTimeline(assets).total)} total
                </span>
                <Button variant="secondary" onClick={() => setExportOpen(true)} data-testid="composer-reel-export"
                  className="h-7 gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 text-[11px] text-white hover:bg-white/10">
                  <Film size={12} /> Export video
                </Button>
              </div>
            )}

            {/* Resize — right beside the deck, so fitting whatever's built
                (or a template pulled in at a different native size) to a
                different post type/format never means scrolling back up to
                the Format section above. Percentage layouts reflow onto the
                new aspect ratio immediately; nothing here regenerates content. */}
            {pspec.formats.length > 1 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">Size</span>
                {pspec.formats.map((f) => (
                  <button key={f} onClick={() => setFormat(f)} data-testid={`composer-visual-size-${f}`}
                    title={`${FORMAT_LABEL[f] || f} · ${aspectFor(specs, primary, f)}`}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${format === f ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
                    {FORMAT_LABEL[f] || f} · {aspectFor(specs, primary, f)}
                  </button>
                ))}
              </div>
            )}

            {assets.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-white/10 p-8 text-center">
                <p className="text-sm text-zinc-500">
                  No visual yet. <span className="text-zinc-300">Build whole post</span> generates {format === "reel" ? "a scene-by-scene storyboard" : format === "carousel" ? "a full slide deck" : "a graphic"} for {pspec.label}.
                </p>
                <Button variant="secondary" onClick={addSlide} data-testid="composer-add-first-slide"
                  className="mt-4 gap-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-white hover:bg-white/10">
                  <Plus size={14} /> Add one manually
                </Button>
              </div>
            ) : (
              <>
                {/* Slide strip */}
                <div className="mt-4 flex gap-2 overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden" data-testid="composer-slide-strip">
                  {assets.map((a, i) => (
                    <button key={i} onClick={() => setActive(i)} data-testid={`composer-slide-${i}`}
                      className={`relative flex-shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${active === i ? "border-lime" : "border-white/10"}`}
                      style={{ width: 68 }}>
                      <div className={`${aspectCls} w-full`}>
                        <VisualCard spec={a.spec} brand={brand} scale={0.155} />
                      </div>
                      <span className="absolute left-1 top-1 rounded bg-black/60 px-1 font-mono text-[9px] text-white">{i + 1}</span>
                    </button>
                  ))}
                  <button onClick={addSlide} data-testid="composer-add-slide"
                    className={`flex ${aspectCls} w-[68px] flex-shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-white/15 text-zinc-600 hover:border-lime/40 hover:text-lime`}>
                    <Plus size={16} />
                  </button>
                </div>

                {/* Selected slide editor — canvas and controls share one card
                    (side by side from md up, stacked canvas-first on phones)
                    instead of living in separate page columns, so dragging an
                    element and adjusting its properties happen inches apart. */}
                {activeAsset && (
                  <div className="mt-4 rounded-lg border border-white/10 bg-[#0A0A0A] p-2.5 sm:p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">
                        {activeAsset.type === "scene" ? `Scene ${active + 1}` : activeAsset.spec.template === "cover" ? "Cover slide" : `Slide ${active + 1}`}
                      </span>
                      <div className="flex gap-1">
                        <IconBtn onClick={() => setCanvasOpen(true)} testid="composer-open-canvas" title="Edit full screen"><Maximize2 size={14} /></IconBtn>
                        <IconBtn onClick={() => duplicateSlide(active)} testid="composer-slide-duplicate" title="Duplicate slide"><Copy size={14} /></IconBtn>
                        <IconBtn onClick={() => moveSlide(active, -1)} disabled={active === 0} testid="composer-slide-left"><ChevronLeft size={14} /></IconBtn>
                        <IconBtn onClick={() => moveSlide(active, 1)} disabled={active === assets.length - 1} testid="composer-slide-right"><ChevronRight size={14} /></IconBtn>
                        <IconBtn onClick={() => removeSlide(active)} testid="composer-slide-remove" danger><X size={14} /></IconBtn>
                      </div>
                    </div>

                    <div className="mt-4 md:grid md:grid-cols-[minmax(0,1fr)_minmax(230px,280px)] md:items-start md:gap-5">
                      {/* Canvas — the flexible track, so it grows into
                          whatever the column actually has, capped only by
                          how tall this aspect may get. Both tracks use
                          minmax(0, …) so neither can be forced wider than
                          the column by its own content (a flex `flex-1`
                          could, and silently stole clicks meant for the
                          right-hand platform-preview column). */}
                      <div className="mx-auto w-full md:mx-0" style={{ maxWidth: inlineCanvasMaxW }}>
                        {isReel && reelView === "play" ? (
                          <ReelPlayer assets={assets} brand={brand} aspectCls={aspectCls} music={music}
                            activeIndex={active} onSelectScene={(i) => { setActive(i); setSelectedElementId(null); }} />
                        ) : activeAsset.spec.elements ? (
                          <SlideEditor spec={activeAsset.spec} brand={brand} aspectCls={aspectCls} cardRef={canvasOpen ? null : cardRef}
                            selectedId={selectedElementId} onSelect={setSelectedElementId}
                            onChangeElement={patchElement} />
                        ) : (
                          <div ref={previewBoxRef} className={`${aspectCls} w-full overflow-hidden rounded-xl`}>
                            <div ref={canvasOpen ? null : cardRef} className="h-full w-full">
                              <VisualCard spec={activeAsset.spec} brand={brand} scale={previewScale} />
                            </div>
                          </div>
                        )}
                        {isDeck && (
                          <div className="mt-3 flex items-center justify-center gap-3">
                            <IconBtn onClick={() => setActive((i) => Math.max(0, i - 1))} disabled={active === 0} testid="composer-prev"><ChevronLeft size={15} /></IconBtn>
                            <span className="font-mono text-[11px] text-zinc-500">{active + 1}/{assets.length}</span>
                            <IconBtn onClick={() => setActive((i) => Math.min(assets.length - 1, i + 1))} disabled={active === assets.length - 1} testid="composer-next"><ChevronRight size={15} /></IconBtn>
                          </div>
                        )}
                        {activeAsset.spec.elements && (
                          <p className="mt-2 text-center text-[10px] text-zinc-600 md:text-left">Drag to move, the corner handle to resize, the top handle to rotate — or pinch on mobile.</p>
                        )}
                      </div>

                      {/* Controls */}
                      <div className="mt-4 min-w-0 md:mt-0">
                        {activeAsset.spec.elements ? (
                          <ElementPropertyPanel
                            elements={activeAsset.spec.elements} selectedId={selectedElementId}
                            onSelect={setSelectedElementId} onPatch={patchElement} onAdd={addElementToSlide}
                            onRemove={removeElement} onDuplicate={duplicateElement} onReorder={reorderElement}
                            onAddStock={() => setStockTarget("element-new")}
                            onBrowseStock={() => setStockTarget("element-replace")}
                            onApplyAll={applyElementToAllSlides} onOpenLibrary={() => setLibraryOpen(true)}
                            onSaveToLibrary={saveElementToLibrary}
                            canApplyAll={assets.length > 1}
                            brand={brand}
                            bgColor={activeAsset.spec.bg_color || themeFor(activeAsset.spec.theme, brand).bg}
                            onChangeBg={(hex) => patchSlide(active, { bg_color: hex })}
                          />
                        ) : activeAsset.spec.template === "cover" ? (
                          <SlideField label="Cover title" value={activeAsset.spec.title} testid="composer-slide-title"
                            onChange={(v) => patchSlide(active, { title: v })} />
                        ) : (
                          <>
                            <SlideField label={activeAsset.type === "scene" ? "On-screen text" : "Heading"} value={activeAsset.spec.heading}
                              testid="composer-slide-heading" onChange={(v) => patchSlide(active, { heading: v })} />
                            <SlideField label={activeAsset.type === "scene" ? "Voiceover" : "Body"} value={activeAsset.spec.body} rows={3}
                              testid="composer-slide-body" onChange={(v) => patchSlide(active, { body: v })} />
                            {activeAsset.type === "scene" && !!activeAsset.spec.body?.trim() && (
                              <div className="-mt-2 flex items-center gap-1.5 text-[11px] text-zinc-500">
                                {sceneVoiceLoading[active] ? (
                                  <span className="flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Recording take…</span>
                                ) : sceneVoiceError[active] ? (
                                  <button onClick={() => retrySceneVoice(active)} data-testid="composer-scene-voice-retry"
                                    className="flex items-center gap-1 text-magic hover:text-white"><RefreshCw size={11} /> Take failed — retry</button>
                                ) : activeAsset.spec.voice?.url ? (
                                  <button onClick={() => retrySceneVoice(active)} data-testid="composer-scene-voice-retry"
                                    className="flex items-center gap-1 hover:text-white"><RefreshCw size={11} /> Re-record this line</button>
                                ) : null}
                              </div>
                            )}
                          </>
                        )}

                        {activeAsset.type === "scene" && (
                          <>
                            <VideoClipEditor
                              clip={{ ...activeAsset.spec.clip, url: activeAsset.spec.video_url || activeAsset.spec.clip?.url || "" }}
                              onChange={patchClip}
                              isFirst={active === 0}
                              uploading={clipUploading}
                              onUpload={uploadClipMedia}
                              onPickStock={() => setStockTarget("clip-video")}
                              onPickLibrary={() => { setLibraryTarget("clip"); setLibraryOpen(true); }}
                              onGenerate={() => navigate("/library", { state: { tab: "video", prompt: activeAsset.spec.video_prompt || activeAsset.spec.heading } })}
                              onClear={clearClip}
                            />
                            {(sceneVisualLoading[active] || sceneVisualError[active]) && (
                              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
                                {sceneVisualLoading[active] ? (
                                  <span className="flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Finding footage…</span>
                                ) : (
                                  <button onClick={() => retrySceneVisual(active)} data-testid="composer-scene-visual-retry"
                                    className="flex items-center gap-1 text-magic hover:text-white"><RefreshCw size={11} /> Footage search failed — retry</button>
                                )}
                              </div>
                            )}
                          </>
                        )}

                        <SlideField label={activeAsset.type === "scene" ? "Video prompt" : "Image prompt"}
                          value={activeAsset.type === "scene" ? activeAsset.spec.video_prompt : activeAsset.spec.image_prompt} rows={2}
                          testid="composer-slide-prompt"
                          onChange={(v) => patchSlide(active, activeAsset.type === "scene" ? { video_prompt: v } : { image_prompt: v })} />

                        <div className="mt-3 flex flex-wrap gap-2">
                          {activeAsset.type === "scene" ? null : (
                            <>
                              <Button variant="secondary" onClick={() => renderSlideImage(active)} disabled={renderingSlide !== null}
                                data-testid="composer-slide-image"
                                className="h-8 gap-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-white hover:bg-white/10">
                                {renderingSlide === active ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />} Generate image
                              </Button>
                              <Button variant="secondary" onClick={() => setStockTarget("slide-image")} data-testid="composer-slide-stock-image"
                                className="h-8 gap-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-white hover:bg-white/10">
                                <Search size={13} /> Stock photo
                              </Button>
                              {activeAsset.spec.image_url && (
                                <Button variant="ghost" onClick={() => patchSlide(active, { image_url: "" })} data-testid="composer-slide-image-clear"
                                  className="h-8 px-2.5 text-xs text-zinc-500 hover:text-magic">Remove image</Button>
                              )}
                              {activeAsset.spec.image_url && (
                                <div className="flex w-full flex-wrap items-center gap-2 pt-1">
                                  <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">Opacity</span>
                                  <input type="range" min={0} max={1} step={0.05}
                                    value={activeAsset.spec.image_opacity ?? 0.45}
                                    onChange={(e) => patchSlide(active, { image_opacity: Number(e.target.value) })}
                                    data-testid="composer-slide-image-opacity" className="w-24" />
                                  <span className="w-8 font-mono text-[10px] text-zinc-500">{Math.round((activeAsset.spec.image_opacity ?? 0.45) * 100)}%</span>
                                  <div className="flex gap-1">
                                    {["cover", "contain"].map((f) => (
                                      <button key={f} onClick={() => patchSlide(active, { image_fit: f })} data-testid={`composer-slide-image-fit-${f}`}
                                        className={`rounded-full border px-2 py-0.5 text-[11px] ${(activeAsset.spec.image_fit || "cover") === f ? "border-lime text-lime" : "border-white/10 text-zinc-500"}`}>{f}</button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                          <Button variant="secondary" onClick={downloadSlide} data-testid="composer-slide-download"
                            className="h-8 gap-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-white hover:bg-white/10">
                            <Download size={13} /> PNG
                          </Button>
                          {assets.length > 1 && (
                            <Button variant="secondary" onClick={downloadAllSlides} disabled={downloadingAll}
                              data-testid="composer-slide-download-all"
                              className="h-8 gap-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-white hover:bg-white/10">
                              {downloadingAll ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                              {downloadingAll ? "Zipping…" : `All ${assets.length}`}
                            </Button>
                          )}
                          <Button variant="secondary" onClick={() => setCanvasOpen(true)} data-testid="composer-edit-canvas"
                            className="h-8 gap-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-white hover:bg-white/10">
                            <Maximize2 size={13} /> Edit on canvas
                          </Button>
                          {activeAsset.spec.elements ? (
                            <Button variant="ghost" onClick={() => resetSlideLayout(active)} data-testid="composer-slide-reset-layout"
                              className="h-8 gap-1.5 px-2.5 text-xs text-zinc-500 hover:text-white">
                              <Undo2 size={13} /> Reset to design
                            </Button>
                          ) : (
                            <Button variant="secondary" onClick={() => enterLayoutEdit(active)} data-testid="composer-slide-edit-layout"
                              className="h-8 gap-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-white hover:bg-white/10">
                              <LayoutTemplate size={13} /> Edit layout
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Attached media — a single-image/video/audio slot separate from the
              slide deck, used for single-format posts or the podcast/voice case. */}
          <div className="rounded-xl border border-white/10 bg-[#121212] p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">
                Attached media{mediaUrl ? ` · ${mediaType}` : ""}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" onClick={() => setStockTarget("media")} data-testid="composer-media-stock"
                  className="h-7 gap-1.5 px-2 text-xs text-zinc-400 hover:text-white">
                  <Search size={12} /> {mediaUrl ? "Change" : "Browse stock"}
                </Button>
                {mediaUrl && (
                  <button onClick={() => { setMediaUrl(""); setMediaType(""); }} className="text-zinc-500 hover:text-white" data-testid="composer-remove-media"><X size={16} /></button>
                )}
              </div>
            </div>
            {mediaUrl ? (
              <div className="mt-3 overflow-hidden rounded-lg">
                {mediaType === "video" ? <video src={mediaUrl} controls className="w-full" />
                  : (mediaType === "music" || mediaType === "audio" || mediaType === "voice") ? <audio src={mediaUrl} controls className="w-full" />
                  : <img src={mediaUrl} alt="media" className="max-h-64 w-full object-contain" />}
              </div>
            ) : (
              <p className="mt-3 text-xs text-zinc-600">Optional — attach one photo, video or audio clip separate from the slide deck above.</p>
            )}
          </div>

          <div className="rounded-xl border border-white/10 bg-[#121212] p-5">
            <label className="block font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Schedule</label>
            <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} data-testid="composer-schedule-time"
              className="mt-2 w-full rounded-lg border border-white/10 bg-[#0A0A0A] px-3 py-2.5 text-sm text-white outline-none focus:border-lime [color-scheme:dark]" />
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => persist("draft")} disabled={saving} data-testid="composer-save-draft"
                className="gap-2 rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10">
                <Save size={16} /> Save draft
              </Button>
              <Button onClick={() => persist("scheduled")} disabled={saving} data-testid="composer-schedule"
                className="gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <CalendarClock size={16} />} Schedule
              </Button>
              <Button onClick={() => persist("published")} disabled={saving} data-testid="composer-publish"
                className="gap-2 rounded-lg border border-lime/40 bg-transparent text-lime hover:bg-lime/10">
                <Send size={16} /> Mark published
              </Button>
            </div>
            <p className="mt-3 text-xs text-zinc-600">Scheduling stores your post in the calendar. Live network publishing connects later.</p>
          </div>
        </div>

        {/* Preview column */}
        <div className="min-w-0 space-y-4">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">
            <Sparkles size={13} className="text-lime" /> Platform preview
          </div>

          {previews.map((k) => {
            // A platform with its own caption previews with THAT text (plus
            // the shared hashtags) — otherwise every preview would show the
            // default caption even for the one platform that overrode it.
            const custom = contentByPlatform[k]?.trim();
            const text = custom ? [custom, hashtags.join(" ")].filter(Boolean).join("\n\n") : fullText;
            return <PostPreview key={k} platformKey={k} content={text} mediaUrl={mediaUrl} mediaType={mediaType} />;
          })}
        </div>
      </div>

      <MediaPicker
        open={stockTarget !== null}
        onOpenChange={(open) => !open && setStockTarget(null)}
        defaultType={
          stockTarget === "slide-video" || stockTarget === "clip-video" ? "video"
          : stockTarget === "element-replace"
            ? ((activeAsset?.spec.elements || []).find((x) => x.id === selectedElementId)?.type === "video" ? "video" : "image")
            : "image"
        }
        orientation={orientationFor(aspect)}
        onSelect={onStockPick}
      />
      <ElementsLibrary open={libraryOpen} onOpenChange={(o) => { setLibraryOpen(o); if (!o) setLibraryTarget(null); }} onPick={addLibraryElement} />

      {/* Full-screen canvas — the same slide, the same element state, but
          the card gets the whole viewport and every control is a thumb-sized
          button on a rail. It sits at z-40 so the stock picker and elements
          library (z-50 sheets) still open over the top of it. */}
      <ReelExportDialog open={exportOpen} onClose={() => setExportOpen(false)}
        assets={assets} brand={brand} aspect={aspect} title={title} music={music} />

      {canvasOpen && activeAsset && (
        <CanvasEditor
          spec={activeAsset.spec} brand={brand} aspect={aspect} aspectCls={aspectCls} cardRef={cardRef}
          slides={assets} slideCount={assets.length} activeIndex={active}
          onSelectSlide={(i) => { setActive(i); setSelectedElementId(null); }}
          onAddSlide={addSlide} onDuplicateSlide={() => duplicateSlide(active)}
          selectedId={selectedElementId} onSelect={setSelectedElementId} onChangeElement={patchElement}
          onAdd={addElementToSlide} onRemove={removeElement} onDuplicate={duplicateElement}
          onReorder={reorderElement} onApplyAll={applyElementToAllSlides}
          onAddStock={() => setStockTarget("element-new")}
          onBrowseStock={() => setStockTarget("element-replace")}
          onOpenLibrary={() => setLibraryOpen(true)}
          onSaveToLibrary={saveElementToLibrary}
          bgColor={activeAsset.spec.bg_color || themeFor(activeAsset.spec.theme, brand).bg}
          onChangeBg={(hex) => patchSlide(active, { bg_color: hex })}
          onEnterLayoutEdit={() => enterLayoutEdit(active)}
          onUndo={undo} onRedo={redo} canUndo={canUndo} canRedo={canRedo}
          onClose={() => setCanvasOpen(false)}
        />
      )}
    </div>
  );
}

// ---- small pieces ----
const IconBtn = ({ children, onClick, disabled, testid, danger, title }) => (
  <button onClick={onClick} disabled={disabled} data-testid={testid} title={title}
    className={`flex h-7 w-7 items-center justify-center rounded-md border border-white/10 transition-colors disabled:opacity-30 ${danger ? "text-zinc-500 hover:text-magic" : "text-zinc-400 hover:text-white"}`}>
    {children}
  </button>
);

// Shared by both places a reel's voice can be picked: before a build (so
// the first take already comes back in the right voice) and after one
// (for a per-scene retake in a different voice). `idPrefix` keeps their
// testids distinct without duplicating this markup twice.
const VoicePresetPicker = ({ value, onChange, idPrefix }) => (
  <div className="mt-3 flex flex-wrap items-center gap-1.5">
    <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">Voice</span>
    {VOICE_PRESETS.map((v) => (
      <button key={v.key} onClick={() => onChange(v.key)} title={v.desc}
        data-testid={`${idPrefix}-${v.key.toLowerCase()}`}
        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
          value === v.key ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"
        }`}>
        {v.label}
      </button>
    ))}
  </div>
);

const SlideField = ({ label, value, onChange, rows, testid }) => (
  <div className="mt-3">
    <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">{label}</label>
    {rows ? (
      <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={rows} data-testid={testid}
        className="mt-1.5 w-full resize-none rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-sm text-white outline-none focus:border-lime" />
    ) : (
      <input value={value || ""} onChange={(e) => onChange(e.target.value)} data-testid={testid}
        className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-sm text-white outline-none focus:border-lime" />
    )}
  </div>
);

// The property panel for a slide's freeform elements — shown instead of the
// fixed heading/body fields once a slide has entered layout-edit mode.
function ElementPropertyPanel({ elements, selectedId, onSelect, onPatch, onAdd, onRemove, onDuplicate, onReorder, onAddStock, onBrowseStock, onApplyAll, onOpenLibrary, onSaveToLibrary, canApplyAll, brand, bgColor, onChangeBg }) {
  useAllFontsLoaded();
  const fontCatalog = useFontCatalog();
  const el = elements.find((x) => x.id === selectedId);
  const fontOptions = brand?.fonts?.display && !fontCatalog.some((f) => f.key === brand.fonts.display)
    ? [{ key: brand.fonts.display, label: `${brand.fonts.display} (brand)` }, ...fontCatalog] : fontCatalog;
  const fontGroups = groupFontsByCategory(fontOptions);

  return (
    <div className="mt-3" data-testid="composer-element-panel">
      {onChangeBg && (
        <div className="mb-3 flex items-center gap-2">
          <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">Background</label>
          <input type="color" value={bgColor || "#0A0A0A"} onChange={(e) => onChangeBg(e.target.value)}
            data-testid="composer-slide-bg-color" className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0" />
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {[{ t: "text", I: Type, l: "Text" }, { t: "image", I: ImageIcon, l: "Image" }, { t: "video", I: Film, l: "Video" }, { t: "logo", I: Upload, l: "Logo" }, { t: "shape", I: Square, l: "Shape" }].map(({ t, I, l }) => (
          <Button key={t} variant="secondary" onClick={() => onAdd(t)} data-testid={`composer-add-element-${t}`}
            className="h-7 gap-1 rounded-lg border border-white/10 bg-white/5 px-2 text-[11px] text-white hover:bg-white/10">
            <I size={11} /> {l}
          </Button>
        ))}
        <Button variant="secondary" onClick={onAddStock} data-testid="composer-add-element-stock"
          className="h-7 gap-1 rounded-lg border border-white/10 bg-white/5 px-2 text-[11px] text-white hover:bg-white/10">
          <Search size={11} /> Stock photo
        </Button>
        <Button variant="secondary" onClick={onOpenLibrary} data-testid="composer-open-library"
          className="h-7 gap-1 rounded-lg border border-white/10 bg-white/5 px-2 text-[11px] text-white hover:bg-white/10">
          <Shapes size={11} /> Library
        </Button>
      </div>

      {elements.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid="composer-element-list">
          {elements.map((e, i) => (
            <button key={e.id} onClick={() => onSelect(e.id)} data-testid={`composer-element-chip-${e.id}`}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${e.id === selectedId ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
              {e.type === "text" ? (e.text || "Text").slice(0, 14) || `Text ${i + 1}`
                : e.type === "shape" ? "Shape" : e.type === "video" ? "Clip" : "Image"}
            </button>
          ))}
        </div>
      )}

      {el && (
        <div className="mt-3 rounded-lg border border-white/10 bg-[#121212] p-3">
          {el.type === "text" && (
            <>
              <textarea value={el.text || ""} onChange={(e) => onPatch(el.id, { text: e.target.value })} rows={2}
                data-testid="composer-element-text" className="w-full resize-none rounded-lg border border-white/10 bg-[#0A0A0A] px-2.5 py-2 text-sm text-white outline-none focus:border-lime" />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <select value={el.fontFamily || "Inter"} onChange={(e) => onPatch(el.id, { fontFamily: e.target.value })} data-testid="composer-element-font"
                  className="rounded-lg border border-white/10 bg-[#0A0A0A] px-2 py-1.5 text-xs text-white outline-none [color-scheme:dark]">
                  {fontGroups.map(({ category, fonts }) => (
                    <optgroup key={category} label={category}>
                      {fonts.map((f) => <option key={f.key} value={f.key} style={{ fontFamily: fontStack(f.key) }}>{f.label || f.key}</option>)}
                    </optgroup>
                  ))}
                </select>
                <select value={el.fontWeight || 600} onChange={(e) => onPatch(el.id, { fontWeight: Number(e.target.value) })} data-testid="composer-element-weight"
                  className="rounded-lg border border-white/10 bg-[#0A0A0A] px-2 py-1.5 text-xs text-white outline-none [color-scheme:dark]">
                  {[400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
              <FontNotice fontKey={el.fontFamily || "Inter"} testid="composer-font-notice" />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="font-mono text-[10px] text-zinc-500">Size</label>
                <input type="number" min={8} max={120} value={el.fontSize || 16} onChange={(e) => onPatch(el.id, { fontSize: Number(e.target.value) })}
                  data-testid="composer-element-size" className="w-16 rounded-lg border border-white/10 bg-[#0A0A0A] px-2 py-1 text-xs text-white outline-none" />
                <input type="color" value={el.color || "#FFFFFF"} onChange={(e) => onPatch(el.id, { color: e.target.value })}
                  data-testid="composer-element-color" className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0" />
                <div className="flex gap-1">
                  {[{ v: "left", I: AlignLeft }, { v: "center", I: AlignCenter }, { v: "right", I: AlignRight }].map(({ v, I }) => (
                    <button key={v} onClick={() => onPatch(el.id, { align: v })} data-testid={`composer-element-align-${v}`}
                      className={`flex h-7 w-7 items-center justify-center rounded-md border ${(el.align || "left") === v ? "border-lime text-lime" : "border-white/10 text-zinc-500"}`}>
                      <I size={12} />
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          {(el.type === "image" || el.type === "video") && (
            <>
              <div className="flex gap-1.5">
                <input value={el.url || ""} onChange={(e) => onPatch(el.id, { url: e.target.value })}
                  placeholder={el.type === "video" ? "Video URL" : "Image URL"}
                  data-testid="composer-element-url" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0A0A0A] px-2.5 py-2 text-xs text-zinc-300 outline-none focus:border-lime" />
                <Button variant="secondary" onClick={onBrowseStock} data-testid="composer-element-browse-stock"
                  className="h-8 flex-shrink-0 gap-1 rounded-lg border border-white/10 bg-white/5 px-2 text-[11px] text-white hover:bg-white/10">
                  <Search size={11} />
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="font-mono text-[10px] text-zinc-500">Fit</label>
                {["cover", "contain"].map((f) => (
                  <button key={f} onClick={() => onPatch(el.id, { fit: f })} data-testid={`composer-element-fit-${f}`}
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${(el.fit || "cover") === f ? "border-lime text-lime" : "border-white/10 text-zinc-500"}`}>{f}</button>
                ))}
                <label className="font-mono text-[10px] text-zinc-500">Opacity</label>
                <input type="range" min={0} max={1} step={0.05} value={el.opacity ?? 1} onChange={(e) => onPatch(el.id, { opacity: Number(e.target.value) })}
                  data-testid="composer-element-opacity" className="w-16" />
              </div>
            </>
          )}
          {el.type === "shape" && (
            <div className="flex flex-wrap items-center gap-2">
              <input type="color" value={el.color || "#E2FF3D"} onChange={(e) => onPatch(el.id, { color: e.target.value })}
                data-testid="composer-element-color" className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0" />
              {["rect", "ellipse"].map((s) => (
                <button key={s} onClick={() => onPatch(el.id, { shape: s })} data-testid={`composer-element-shape-${s}`}
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${(el.shape || "rect") === s ? "border-lime text-lime" : "border-white/10 text-zinc-500"}`}>{s}</button>
              ))}
              <label className="font-mono text-[10px] text-zinc-500">Opacity</label>
              <input type="range" min={0} max={1} step={0.05} value={el.opacity ?? 1} onChange={(e) => onPatch(el.id, { opacity: Number(e.target.value) })}
                data-testid="composer-element-opacity" className="w-16" />
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-white/5 pt-2">
            <label className="font-mono text-[10px] text-zinc-500">Rotate</label>
            <input type="number" value={Math.round(el.rotation || 0)} onChange={(e) => onPatch(el.id, { rotation: Number(e.target.value) })}
              data-testid="composer-element-rotation" className="w-14 rounded-lg border border-white/10 bg-[#0A0A0A] px-2 py-1 text-xs text-white outline-none" />
            <span className="text-xs text-zinc-600">°</span>
            <div className="flex gap-1">
              {canApplyAll && (
                <IconBtn onClick={() => onApplyAll(el.id)} testid="composer-element-apply-all" title="Apply to all slides"><CopyPlus size={13} /></IconBtn>
              )}
              <IconBtn onClick={() => onReorder(el.id, "back")} testid="composer-element-send-back"><ChevronsDown size={13} /></IconBtn>
              <IconBtn onClick={() => onReorder(el.id, "front")} testid="composer-element-bring-front"><ChevronsUp size={13} /></IconBtn>
              <IconBtn onClick={() => onDuplicate(el.id)} testid="composer-element-duplicate"><Copy size={13} /></IconBtn>
              {onSaveToLibrary && (
                <IconBtn onClick={() => onSaveToLibrary(el.id)} testid="composer-element-save-library" title="Save to your library"><BookmarkPlus size={13} /></IconBtn>
              )}
              <IconBtn onClick={() => onRemove(el.id)} testid="composer-element-remove" danger><Trash2 size={13} /></IconBtn>
            </div>
          </div>
        </div>
      )}
      {!el && elements.length > 0 && <p className="mt-2 text-xs text-zinc-600">Tap an element above, or on the preview, to edit it.</p>}
    </div>
  );
}

function HashtagBar({ hashtags, setHashtags, max }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const raw = draft.trim().replace(/^#/, "");
    if (!raw) return;
    const tag = `#${raw}`;
    if (!hashtags.includes(tag)) setHashtags([...hashtags, tag]);
    setDraft("");
  };
  return (
    <div className="mt-3" data-testid="composer-hashtags">
      <div className="flex flex-wrap items-center gap-1.5">
        <Hash size={13} className={hashtags.length > max ? "text-magic" : "text-zinc-600"} />
        {hashtags.map((t) => (
          <button key={t} onClick={() => setHashtags(hashtags.filter((x) => x !== t))}
            className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:border-magic/40 hover:text-magic">
            {t}
          </button>
        ))}
        <input value={draft} onChange={(e) => setDraft(e.target.value)} data-testid="composer-hashtag-input"
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); add(); } }}
          placeholder={hashtags.length ? "add…" : `up to ${max} hashtags`}
          className="min-w-[90px] flex-1 bg-transparent py-1 text-xs text-zinc-300 outline-none placeholder:text-zinc-700" />
      </div>
    </div>
  );
}

const CoachPanel = ({ coach, onUseHook }) => (
  <div className="mt-4 rounded-lg border border-white/10 bg-[#0A0A0A] p-4" data-testid="composer-coach-panel">
    <div className="flex items-center justify-between">
      <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Coach feedback</span>
      {typeof coach.score === "number" && (
        <span className={`font-display text-lg font-semibold ${coach.score >= 70 ? "text-lime" : coach.score >= 40 ? "text-amber-400" : "text-magic"}`}>{coach.score}/100</span>
      )}
    </div>
    {coach.strengths?.length > 0 && (
      <div className="mt-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-lime">Working</div>
        <ul className="mt-1.5 space-y-1 text-sm text-zinc-300">{coach.strengths.map((s, i) => <li key={i}>&bull; {s}</li>)}</ul>
      </div>
    )}
    {coach.improvements?.length > 0 && (
      <div className="mt-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-amber-400">Fix</div>
        <ul className="mt-1.5 space-y-1 text-sm text-zinc-300">{coach.improvements.map((s, i) => <li key={i}>&bull; {s}</li>)}</ul>
      </div>
    )}
    {coach.hook_rewrite && (
      <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-white/10 bg-[#121212] p-3">
        <span className="text-sm italic text-zinc-200">&ldquo;{coach.hook_rewrite}&rdquo;</span>
        <Button variant="secondary" onClick={() => onUseHook(coach.hook_rewrite)}
          className="h-7 flex-shrink-0 rounded-md border border-white/10 bg-white/5 px-2.5 text-xs text-white hover:bg-white/10">Use</Button>
      </div>
    )}
  </div>
);

// Visual Studio hands over its generated copy; turn it into editable slides.
function visualToAssets(data, template, theme) {
  if (!data) return [];
  if (data.slides) {
    const total = data.slides.length + 1;
    return [
      { type: "visual", caption: "", spec: { template: "cover", theme, index: 0, total, title: data.title || "" } },
      ...data.slides.map((s, i) => ({
        type: "visual", caption: s.caption || "",
        spec: { template: "slide", theme, index: i + 1, total, heading: s.heading || s.caption || "", body: s.body || "", image_prompt: s.image_prompt || "" },
      })),
    ];
  }
  if (template === "quote") return [{ type: "visual", caption: "", spec: { template: "quote", theme, quote: data.quote, author: data.author } }];
  if (template === "tweet") return [{ type: "visual", caption: "", spec: { template: "tweet", theme, name: data.name, handle: data.handle, text: data.text } }];
  if (template === "infographic") return [{ type: "visual", caption: "", spec: { template: "infographic", theme, title: data.title, points: data.points || [] } }];
  return [];
}

function summaryOf(data, template) {
  if (!data) return "";
  if (template === "quote") return `"${data.quote}" — ${data.author}`;
  if (template === "tweet") return data.text || "";
  if (template === "infographic") return `${data.title}\n\n` + (data.points || []).map((p) => `• ${p}`).join("\n");
  if (data.slides) return `${data.title}\n\n` + data.slides.map((s, i) => `${i + 1}. ${s.heading || s.caption || ""}`).join("\n");
  return "";
}

function toLocalInput(iso) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 16);
}
