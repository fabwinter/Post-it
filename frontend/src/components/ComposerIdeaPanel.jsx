import { useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Sparkles, Loader2, Zap } from "lucide-react";

// Folded in from the old Dashboard's "Idea engine" card — a broad topic in,
// a handful of angles out. Each idea drops into the brief below (onUseIdea)
// or skips straight to a finished post (onBuildIdea), the same two actions
// the Dashboard offered before Composer became the one place posts start.
export function ComposerIdeaPanel({ model, onUseIdea, onBuildIdea, buildingIndex }) {
  const [topic, setTopic] = useState("");
  const [ideas, setIdeas] = useState([]);
  const [loading, setLoading] = useState(false);

  const ideate = async () => {
    if (!topic.trim()) return;
    setLoading(true);
    setIdeas([]);
    try {
      const { data } = await api.post("/ai/ideate", { topic, count: 6, model });
      setIdeas(data.ideas);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't generate ideas."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div data-testid="composer-idea-panel">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ideate()}
          placeholder="Broad topic — get a few angles to start from…"
          data-testid="composer-idea-topic"
          className="min-w-[180px] flex-1 rounded-lg border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm outline-none focus:border-iris"
        />
        <Button onClick={ideate} disabled={loading} data-testid="composer-idea-generate"
          className="h-9 gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-semibold text-white hover:bg-white/10">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Ideate
        </Button>
      </div>
      {ideas.length > 0 && (
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {ideas.map((idea, i) => (
            <div key={i} data-testid={`idea-item-${i}`}
              className="group flex items-center gap-2 rounded-lg border border-white/10 bg-[#0A0A0A] p-2.5">
              <button onClick={() => onUseIdea(idea)} data-testid={`idea-open-${i}`}
                className="flex-1 text-left text-xs text-zinc-300">
                {idea}
              </button>
              <button onClick={() => onBuildIdea(idea, i)} disabled={buildingIndex !== null} data-testid={`idea-build-${i}`}
                className="flex flex-shrink-0 items-center gap-1 rounded-md border border-lime/30 bg-lime/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-lime transition-colors hover:bg-lime/20 disabled:opacity-40">
                {buildingIndex === i ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />} Build
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
