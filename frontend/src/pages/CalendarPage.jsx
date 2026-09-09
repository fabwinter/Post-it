import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "@/lib/api";
import { platformOf } from "@/lib/platforms";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, CalendarDays, Trash2, CheckSquare, Square, Loader2 } from "lucide-react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function CalendarPage() {
  const navigate = useNavigate();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [posts, setPosts] = useState([]);
  const [selected, setSelected] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const load = async () => {
    const [sc, pub] = await Promise.all([
      api.get("/posts", { params: { status: "scheduled" } }),
      api.get("/posts", { params: { status: "published" } }),
    ]);
    setPosts([...sc.data, ...pub.data].filter((p) => p.scheduled_time));
  };
  useEffect(() => { load(); }, []);

  const upcoming = useMemo(
    () => posts.filter((p) => p.status === "scheduled").sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time)),
    [posts]
  );

  const toggleSelect = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleSelectAll = () => setSelected((s) => (s.length === upcoming.length ? [] : upcoming.map((p) => p.id)));

  const bulkDelete = async () => {
    if (selected.length === 0) return;
    setBulkDeleting(true);
    try {
      const { data } = await api.post("/posts/bulk-delete", { ids: selected });
      toast.success(`Deleted ${data.deleted} post${data.deleted === 1 ? "" : "s"}`);
      setSelected([]);
      await load();
    } catch (e) { toast.error(apiErrorMessage(e, "Bulk delete failed.")); } finally { setBulkDeleting(false); }
  };

  const grid = useMemo(() => {
    const year = cursor.getFullYear(); const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    let startDow = first.getDay(); startDow = startDow === 0 ? 6 : startDow - 1; // Mon-first
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  const postsFor = (date) => {
    if (!date) return [];
    return posts.filter((p) => {
      const d = new Date(p.scheduled_time);
      return d.getFullYear() === date.getFullYear() && d.getMonth() === date.getMonth() && d.getDate() === date.getDate();
    }).sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));
  };

  const monthLabel = cursor.toLocaleString(undefined, { month: "long", year: "numeric" });
  const today = new Date();
  const isToday = (d) => d && d.toDateString() === today.toDateString();

  return (
    <div data-testid="calendar-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">Content calendar</div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">{monthLabel}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} data-testid="cal-prev"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#121212] text-zinc-400 hover:text-white"><ChevronLeft size={18} /></button>
          <button onClick={() => { const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)); }}
            className="rounded-lg border border-white/10 bg-[#121212] px-4 py-2 text-sm text-zinc-300 hover:text-white" data-testid="cal-today">Today</button>
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} data-testid="cal-next"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#121212] text-zinc-400 hover:text-white"><ChevronRight size={18} /></button>
          <Button onClick={() => navigate("/composer")} data-testid="cal-new-post"
            className="ml-1 gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover"><Plus size={16} /> New post</Button>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-white/10 bg-[#121212]">
        <div className="grid grid-cols-7 border-b border-white/10">
          {DAYS.map((d) => <div key={d} className="px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {grid.map((date, i) => {
            const dayPosts = postsFor(date);
            return (
              <div key={i} onClick={() => date && navigate("/composer", { state: { presetDate: date.toISOString() } })}
                className={`min-h-[116px] border-b border-r border-white/[0.06] p-2 transition-colors ${date ? "cursor-pointer hover:bg-white/[0.03]" : "bg-[#0d0d0d]"}`}
                data-testid={date ? `cal-day-${date.getDate()}` : undefined}>
                {date && (
                  <>
                    <div className={`mb-1.5 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs ${isToday(date) ? "bg-lime font-semibold text-[#0A0A0A]" : "text-zinc-500"}`}>{date.getDate()}</div>
                    <div className="space-y-1">
                      {dayPosts.slice(0, 3).map((p) => {
                        const pk = p.platforms[0] || "twitter"; const P = platformOf(pk); const I = P.icon;
                        return (
                          <button key={p.id} onClick={(e) => { e.stopPropagation(); navigate("/composer", { state: { postId: p.id } }); }}
                            data-testid={`cal-post-${p.id}`}
                            className="flex w-full items-center gap-1.5 rounded-md border border-white/10 bg-[#0A0A0A] px-1.5 py-1 text-left hover:border-lime/40">
                            <I size={11} style={{ color: P.color }} className="flex-shrink-0" />
                            <span className="truncate text-[11px] text-zinc-300">{p.content || p.title}</span>
                          </button>
                        );
                      })}
                      {dayPosts.length > 3 && <div className="pl-1 font-mono text-[10px] text-zinc-600">+{dayPosts.length - 3} more</div>}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {posts.length === 0 && (
        <div className="mt-6 flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 p-8 text-sm text-zinc-600">
          <CalendarDays size={16} /> Nothing scheduled yet. Create a post and pick a date.
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="mt-6 rounded-xl border border-white/10 bg-[#121212]" data-testid="cal-upcoming">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <button onClick={toggleSelectAll} data-testid="cal-select-all"
              className="flex items-center gap-2 text-xs font-medium text-zinc-400 hover:text-white">
              {selected.length === upcoming.length ? <CheckSquare size={15} className="text-lime" /> : <Square size={15} />}
              Upcoming posts &middot; {upcoming.length}
            </button>
            {selected.length > 0 && (
              <Button variant="ghost" onClick={bulkDelete} disabled={bulkDeleting} data-testid="cal-bulk-delete"
                className="h-8 gap-1.5 rounded-lg px-3 text-xs text-magic hover:bg-magic/10">
                {bulkDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Delete {selected.length}
              </Button>
            )}
          </div>
          <div className="divide-y divide-white/[0.06]">
            {upcoming.map((p) => {
              const pk = p.platforms[0] || "twitter"; const P = platformOf(pk); const I = P.icon;
              const on = selected.includes(p.id);
              return (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2.5" data-testid={`cal-upcoming-${p.id}`}>
                  <button onClick={() => toggleSelect(p.id)} data-testid={`cal-select-${p.id}`} className="flex-shrink-0 text-zinc-500 hover:text-white">
                    {on ? <CheckSquare size={16} className="text-lime" /> : <Square size={16} />}
                  </button>
                  <I size={13} style={{ color: P.color }} className="flex-shrink-0" />
                  <button onClick={() => navigate("/composer", { state: { postId: p.id } })} className="min-w-0 flex-1 truncate text-left text-sm text-zinc-300 hover:text-white">
                    {p.content || p.title}
                  </button>
                  <span className="flex-shrink-0 font-mono text-[11px] text-zinc-500">
                    {new Date(p.scheduled_time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
