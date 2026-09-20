import { useRef, useState } from "react";
import { Download, Loader2, X, AlertTriangle, RefreshCw, ScanEye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VisualCard } from "@/components/VisualCard";
import { useCardScale } from "@/lib/slideElements";

// The whole point of this dialog: a rasterised PNG can silently fall back to
// a system font (a webfont that failed to embed — see captureCardPng) while
// looking completely fine as a *file*, just wrong compared to what was on
// screen a second ago. Rather than trust the export blindly, this puts the
// live card and the just-captured PNG next to each other so a font swap is
// obvious before anything is actually saved to disk.
function LiveCard({ spec, brand, aspectCls }) {
  const boxRef = useRef(null);
  const scale = useCardScale(boxRef, 0.45);
  return (
    <div ref={boxRef} className={`${aspectCls} w-full overflow-hidden rounded-lg border border-white/10`}>
      <VisualCard spec={spec} brand={brand} scale={scale} />
    </div>
  );
}

export function PngExportPreview({ preview, asset, brand, aspectCls, onCancel, onConfirm, onRetry }) {
  const [zoomed, setZoomed] = useState(null);
  if (!preview) return null;
  const { mode, loading, error, warning, images } = preview;
  const count = images.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" data-testid="png-export-preview">
      <div className="w-full max-w-2xl rounded-xl border border-white/10 bg-[#121212] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">
              <ScanEye size={12} /> Font fidelity check
            </div>
            <h2 className="mt-1 font-display text-lg font-semibold">
              {mode === "single" ? "Confirm this PNG" : `Confirm ${count || ""} slide${count === 1 ? "" : "s"}`}
            </h2>
          </div>
          <button onClick={onCancel} data-testid="png-export-close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <p className="mt-2 text-xs text-zinc-500">
          {mode === "single"
            ? "Side by side: what's on screen versus the actual exported file. The fonts should match exactly."
            : "The exported file for every slide. Look for any typeface that swapped to a fallback before saving."}
        </p>

        {loading && (
          <div className="mt-6 flex flex-col items-center gap-2 py-10 text-zinc-400" data-testid="png-export-loading">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-xs">Rendering for comparison…</span>
          </div>
        )}

        {!loading && error && (
          <div className="mt-4 flex gap-2 rounded-lg border border-magic/30 bg-magic/5 p-3 text-xs text-magic" data-testid="png-export-error">
            <AlertTriangle size={14} className="mt-0.5 flex-none" />
            <span>{error}</span>
          </div>
        )}

        {/* The file is fine and downloadable — something just isn't in it.
            An image that fails to load draws nothing on the card, so without
            this the only hint would have been the gap itself. */}
        {!loading && !error && warning && (
          <div className="mt-4 flex gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-300" data-testid="png-export-warning">
            <AlertTriangle size={14} className="mt-0.5 flex-none" />
            <span>{warning}</span>
          </div>
        )}

        {!loading && !error && mode === "single" && images[0] && (
          <div className="mt-4 grid grid-cols-2 gap-3" data-testid="png-export-compare">
            <div>
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">On-screen</div>
              <LiveCard spec={asset?.spec} brand={brand} aspectCls={aspectCls} />
            </div>
            <div>
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">Exported PNG</div>
              <div className={`${aspectCls} w-full overflow-hidden rounded-lg border border-white/10 bg-black/20`}>
                <img src={images[0].url} alt="Exported PNG preview" className="h-full w-full object-contain" data-testid="png-export-image" />
              </div>
            </div>
          </div>
        )}

        {!loading && !error && mode === "all" && images.length > 0 && (
          <div className="mt-4 grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4" data-testid="png-export-grid">
            {images.map((img) => (
              <button key={img.index} onClick={() => setZoomed(img)} data-testid={`png-export-thumb-${img.index}`}
                className={`${aspectCls} relative overflow-hidden rounded-lg border border-white/10 bg-black/20 hover:border-lime/50`}>
                <img src={img.url} alt={`Slide ${img.index + 1} preview`} className="h-full w-full object-contain" />
                <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[9px] text-zinc-300">
                  {img.index + 1}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {!loading && !error && (
            <Button onClick={onConfirm} data-testid="png-export-confirm"
              className="gap-2 rounded-lg bg-lime font-semibold text-[#0A0A0A] hover:bg-lime-hover">
              <Download size={15} /> {mode === "single" ? "Fonts match — download" : `Fonts match — download ${count > 1 ? "ZIP" : "PNG"}`}
            </Button>
          )}
          {(error || (!loading && !error)) && (
            <Button variant="ghost" onClick={onRetry} data-testid="png-export-retry"
              className="gap-1.5 text-xs text-zinc-400 hover:text-white">
              <RefreshCw size={13} /> {error ? "Try again" : "Re-render"}
            </Button>
          )}
          <Button variant="ghost" onClick={onCancel} data-testid="png-export-cancel"
            className="text-xs text-zinc-400 hover:text-white">Cancel</Button>
        </div>
      </div>

      {zoomed && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-6" onClick={() => setZoomed(null)}
          data-testid="png-export-zoom">
          <img src={zoomed.url} alt={`Slide ${zoomed.index + 1}`} className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  );
}
