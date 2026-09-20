import { useState } from "react";
import { X, Plus, Trash2, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// The review step between a build coming back and anything being generated
// from it. A reel had this first, and for the obvious reason: it used to go
// straight from a topic to a fully recorded, fully shot reel, with no chance
// to see the scene-by-scene script, fix a line, drop a scene or add one,
// before three API calls per scene had already spent themselves.
//
// Every other format had the same problem in a quieter form — a carousel's
// slides and its per-slide image prompts were decided and applied without
// ever being shown — so this now serves them all. What changes per format is
// only the vocabulary: a reel reviews SCENES whose visual is footage, a deck
// reviews SLIDES whose visual is a generated image.
//
// `rows` is the raw plan, already expanded with any intro/outro scenes
// ComposerReelOptions asked for. Each row carries `_origIndex` (which asset
// of the plan it came from, absent for a row added here) and `_template`, so
// a deck's cover — which has a title and no body — is edited as the one
// field it actually has instead of an empty heading/body pair.
// `includeVoiceover` hides the then-unused voiceover field rather than just
// disabling it, so the review matches what is about to happen.

const COPY = {
  scene: {
    unit: "scene", units: "scenes", eyebrow: "Review the script",
    headingPlaceholder: "On-screen text…",
    bodyPlaceholder: "Voiceover line…",
    visualPlaceholder: "Visual idea — what's on screen…",
    blurb: "Edit any line, drop a scene, or add one — nothing records or shoots until you continue.",
  },
  slide: {
    unit: "slide", units: "slides", eyebrow: "Review the slides",
    headingPlaceholder: "Heading…",
    bodyPlaceholder: "Body copy…",
    visualPlaceholder: "Image idea — what this slide shows…",
    blurb: "Edit any slide, drop one, or add one — nothing is generated until you continue.",
  },
};

export function ComposerBuildReview({
  title, rows: initialRows, kind = "scene", includeVoiceover = true, onConfirm, onCancel, confirming,
}) {
  const [rows, setRows] = useState(initialRows);
  const copy = COPY[kind] || COPY.scene;
  // A scene's visual is footage (video_prompt); a slide's is a still
  // (image_prompt). Same field on screen, different key on the spec.
  const promptKey = kind === "scene" ? "video_prompt" : "image_prompt";

  const setRow = (i, patch) => setRows((s) => s.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i) => setRows((s) => s.filter((_, idx) => idx !== i));
  const addRow = () => setRows((s) => [...s, { heading: "", body: "", [promptKey]: "" }]);

  const canConfirm = rows.length > 0 && rows.every((r) => (r.heading || "").trim() || (r.body || "").trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" data-testid="composer-build-review">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-white/10 bg-[#121212] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">{copy.eyebrow}</div>
            <h2 className="mt-1 font-display text-lg font-semibold">{title || "Untitled post"}</h2>
            <p className="mt-1 text-xs text-zinc-500">{copy.blurb}</p>
          </div>
          <button onClick={onCancel} data-testid="composer-build-review-cancel"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-zinc-500 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
          {rows.map((r, i) => {
            const isCover = r._template === "cover";
            return (
              <div key={i} className="rounded-lg border border-white/10 bg-[#0A0A0A] p-3" data-testid={`composer-build-review-row-${i}`}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">
                    {isCover ? "Cover" : `${copy.unit} ${isCover ? i : i + 1}`}
                  </span>
                  <button onClick={() => removeRow(i)} data-testid={`composer-build-review-remove-${i}`}
                    className="text-zinc-600 hover:text-magic" title={`Remove this ${copy.unit}`}>
                    <Trash2 size={13} />
                  </button>
                </div>
                <input value={r.heading || ""} onChange={(e) => setRow(i, { heading: e.target.value })}
                  placeholder={isCover ? "Cover title…" : copy.headingPlaceholder}
                  data-testid={`composer-build-review-heading-${i}`}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-[#121212] px-2.5 py-1.5 text-sm font-medium text-white outline-none focus:border-lime placeholder:text-zinc-600" />
                {/* A cover carries a title and nothing else, so there is no
                    body field to offer for it. */}
                {!isCover && (kind === "slide" || includeVoiceover) && (
                  <textarea value={r.body || ""} onChange={(e) => setRow(i, { body: e.target.value })} rows={2}
                    placeholder={copy.bodyPlaceholder} data-testid={`composer-build-review-body-${i}`}
                    className="mt-1.5 w-full resize-none rounded-lg border border-white/10 bg-[#121212] px-2.5 py-1.5 text-xs text-zinc-300 outline-none focus:border-lime placeholder:text-zinc-600" />
                )}
                <input value={r[promptKey] || ""} onChange={(e) => setRow(i, { [promptKey]: e.target.value })}
                  placeholder={copy.visualPlaceholder} data-testid={`composer-build-review-visual-${i}`}
                  className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#121212] px-2.5 py-1.5 text-xs text-zinc-500 outline-none focus:border-lime placeholder:text-zinc-700" />
              </div>
            );
          })}
          <button onClick={addRow} data-testid="composer-build-review-add"
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 py-2 text-xs font-medium text-zinc-400 hover:border-lime/40 hover:text-lime">
            <Plus size={13} /> Add {copy.unit}
          </button>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-white/5 pt-4">
          <Button variant="secondary" onClick={onCancel} data-testid="composer-build-review-discard"
            className="rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10">
            Discard
          </Button>
          <Button onClick={() => onConfirm(rows)} disabled={!canConfirm || confirming}
            data-testid="composer-build-review-confirm"
            className="gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover">
            {confirming ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            Looks good — build it
          </Button>
        </div>
      </div>
    </div>
  );
}
