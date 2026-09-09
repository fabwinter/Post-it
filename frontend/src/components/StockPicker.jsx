import { useEffect, useRef, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Search, Loader2, Image as ImageIcon, Film, Play } from "lucide-react";

// Free stock photos & video (Pexels), searched from wherever a post needs a
// real photo instead of an AI-generated one. `defaultType` opens on photos or
// video; `orientation` narrows results to the aspect the slide actually needs
// (portrait for a 9:16 reel, landscape for 16:9, square otherwise) so results
// aren't a mismatched crop away from unusable.
export function StockPicker({ open, onOpenChange, defaultType = "image", orientation, onSelect }) {
  const [type, setType] = useState(defaultType);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { if (open) { setType(defaultType); setResults([]); setSearched(false); setNotConfigured(false); } }, [open, defaultType]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);

  const search = async (q, t) => {
    const term = (q ?? query).trim();
    if (!term) return;
    setLoading(true); setSearched(true);
    try {
      const { data } = await api.get("/stock/search", { params: { q: term, type: t ?? type, per_page: 30, orientation } });
      setResults(data.results || []);
      setNotConfigured(false);
    } catch (e) {
      const msg = apiErrorMessage(e, "Search failed.");
      if (/not configured/i.test(msg)) setNotConfigured(true);
      else toast.error(msg);
      setResults([]);
    } finally { setLoading(false); }
  };

  const switchType = (t) => { setType(t); if (query.trim()) search(query, t); };

  const pick = (item) => { onSelect(item); onOpenChange(false); };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col border-white/10 bg-[#0A0A0A] p-0 text-white sm:max-w-lg">
        <SheetTitle className="sr-only">Stock media</SheetTitle>
        <div className="border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="font-display text-base font-semibold">Free stock media</span>
            <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">via Pexels</span>
          </div>
          <div className="mt-3 flex gap-1.5">
            <button onClick={() => switchType("image")} data-testid="stock-type-image"
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${type === "image" ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
              <ImageIcon size={13} /> Photos
            </button>
            <button onClick={() => switchType("video")} data-testid="stock-type-video"
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${type === "video" ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
              <Film size={13} /> Video
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} data-testid="stock-query"
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder={`Search free ${type === "video" ? "stock video" : "stock photos"}…`}
              className="flex-1 rounded-lg border border-white/10 bg-[#121212] px-3 py-2.5 text-sm text-white outline-none focus:border-lime placeholder:text-zinc-600" />
            <Button onClick={() => search()} disabled={loading} data-testid="stock-search"
              className="gap-1.5 rounded-lg bg-lime px-3 font-semibold text-[#0A0A0A] hover:bg-lime-hover">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {notConfigured && (
            <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-sm text-zinc-500">
              Stock media isn't connected yet. Add a free <span className="text-zinc-300">PEXELS_API_KEY</span> (see backend/.env.example) to enable this.
            </div>
          )}
          {!notConfigured && !searched && !loading && (
            <div className="flex min-h-[200px] items-center justify-center text-center text-sm text-zinc-600">
              Search millions of free, licensed {type === "video" ? "clips" : "photos"} to drop straight into your post.
            </div>
          )}
          {!notConfigured && searched && !loading && results.length === 0 && (
            <div className="flex min-h-[200px] items-center justify-center text-center text-sm text-zinc-600">No results for that search.</div>
          )}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {results.map((r) => (
              <button key={r.id} onClick={() => pick(r)} data-testid={`stock-result-${r.id}`}
                className="group relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-[#121212] transition-colors hover:border-lime">
                <img src={r.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
                {r.type === "video" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                    <Play size={20} className="text-white drop-shadow" fill="white" />
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5 text-left font-mono text-[9px] text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100">
                  {r.credit}
                </div>
              </button>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
