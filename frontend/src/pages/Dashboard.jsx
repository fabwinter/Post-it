import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { api, apiErrorMessage } from "@/lib/api";
import { useTextModels } from "@/lib/useTextModels";
import { PLATFORM_LIST, platformOf } from "@/lib/platforms";
import { ModelPicker } from "@/components/ModelPicker";
import { Sparkles, ArrowRight, Loader2, FileText, CalendarClock, Images, Send, Wand2, Zap } from "lucide-react";
import { usePlatformSpecs, specFor, FORMAT_LABEL } from "@/lib/platformSpecs";
import { PLATFORMS } from "@/lib/platforms";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const fade = {
  hidden: { opacity: 0, y: 16 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.06, duration: 0.4, ease: "easeOut" } }),
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [topic, setTopic] = useState("");
  const [ideas, setIdeas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({ total: 0, drafts: 0, scheduled: 0, published: 0, media: 0 });
  const [drafts, setDrafts] = useState([]);
  const [scheduled, setScheduled] = useState([]);
  const { models, default: defaultModel } = useTextModels("gemini-3-flash-preview");
  const [model, setModel] = useState("");
  const specs = usePlatformSpecs();
  const [platform, setPlatform] = useState("instagram");
  const [building, setBuilding] = useState(null);

  const loadData = async () => {
    try {
      const [s, d, sc] = await Promise.all([
        api.get("/stats"),
        api.get("/posts", { params: { status: "draft" } }),
        api.get("/posts", { params: { status: "scheduled" } }),
      ]);
      setStats(s.data);
      setDrafts(d.data.slice(0, 4));
      setScheduled(sc.data.sort((a, b) => (a.scheduled_time || "").localeCompare(b.scheduled_time || "")).slice(0, 4));
    } catch (e) { /* noop */ }
  };

  useEffect(() => { loadData(); }, []);

  const ideate = async () => {
    if (!topic.trim()) return;
    setLoading(true);
    setIdeas([]);
    try {
      const { data } = await api.post("/ai/ideate", { topic, count: 6, model: model || defaultModel });
      setIdeas(data.ideas);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't generate ideas."));
    } finally {
      setLoading(false);
    }
  };

  const openIdea = (idea) => {
    navigate("/composer", { state: { brief: idea } });
  };

  // The one-click path: idea straight to a finished post — caption, hashtags
  // and every slide — instead of six manual hops through the other screens.
  const buildIdea = async (idea, i) => {
    setBuilding(i);
    try {
      const { data } = await api.post("/ai/build-post", {
        topic: idea, platform, format: "auto", model: model || defaultModel,
      });
      navigate("/composer", { state: { plan: { ...data, platform } } });
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't build that post."));
    } finally { setBuilding(null); }
  };

  const statCards = [
    { label: "Total posts", value: stats.total, icon: FileText },
    { label: "Drafts", value: stats.drafts, icon: Wand2 },
    { label: "Scheduled", value: stats.scheduled, icon: CalendarClock },
    { label: "Media", value: stats.media, icon: Images },
  ];

  return (
    <div className="space-y-8" data-testid="dashboard-page">
      <motion.div variants={fade} initial="hidden" animate="show">
        <div className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">Welcome back</div>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
          What are we creating <span className="text-lime">today?</span>
        </h1>
      </motion.div>

      {/* Hero AI ideation */}
      <motion.div variants={fade} custom={1} initial="hidden" animate="show" className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#121212] p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-10 -top-10 h-52 w-52 rounded-full bg-gradient-to-br from-magic/30 to-lime/20 blur-3xl float-blur" />
        <div className="relative">
          <div className="flex items-center gap-2 text-zinc-400">
            <Sparkles size={16} className="text-lime" />
            <span className="font-mono text-xs uppercase tracking-[0.2em]">Idea engine</span>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              data-testid="dashboard-topic-input"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ideate()}
              placeholder="Drop a topic — e.g. how solopreneurs build distribution in 2026"
              className="flex-1 rounded-xl border border-white/10 bg-[#0A0A0A] px-4 py-3.5 text-[15px] text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-lime"
            />
            <Button
              data-testid="dashboard-ideate-button"
              onClick={ideate}
              disabled={loading}
              className="h-[52px] gap-2 rounded-xl bg-lime px-6 font-semibold text-[#0A0A0A] hover:bg-lime-hover"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
              Ideate
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">Model</span>
            <ModelPicker value={model || defaultModel} onChange={setModel} models={models} testid="dashboard-model"
              className="w-auto min-w-[180px] flex-none" />
            <span className="ml-1 font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">Build for</span>
            <div className="flex flex-wrap gap-1">
              {Object.keys(specs).map((k) => {
                const P = PLATFORMS[k]; if (!P) return null;
                const I = P.icon; const on = platform === k;
                return (
                  <button key={k} onClick={() => setPlatform(k)} data-testid={`dashboard-platform-${k}`}
                    title={specFor(specs, k).label}
                    className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-colors ${on ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-500 hover:text-white"}`}>
                    <I size={13} />
                  </button>
                );
              })}
            </div>
          </div>

          {ideas.length > 0 && (
            <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">
              Tap an idea to draft the caption · Build makes the whole {FORMAT_LABEL[specFor(specs, platform).default_format] || "post"} — copy, hashtags and slides
            </p>
          )}
          {ideas.length > 0 && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {ideas.map((idea, i) => (
                <motion.div
                  key={i}
                  variants={fade}
                  custom={i}
                  initial="hidden"
                  animate="show"
                  data-testid={`idea-item-${i}`}
                  className="group flex items-center gap-3 rounded-xl border border-white/10 bg-[#0A0A0A] p-4 transition-colors hover:border-lime/40 hover:bg-white/[0.04]"
                >
                  <span className="font-mono text-xs text-zinc-600">{String(i + 1).padStart(2, "0")}</span>
                  <button onClick={() => openIdea(idea)} data-testid={`idea-open-${i}`}
                    className="flex-1 text-left text-sm text-zinc-200">
                    {idea}
                  </button>
                  <button onClick={() => buildIdea(idea, i)} disabled={building !== null} data-testid={`idea-build-${i}`}
                    title={`Build a full ${specFor(specs, platform).label} post`}
                    className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-lime/30 bg-lime/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-lime transition-colors hover:bg-lime/20 disabled:opacity-40">
                    {building === i ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                    Build
                  </button>
                  <ArrowRight size={16} className="hidden text-zinc-600 transition-transform group-hover:translate-x-0.5 group-hover:text-lime sm:block" />
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCards.map((s, i) => {
          const Icon = s.icon;
          return (
            <motion.div key={s.label} variants={fade} custom={i} initial="hidden" animate="show"
              className="rounded-xl border border-white/10 bg-[#121212] p-5">
              <Icon size={18} className="text-zinc-500" />
              <div className="mt-4 font-display text-3xl font-semibold">{s.value}</div>
              <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">{s.label}</div>
            </motion.div>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent drafts */}
        <section className="min-w-0 rounded-xl border border-white/10 bg-[#121212] p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold">Recent drafts</h3>
            <button onClick={() => navigate("/composer")} className="font-mono text-[11px] uppercase tracking-[0.15em] text-lime hover:underline" data-testid="new-draft-link">+ New</button>
          </div>
          <div className="mt-4 space-y-2">
            {drafts.length === 0 && <EmptyRow label="No drafts yet — start in the Composer." />}
            {drafts.map((d) => (
              <button key={d.id} onClick={() => navigate("/composer", { state: { postId: d.id } })}
                className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-white/10 bg-[#0A0A0A] p-3 text-left transition-colors hover:border-white/20"
                data-testid={`draft-row-${d.id}`}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-zinc-200">{d.content || d.title}</div>
                  <div className="mt-1 flex gap-1">
                    {d.platforms.map((pk) => { const P = platformOf(pk); const I = P.icon; return <I key={pk} size={12} style={{ color: P.color }} />; })}
                  </div>
                </div>
                <ArrowRight size={15} className="text-zinc-600" />
              </button>
            ))}
          </div>
        </section>

        {/* Next scheduled */}
        <section className="min-w-0 rounded-xl border border-white/10 bg-[#121212] p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold">Next scheduled</h3>
            <button onClick={() => navigate("/calendar")} className="font-mono text-[11px] uppercase tracking-[0.15em] text-lime hover:underline" data-testid="view-calendar-link">Calendar</button>
          </div>
          <div className="mt-4 space-y-2">
            {scheduled.length === 0 && <EmptyRow label="Nothing queued — schedule from the Composer." />}
            {scheduled.map((d) => (
              <button key={d.id} onClick={() => navigate("/composer", { state: { postId: d.id } })}
                className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-white/10 bg-[#0A0A0A] p-3 text-left transition-colors hover:border-white/20"
                data-testid={`scheduled-row-${d.id}`}>
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white/5">
                  <Send size={15} className="text-lime" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-zinc-200">{d.content || d.title}</div>
                  <div className="font-mono text-[11px] text-zinc-500">{d.scheduled_time ? new Date(d.scheduled_time).toLocaleString() : "—"}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

const EmptyRow = ({ label }) => (
  <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-sm text-zinc-600">{label}</div>
);
