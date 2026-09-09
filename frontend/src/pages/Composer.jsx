import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "@/lib/api";
import { useTextModels } from "@/lib/useTextModels";
import { PLATFORM_LIST, platformOf } from "@/lib/platforms";
import { PostPreview } from "@/components/PostPreview";
import { ModelPicker } from "@/components/ModelPicker";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Sparkles, Loader2, Save, CalendarClock, Send, Wand2, Trash2, X, GraduationCap } from "lucide-react";

export default function Composer() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state || {};

  const [postId, setPostId] = useState(state.postId || null);
  const [title, setTitle] = useState("Untitled post");
  const [content, setContent] = useState(state.content || "");
  const [platforms, setPlatforms] = useState(state.platforms || ["twitter"]);
  const [mediaUrl, setMediaUrl] = useState(state.mediaUrl || "");
  const [mediaType, setMediaType] = useState(state.mediaType || "");
  const [scheduleAt, setScheduleAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [brief, setBrief] = useState(state.brief || "");
  const { models, default: defaultModel } = useTextModels("gemini-3-flash-preview");
  const [model, setModel] = useState("");
  const [coach, setCoach] = useState(null);
  const [coachLoading, setCoachLoading] = useState(false);

  useEffect(() => {
    if (state.postId) {
      api.get(`/posts/${state.postId}`).then(({ data }) => {
        setPostId(data.id); setTitle(data.title); setContent(data.content);
        setPlatforms(data.platforms.length ? data.platforms : ["twitter"]);
        setMediaUrl((data.media_urls || [])[0] || ""); setMediaType(data.media_type || "");
        if (data.scheduled_time) setScheduleAt(toLocalInput(data.scheduled_time));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.postId]);

  // If arriving with a brief from an idea, auto-write once.
  useEffect(() => {
    if (state.brief && !state.content) { generate(state.brief); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePlatform = (k) => setPlatforms((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  const generate = async (b) => {
    const useBrief = b || brief || content;
    if (!useBrief.trim()) { toast.error("Add a brief or some text first."); return; }
    setAiLoading(true);
    try {
      const { data } = await api.post("/ai/write", { brief: useBrief, platform: platforms[0] || "twitter", tone: "engaging", model: model || defaultModel });
      setContent(data.content);
    } catch (e) { toast.error(apiErrorMessage(e, "AI write failed.")); } finally { setAiLoading(false); }
  };

  const runCoach = async () => {
    if (!content.trim()) { toast.error("Write something first."); return; }
    setCoachLoading(true); setCoach(null);
    try {
      const { data } = await api.post("/ai/coach", { content, platform: platforms[0] || "general", model: model || defaultModel });
      setCoach(data.data);
    } catch (e) { toast.error(apiErrorMessage(e, "Coach feedback failed.")); } finally { setCoachLoading(false); }
  };

  const buildPayload = (status) => ({
    title: title || (content ? content.slice(0, 40) : "Untitled post"),
    content, platforms, status,
    media_urls: mediaUrl ? [mediaUrl] : [],
    media_type: mediaType || null,
    scheduled_time: status === "scheduled" && scheduleAt ? new Date(scheduleAt).toISOString() : null,
  });

  const persist = async (status) => {
    if (!content.trim()) { toast.error("Nothing to save yet."); return; }
    if (status === "scheduled" && !scheduleAt) { toast.error("Pick a date & time to schedule."); return; }
    setSaving(true);
    try {
      const payload = buildPayload(status);
      let res;
      if (postId) res = await api.put(`/posts/${postId}`, payload);
      else res = await api.post("/posts", payload);
      setPostId(res.data.id);
      toast.success(status === "scheduled" ? "Post scheduled" : status === "published" ? "Marked as published" : "Draft saved");
      if (status !== "draft") navigate("/calendar");
    } catch (e) { toast.error(apiErrorMessage(e, "Save failed.")); } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!postId) { navigate("/"); return; }
    await api.delete(`/posts/${postId}`); toast.success("Deleted"); navigate("/");
  };

  const previews = useMemo(() => (platforms.length ? platforms : ["twitter"]), [platforms]);

  return (
    <div data-testid="composer-page">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">Composer</div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Craft & schedule</h1>
        </div>
        {postId && (
          <Button variant="ghost" onClick={remove} className="gap-2 text-zinc-500 hover:text-magic" data-testid="composer-delete">
            <Trash2 size={16} /> Delete
          </Button>
        )}
      </div>

      <div className="mt-7 grid gap-6 lg:grid-cols-[1fr_minmax(0,460px)]">
        {/* Editor */}
        <div className="space-y-5">
          <div className="rounded-xl border border-white/10 bg-[#121212] p-5">
            <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="composer-title"
              className="w-full bg-transparent font-display text-lg font-semibold text-white outline-none placeholder:text-zinc-600" placeholder="Post title" />
            <div className="my-4 h-px bg-white/10" />
            <textarea data-testid="composer-content" value={content} onChange={(e) => setContent(e.target.value)} rows={9}
              placeholder="Write your post, or generate it with AI…"
              className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-600" />

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <input value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Give the AI a brief (optional)…"
                data-testid="composer-brief"
                className="min-w-[180px] flex-1 rounded-lg border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm outline-none focus:border-iris" />
              <ModelPicker value={model || defaultModel} onChange={setModel} models={models} testid="composer-model" className="w-auto min-w-[160px] flex-none" />
              <Button onClick={() => generate()} disabled={aiLoading} data-testid="composer-ai-write"
                className="gap-2 rounded-lg bg-iris/90 font-semibold text-[#0A0A0A] hover:bg-iris">
                {aiLoading ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />} AI write
              </Button>
              <Button variant="secondary" onClick={runCoach} disabled={coachLoading} data-testid="composer-coach"
                className="gap-2 rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10">
                {coachLoading ? <Loader2 size={16} className="animate-spin" /> : <GraduationCap size={16} />} Coach
              </Button>
            </div>

            {coach && (
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
                    <ul className="mt-1.5 space-y-1 text-sm text-zinc-300">
                      {coach.strengths.map((s, i) => <li key={i}>&bull; {s}</li>)}
                    </ul>
                  </div>
                )}
                {coach.improvements?.length > 0 && (
                  <div className="mt-3">
                    <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-amber-400">Fix</div>
                    <ul className="mt-1.5 space-y-1 text-sm text-zinc-300">
                      {coach.improvements.map((s, i) => <li key={i}>&bull; {s}</li>)}
                    </ul>
                  </div>
                )}
                {coach.hook_rewrite && (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-white/10 bg-[#121212] p-3">
                    <span className="text-sm italic text-zinc-200">&ldquo;{coach.hook_rewrite}&rdquo;</span>
                    <Button variant="secondary" onClick={() => setContent(coach.hook_rewrite + "\n\n" + content)}
                      className="h-7 flex-shrink-0 rounded-md border border-white/10 bg-white/5 px-2.5 text-xs text-white hover:bg-white/10">Use</Button>
                  </div>
                )}
              </div>
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

            <label className="mt-5 block font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Schedule</label>
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

        {/* Live previews */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">
            <Sparkles size={13} className="text-lime" /> Live preview
          </div>
          {previews.map((k) => (
            <PostPreview key={k} platformKey={k} content={content} mediaUrl={mediaUrl} mediaType={mediaType} />
          ))}
        </div>
      </div>
    </div>
  );
}

function toLocalInput(iso) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 16);
}
