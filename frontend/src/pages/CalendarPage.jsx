import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { platformOf } from "@/lib/platforms";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Plus, CalendarDays } from "lucide-react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function CalendarPage() {
  const navigate = useNavigate();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [posts, setPosts] = useState([]);

  const load = async () => {
    const [sc, pub] = await Promise.all([
      api.get("/posts", { params: { status: "scheduled" } }),
      api.get("/posts", { params: { status: "published" } }),
    ]);
    setPosts([...sc.data, ...pub.data].filter((p) => p.scheduled_time));
  };
  useEffect(() => { load(); }, []);

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
    </div>
  );
}
