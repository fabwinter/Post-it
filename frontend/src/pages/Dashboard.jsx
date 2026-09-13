import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { platformOf } from "@/lib/platforms";
import { Plus, ArrowRight, FileText, CalendarClock, Images, Wand2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

// Every post now starts in the Composer — its Topic mode has its own Idea
// panel (folded in from what used to live here), plus Source/Visual/Batch
// for the other three ways to start. Home just answers "where do things
// stand": counts, drafts, what's queued, and one way in.
export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ total: 0, drafts: 0, scheduled: 0, published: 0, media: 0 });
  const [drafts, setDrafts] = useState([]);
  const [scheduled, setScheduled] = useState([]);

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

  const statCards = [
    { label: "Total posts", value: stats.total, icon: FileText },
    { label: "Drafts", value: stats.drafts, icon: Wand2 },
    { label: "Scheduled", value: stats.scheduled, icon: CalendarClock },
    { label: "Media", value: stats.media, icon: Images },
  ];

  return (
    <div className="space-y-8" data-testid="dashboard-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">Welcome back</div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight sm:text-5xl">Home</h1>
        </div>
        <Button onClick={() => navigate("/composer")} data-testid="dashboard-new-post"
          className="h-11 gap-2 rounded-xl bg-lime px-5 font-semibold text-[#0A0A0A] hover:bg-lime-hover">
          <Plus size={18} /> New post
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCards.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="rounded-xl border border-white/10 bg-[#121212] p-5">
              <Icon size={18} className="text-zinc-500" />
              <div className="mt-4 font-display text-3xl font-semibold">{s.value}</div>
              <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">{s.label}</div>
            </div>
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
