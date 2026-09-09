import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toPng } from "html-to-image";
import { api, pollTask, apiErrorMessage } from "@/lib/api";
import { useTextModels } from "@/lib/useTextModels";
import { useBrand } from "@/lib/useBrand";
import { PLATFORM_LIST } from "@/lib/platforms";
import { usePlatformSpecs, specFor, aspectFor, FORMAT_LABEL, FALLBACK_SPECS } from "@/lib/platformSpecs";
import { openHistory } from "@/lib/historyBus";
import { PostPreview } from "@/components/PostPreview";
import { ModelPicker } from "@/components/ModelPicker";
import { VisualCard, ASPECT_CLASS, THEME_LIST } from "@/components/VisualCard";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Sparkles, Loader2, Save, CalendarClock, Send, Wand2, Trash2, X, GraduationCap,
  Plus, ChevronLeft, ChevronRight, Download, ImagePlus, History, Hash, Film, Layers,
} from "lucide-react";

const emptySlide = (index, total) => ({
  type: "visual", caption: "",
  spec: { template: index === 0 ? "cover" : "slide", theme: "midnight", index, total, title: "", heading: "", body: "" },
});

export default function Composer() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state || {};
  const specs = usePlatformSpecs();
  const { brand } = useBrand();

  const [postId, setPostId] = useState(state.postId || null);
  const [title, setTitle] = useState("Untitled post");
  const [content, setContent] = useState(state.content || "");
  const [platforms, setPlatforms] = useState(state.platforms || ["instagram"]);
  // Start on the platform's native format — opening the Composer for Instagram
  // should offer a carousel, not a single graphic you then have to switch.
  const [format, setFormat] = useState(
    () => FALLBACK_SPECS[(state.platforms || ["instagram"])[0]]?.default_format || "single"
  );
  const [assets, setAssets] = useState([]);
  const [hashtags, setHashtags] = useState([]);
  const [mediaUrl, setMediaUrl] = useState(state.mediaUrl || "");
  const [mediaType, setMediaType] = useState(state.mediaType || "");
  const [scheduleAt, setScheduleAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [brief, setBrief] = useState(state.brief || "");
  const { models, default: defaultModel } = useTextModels("gemini-3-flash-preview");
  const [model, setModel] = useState("");
  const [coach, setCoach] = useState(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [renderingSlide, setRenderingSlide] = useState(null);
  const cardRef = useRef(null);

  const primary = platforms[0] || "instagram";
  const pspec = specFor(specs, primary);
  const aspect = aspectFor(specs, primary, format);
  const aspectCls = ASPECT_CLASS[aspect] || "aspect-square";
  const isDeck = format === "carousel" || format === "reel" || format === "thread";

  // Applying a plan is the whole idea→post shortcut landing: copy, hashtags,
  // format and every slide arrive together, already on-brand.
  const applyPlan = (plan) => {
    setTitle(plan.title || "Untitled post");
    setContent(plan.caption || "");
    setHashtags(plan.hashtags || []);
    setFormat(plan.format || "single");
    setAssets(plan.assets || []);
    setActive(0);
    if (plan.platform) setPlatforms([plan.platform]);
  };

  useEffect(() => {
    if (state.postId) {
      api.get(`/posts/${state.postId}`).then(({ data }) => {
        setPostId(data.id); setTitle(data.title); setContent(data.content);
        setPlatforms(data.platforms.length ? data.platforms : ["instagram"]);
        setFormat(data.format || "single");
        setAssets(data.assets || []);
        setHashtags(data.hashtags || []);
        setMediaUrl((data.media_urls || [])[0] || ""); setMediaType(data.media_type || "");
        if (data.scheduled_time) setScheduleAt(toLocalInput(data.scheduled_time));
      }).catch((e) => toast.error(apiErrorMessage(e, "Couldn't load that post.")));
      return;
    }
    if (state.plan) { applyPlan(state.plan); return; }
    // A deck arriving from Visual Studio comes as specs, not a flattened PNG.
    if (state.visual) {
      const { data, template, theme = "midnight" } = state.visual;
      setAssets(visualToAssets(data, template, theme));
      setFormat(data?.slides ? "carousel" : "single");
      setContent((c) => c || summaryOf(data, template));
    }
    if (state.brief && !state.content) generate(state.brief);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the format legal for whatever platform is selected first — an
  // Instagram carousel doesn't mean anything once you switch to X.
  useEffect(() => {
    if (!pspec.formats.includes(format)) setFormat(pspec.default_format);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primary]);

  useEffect(() => { if (active > assets.length - 1) setActive(Math.max(0, assets.length - 1)); }, [assets, active]);

  const togglePlatform = (k) => setPlatforms((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  const generate = async (b) => {
    const useBrief = b || brief || content;
    if (!useBrief.trim()) { toast.error("Add a brief or some text first."); return; }
    setAiLoading(true);
    try {
      const { data } = await api.post("/ai/write", { brief: useBrief, platform: primary, tone: "engaging", model: model || defaultModel });
      setContent(data.content);
    } catch (e) { toast.error(apiErrorMessage(e, "AI write failed.")); } finally { setAiLoading(false); }
  };

  const autoBuild = async () => {
    const topic = brief || content || title;
    if (!topic.trim()) { toast.error("Give it a topic or a brief first."); return; }
    setBuilding(true);
    try {
      const { data } = await api.post("/ai/build-post", {
        topic, platform: primary, format, slides: pspec.slides?.default, model: model || defaultModel,
      });
      applyPlan({ ...data, platform: primary });
      toast.success(`Built a ${FORMAT_LABEL[data.format] || data.format} for ${pspec.label}.`);
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't build the post.")); } finally { setBuilding(false); }
  };

  const runCoach = async () => {
    if (!content.trim()) { toast.error("Write something first."); return; }
    setCoachLoading(true); setCoach(null);
    try {
      const { data } = await api.post("/ai/coach", { content, platform: primary, model: model || defaultModel });
      setCoach(data.data);
    } catch (e) { toast.error(apiErrorMessage(e, "Coach feedback failed.")); } finally { setCoachLoading(false); }
  };

  // ---- slide editing ----
  const patchSlide = (i, patch) => setAssets((s) => s.map((a, idx) => (idx === i ? { ...a, spec: { ...a.spec, ...patch } } : a)));
  const setAllThemes = (theme) => setAssets((s) => s.map((a) => ({ ...a, spec: { ...a.spec, theme } })));
  const renumber = (list) => list.map((a, i) => ({ ...a, spec: { ...a.spec, index: i, total: list.length } }));

  const addSlide = () => setAssets((s) => {
    const next = renumber([...s, emptySlide(s.length, s.length + 1)]);
    setActive(next.length - 1);
    return next;
  });
  const removeSlide = (i) => setAssets((s) => renumber(s.filter((_, idx) => idx !== i)));
  const moveSlide = (i, dir) => setAssets((s) => {
    const j = i + dir;
    if (j < 0 || j >= s.length) return s;
    const next = [...s]; [next[i], next[j]] = [next[j], next[i]];
    setActive(j);
    return renumber(next);
  });

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
        options: { model: "gpt-image-2", size: aspect === "9:16" ? "9:16" : aspect === "4:5" ? "4:5" : "1:1", use_brand: true },
      });
      const result = await pollTask(data.task_id);
      const url = (result.files || []).find((f) => f.file_url)?.file_url;
      if (!url) throw new Error("No image came back");
      patchSlide(i, { image_url: url });
      toast.success("Slide image added");
    } catch (e) { toast.error(apiErrorMessage(e, "Image generation failed.")); } finally { setRenderingSlide(null); }
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

  const buildPayload = (status) => ({
    title: title || (content ? content.slice(0, 40) : "Untitled post"),
    content, platforms, status, format, assets, hashtags,
    media_urls: mediaUrl ? [mediaUrl] : [],
    media_type: mediaType || null,
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
    await api.delete(`/posts/${postId}`); toast.success("Deleted"); navigate("/");
  };

  const fullText = useMemo(
    () => [content, hashtags.join(" ")].filter(Boolean).join("\n\n"),
    [content, hashtags]
  );
  const previews = useMemo(() => (platforms.length ? platforms : ["instagram"]), [platforms]);
  const overLimit = fullText.length > (pspec.char_limit || 99999);
  const activeAsset = assets[active];

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
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_minmax(0,460px)]">
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

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <input value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Topic or brief…"
                data-testid="composer-brief"
                className="min-w-[180px] flex-1 rounded-lg border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm outline-none focus:border-iris" />
              <ModelPicker value={model || defaultModel} onChange={setModel} models={models} testid="composer-model" className="w-auto min-w-[160px] flex-none" />
            </div>
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

            {coach && <CoachPanel coach={coach} onUseHook={(h) => setContent(h + "\n\n" + content)} />}
          </div>

          {/* Visual block */}
          <div className="rounded-xl border border-white/10 bg-[#121212] p-5" data-testid="composer-visuals">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">
                {format === "reel" ? "Storyboard" : format === "carousel" ? "Slides" : "Visual"}
              </span>
              <div className="flex items-center gap-1.5">
                {THEME_LIST.concat([{ key: "brand", label: brand.name || "Brand", bg: brand.colors?.bg || "#0A0A0A" }]).map((th) => (
                  <button key={th.key} onClick={() => setAllThemes(th.key)} title={th.label}
                    data-testid={`composer-theme-${th.key}`}
                    className={`h-6 w-6 rounded-full border transition-transform hover:scale-110 ${activeAsset?.spec?.theme === th.key ? "border-lime" : "border-white/20"}`}
                    style={{ background: th.bg }} />
                ))}
              </div>
            </div>

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

                {/* Selected slide editor */}
                {activeAsset && (
                  <div className="mt-4 rounded-lg border border-white/10 bg-[#0A0A0A] p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">
                        {activeAsset.type === "scene" ? `Scene ${active + 1}` : activeAsset.spec.template === "cover" ? "Cover slide" : `Slide ${active + 1}`}
                      </span>
                      <div className="flex gap-1">
                        <IconBtn onClick={() => moveSlide(active, -1)} disabled={active === 0} testid="composer-slide-left"><ChevronLeft size={14} /></IconBtn>
                        <IconBtn onClick={() => moveSlide(active, 1)} disabled={active === assets.length - 1} testid="composer-slide-right"><ChevronRight size={14} /></IconBtn>
                        <IconBtn onClick={() => removeSlide(active)} testid="composer-slide-remove" danger><X size={14} /></IconBtn>
                      </div>
                    </div>

                    {activeAsset.spec.template === "cover" ? (
                      <SlideField label="Cover title" value={activeAsset.spec.title} testid="composer-slide-title"
                        onChange={(v) => patchSlide(active, { title: v })} />
                    ) : (
                      <>
                        <SlideField label={activeAsset.type === "scene" ? "On-screen text" : "Heading"} value={activeAsset.spec.heading}
                          testid="composer-slide-heading" onChange={(v) => patchSlide(active, { heading: v })} />
                        <SlideField label={activeAsset.type === "scene" ? "Voiceover" : "Body"} value={activeAsset.spec.body} rows={3}
                          testid="composer-slide-body" onChange={(v) => patchSlide(active, { body: v })} />
                      </>
                    )}

                    <SlideField label={activeAsset.type === "scene" ? "Video prompt" : "Image prompt"}
                      value={activeAsset.type === "scene" ? activeAsset.spec.video_prompt : activeAsset.spec.image_prompt} rows={2}
                      testid="composer-slide-prompt"
                      onChange={(v) => patchSlide(active, activeAsset.type === "scene" ? { video_prompt: v } : { image_prompt: v })} />

                    <div className="mt-3 flex flex-wrap gap-2">
                      {activeAsset.type === "scene" ? (
                        <Button variant="secondary" data-testid="composer-scene-to-studio"
                          onClick={() => navigate("/studio", { state: { kind: "video", prompt: activeAsset.spec.video_prompt || activeAsset.spec.heading } })}
                          className="h-8 gap-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-white hover:bg-white/10">
                          <Film size={13} /> Generate clip in Studio
                        </Button>
                      ) : (
                        <Button variant="secondary" onClick={() => renderSlideImage(active)} disabled={renderingSlide !== null}
                          data-testid="composer-slide-image"
                          className="h-8 gap-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-white hover:bg-white/10">
                          {renderingSlide === active ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />} Generate image
                        </Button>
                      )}
                      {activeAsset.spec.image_url && (
                        <Button variant="ghost" onClick={() => patchSlide(active, { image_url: "" })} data-testid="composer-slide-image-clear"
                          className="h-8 px-2.5 text-xs text-zinc-500 hover:text-magic">Remove image</Button>
                      )}
                      <Button variant="secondary" onClick={downloadSlide} data-testid="composer-slide-download"
                        className="h-8 gap-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-white hover:bg-white/10">
                        <Download size={13} /> PNG
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {mediaUrl && (
            <div className="rounded-xl border border-white/10 bg-[#121212] p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Attached media · {mediaType}</span>
                <button onClick={() => { setMediaUrl(""); setMediaType(""); }} className="text-zinc-500 hover:text-white" data-testid="composer-remove-media"><X size={16} /></button>
              </div>
              <div className="mt-3 overflow-hidden rounded-lg">
                {mediaType === "video" ? <video src={mediaUrl} controls className="w-full" />
                  : (mediaType === "music" || mediaType === "audio" || mediaType === "voice") ? <audio src={mediaUrl} controls className="w-full" />
                  : <img src={mediaUrl} alt="media" className="max-h-64 w-full object-contain" />}
              </div>
            </div>
          )}

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
            <Sparkles size={13} className="text-lime" /> Live preview
          </div>

          {assets.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-[#121212] p-4">
              <div className="mx-auto w-full max-w-[380px]">
                <div className={`${aspectCls} w-full overflow-hidden rounded-xl`}>
                  <div ref={cardRef} className="h-full w-full">
                    <VisualCard spec={activeAsset?.spec} brand={brand} scale={0.86} />
                  </div>
                </div>
              </div>
              {isDeck && (
                <div className="mt-3 flex items-center justify-center gap-3">
                  <IconBtn onClick={() => setActive((i) => Math.max(0, i - 1))} disabled={active === 0} testid="composer-prev"><ChevronLeft size={15} /></IconBtn>
                  <span className="font-mono text-[11px] text-zinc-500">{active + 1}/{assets.length}</span>
                  <IconBtn onClick={() => setActive((i) => Math.min(assets.length - 1, i + 1))} disabled={active === assets.length - 1} testid="composer-next"><ChevronRight size={15} /></IconBtn>
                </div>
              )}
            </div>
          )}

          {previews.map((k) => (
            <PostPreview key={k} platformKey={k} content={fullText} mediaUrl={mediaUrl} mediaType={mediaType} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- small pieces ----
const IconBtn = ({ children, onClick, disabled, testid, danger }) => (
  <button onClick={onClick} disabled={disabled} data-testid={testid}
    className={`flex h-7 w-7 items-center justify-center rounded-md border border-white/10 transition-colors disabled:opacity-30 ${danger ? "text-zinc-500 hover:text-magic" : "text-zinc-400 hover:text-white"}`}>
    {children}
  </button>
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
