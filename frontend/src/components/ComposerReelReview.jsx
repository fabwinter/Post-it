import { useState } from "react";
import { X, Plus, Trash2, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// The script review step — the thing "Build whole post" for a reel never
// had. It used to go straight from a topic to a fully recorded, fully
// shot reel: no chance to see the scene-by-scene script, fix a line, drop a
// scene, or add one, before three API calls per scene had already spent
// themselves recording and shooting it. This is that chance, between the
// script coming back and any of that spending happening.
//
// `scenes` is [{heading, body, video_prompt}] — the raw script, already
// expanded with any intro/outro scenes ComposerReelOptions asked for.
// `includeVoiceover` hides the (then-unused) voiceover field rather than
// just disabling it, so the review matches what's about to actually happen.
export function ComposerReelReview({ title, scenes, includeVoiceover, onConfirm, onCancel, confirming }) {
  const [rows, setRows] = useState(scenes);

  const setRow = (i, patch) => setRows((s) => s.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i) => setRows((s) => s.filter((_, idx) => idx !== i));
  const addRow = () => setRows((s) => [...s, { heading: "", body: "", video_prompt: "" }]);

  const canConfirm = rows.length > 0 && rows.every((r) => (r.heading || "").trim() || (r.body || "").trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" data-testid="composer-reel-review">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-white/10 bg-[#121212] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">Review the script</div>
            <h2 className="mt-1 font-display text-lg font-semibold">{title || "Untitled reel"}</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Edit any line, drop a scene, or add one — nothing records or shoots until you continue.
            </p>
          </div>
          <button onClick={onCancel} data-testid="composer-reel-review-cancel"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-zinc-500 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
          {rows.map((r, i) => (
            <div key={i} className="rounded-lg border border-white/10 bg-[#0A0A0A] p-3" data-testid={`composer-reel-review-scene-${i}`}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">Scene {i + 1}</span>
                <button onClick={() => removeRow(i)} data-testid={`composer-reel-review-remove-${i}`}
                  className="text-zinc-600 hover:text-magic" title="Remove this scene">
                  <Trash2 size={13} />
                </button>
              </div>
              <input value={r.heading || ""} onChange={(e) => setRow(i, { heading: e.target.value })}
                placeholder="On-screen text…" data-testid={`composer-reel-review-heading-${i}`}
                className="mt-2 w-full rounded-lg border border-white/10 bg-[#121212] px-2.5 py-1.5 text-sm font-medium text-white outline-none focus:border-lime placeholder:text-zinc-600" />
              {includeVoiceover && (
                <textarea value={r.body || ""} onChange={(e) => setRow(i, { body: e.target.value })} rows={2}
                  placeholder="Voiceover line…" data-testid={`composer-reel-review-body-${i}`}
                  className="mt-1.5 w-full resize-none rounded-lg border border-white/10 bg-[#121212] px-2.5 py-1.5 text-xs text-zinc-300 outline-none focus:border-lime placeholder:text-zinc-600" />
              )}
              <input value={r.video_prompt || ""} onChange={(e) => setRow(i, { video_prompt: e.target.value })}
                placeholder="Visual idea — what's on screen…" data-testid={`composer-reel-review-visual-${i}`}
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#121212] px-2.5 py-1.5 text-xs text-zinc-500 outline-none focus:border-lime placeholder:text-zinc-700" />
            </div>
          ))}
          <button onClick={addRow} data-testid="composer-reel-review-add"
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 py-2 text-xs font-medium text-zinc-400 hover:border-lime/40 hover:text-lime">
            <Plus size={13} /> Add scene
          </button>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-white/5 pt-4">
          <Button variant="secondary" onClick={onCancel} data-testid="composer-reel-review-discard"
            className="rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10">
            Discard
          </Button>
          <Button onClick={() => onConfirm(rows)} disabled={!canConfirm || confirming}
            data-testid="composer-reel-review-confirm"
            className="gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover">
            {confirming ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            Looks good — build it
          </Button>
        </div>
      </div>
    </div>
  );
}
