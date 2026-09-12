import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  X, Plus, Undo2, Redo2, Type, Image as ImageIcon, Square, Search, Shapes, Upload,
  Palette, Copy, Trash2, ChevronsUp, ChevronsDown, RotateCw, CopyPlus, Check, BookmarkPlus,
  AlignLeft, AlignCenter, AlignRight, Baseline, Droplets, Crop, LayoutTemplate, Layers,
} from "lucide-react";
import { VisualCard, ASPECT_RATIO } from "@/components/VisualCard";
import { SlideEditor } from "@/components/SlideEditor";
import { BRAND_FONTS, groupFontsByCategory, fontStack, useAllFontsLoaded } from "@/lib/fonts";
import { Button } from "@/components/ui/button";

// The card is sized to the biggest it can be inside the stage while keeping
// its aspect — the whole point of this mode is that the slide you are
// editing is the largest thing on screen, not a 200px thumbnail wedged
// beside its own controls.
function useStageCard(stageRef, ratio) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const w = Math.min(r.width, r.height / ratio);
      setBox({ w: Math.floor(w), h: Math.floor(w * ratio) });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, [stageRef, ratio]);
  return box;
}

// One tool-rail button. 56px tall and at least 56px wide so it clears the
// 44px minimum touch target on a phone with room to spare, and so the rail
// can be thumbed along without hitting a neighbour.
const Tool = ({ icon: Icon, label, onClick, active, danger, testid, disabled }) => (
  <button onClick={onClick} disabled={disabled} data-testid={testid}
    className={`flex h-14 min-w-[56px] flex-shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-2 text-[10px] font-medium transition-colors disabled:opacity-30 lg:w-full ${
      active ? "bg-lime/15 text-lime" : danger ? "text-zinc-400 hover:bg-white/5 hover:text-magic" : "text-zinc-300 hover:bg-white/5 hover:text-white"
    }`}>
    <Icon size={18} />
    <span className="leading-none">{label}</span>
  </button>
);

// A tool's controls, docked above the rail. On a phone this is the only
// place property controls appear, so it stays finger-sized (inputs are h-10
// and up) rather than reusing the desktop panel's dense 7px-tall rows.
const Sheet = ({ title, onClose, children, testid }) => (
  <div data-testid={testid}
    className="order-2 flex-shrink-0 border-t border-white/10 bg-[#121212] px-3 pb-3 pt-2 lg:order-last lg:w-72 lg:overflow-y-auto lg:border-l lg:border-t-0 lg:p-4">
    <div className="mb-2 flex items-center justify-between">
      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">{title}</span>
      <button onClick={onClose} data-testid="canvas-sheet-close" className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:text-white">
        <Check size={15} />
      </button>
    </div>
    {children}
  </div>
);

const SWATCHES = ["#FFFFFF", "#0A0A0A", "#E2FF3D", "#7C5CFF", "#FF4D8D", "#3DDC97", "#FFB020", "#5AC8FA"];

// A colour row: the brand's own colours and a few staples one tap away,
// with the native picker behind the last chip for anything else.
const ColorRow = ({ value, onChange, brand, testid }) => {
  const brandColors = [brand?.colors?.primary, brand?.colors?.secondary, brand?.colors?.accent, brand?.colors?.bg, brand?.colors?.text].filter(Boolean);
  const swatches = [...new Set([...brandColors, ...SWATCHES])].slice(0, 12);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={testid}>
      {swatches.map((c) => (
        <button key={c} onClick={() => onChange(c)} title={c} data-testid={`canvas-swatch-${c.replace("#", "")}`}
          className={`h-9 w-9 rounded-full border-2 transition-transform hover:scale-110 ${(value || "").toLowerCase() === c.toLowerCase() ? "border-lime" : "border-white/15"}`}
          style={{ background: c }} />
      ))}
      <label className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-2 border-dashed border-white/25 text-zinc-400 hover:text-white">
        <Palette size={14} />
        <input type="color" value={value || "#FFFFFF"} onChange={(e) => onChange(e.target.value)}
          data-testid={`${testid}-custom`} className="h-0 w-0 opacity-0" />
      </label>
    </div>
  );
};

const Slider = ({ label, value, min, max, step, onChange, suffix = "", testid }) => (
  <label className="flex items-center gap-3">
    <span className="w-14 flex-shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-zinc-500">{label}</span>
    <input type="range" min={min} max={max} step={step} value={value} data-testid={testid}
      onChange={(e) => onChange(Number(e.target.value))} className="h-10 min-w-0 flex-1 accent-lime" />
    <span className="w-12 flex-shrink-0 text-right font-mono text-xs text-zinc-400">{Math.round(value)}{suffix}</span>
  </label>
);

// A full-screen editing surface for one slide: the card fills the viewport,
// every tool is a thumb-sized button on a rail along the bottom, and the
// controls for whatever is selected open in a sheet just above that rail.
// The Composer's inline canvas keeps working as before — this is the mode
// you switch into to actually lay a slide out, especially on a phone or
// tablet where the inline canvas+sidebar split has no room to be usable.
export function CanvasEditor({
  spec, brand, aspect, aspectCls, cardRef, slideCount, activeIndex, onSelectSlide, onAddSlide, onDuplicateSlide,
  selectedId, onSelect, onChangeElement, onAdd, onRemove, onDuplicate, onReorder,
  onAddStock, onBrowseStock, onApplyAll, onOpenLibrary, onSaveToLibrary, onChangeBg, bgColor,
  onEnterLayoutEdit, onClose, onUndo, onRedo, canUndo, canRedo, slides,
}) {
  useAllFontsLoaded();
  const stageRef = useRef(null);
  const ratio = ASPECT_RATIO[aspect] || 1;
  const card = useStageCard(stageRef, ratio);
  const [sheet, setSheet] = useState(null);
  const elements = spec.elements || null;
  const el = elements ? elements.find((x) => x.id === selectedId) : null;

  // Escape backs out one level — sheet first, then the editor itself, which
  // is what a full-screen mode is expected to do on a keyboard.
  useEffect(() => {
    const onKey = (e) => {
      // The stock picker and elements library open over this editor and
      // take Escape for themselves; without this guard one Escape closes
      // both the picker and the whole canvas.
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === "Escape") { if (sheet) setSheet(null); else if (selectedId) onSelect(null); else onClose(); return; }
      if (!el || e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
      const step = e.shiftKey ? 5 : 1;
      const nudge = { ArrowLeft: { x: -step }, ArrowRight: { x: step }, ArrowUp: { y: -step }, ArrowDown: { y: step } }[e.key];
      if (nudge) {
        e.preventDefault();
        onChangeElement(el.id, {
          x: Math.max(0, Math.min(100 - el.w, el.x + (nudge.x || 0))),
          y: Math.max(0, Math.min(100 - el.h, el.y + (nudge.y || 0))),
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [el, sheet, selectedId, onSelect, onChangeElement, onClose]);

  // Nothing behind the editor should scroll while it owns the screen, and
  // the app's toasts (top-right, same corner as Undo/Redo/Duplicate/Done)
  // need to move below the header so they can't eat a click meant for one
  // of those buttons — see the .canvas-editor-open rule in index.css.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("canvas-editor-open");
    return () => {
      document.body.style.overflow = prev;
      document.body.classList.remove("canvas-editor-open");
    };
  }, []);

  const patch = (p) => el && onChangeElement(el.id, p);
  const openSheet = (k) => setSheet((s) => (s === k ? null : k));

  const fontOptions = brand?.fonts?.display && !BRAND_FONTS.some((f) => f.key === brand.fonts.display)
    ? [{ key: brand.fonts.display, label: `${brand.fonts.display} (brand)` }, ...BRAND_FONTS] : BRAND_FONTS;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#0A0A0A]" data-testid="canvas-editor">
      {/* Top bar */}
      <header className="flex flex-shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
        <button onClick={onClose} data-testid="canvas-editor-close"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white">
          <X size={18} />
        </button>
        <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">
          Slide {activeIndex + 1}<span className="text-zinc-700">/{slideCount}</span>
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={onDuplicateSlide} data-testid="canvas-duplicate-slide" title="Duplicate slide"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white">
            <Copy size={16} />
          </button>
          <button onClick={onUndo} disabled={!canUndo} data-testid="canvas-undo" title="Undo"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white disabled:opacity-30">
            <Undo2 size={16} />
          </button>
          <button onClick={onRedo} disabled={!canRedo} data-testid="canvas-redo" title="Redo"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white disabled:opacity-30">
            <Redo2 size={16} />
          </button>
          <Button onClick={onClose} data-testid="canvas-editor-done"
            className="ml-1 h-9 rounded-lg bg-lime px-4 text-xs font-semibold text-[#0A0A0A] hover:bg-lime-hover">Done</Button>
        </div>
      </header>

      {/* Below the header the screen is one flex box that flips direction:
          a phone stacks stage → sheet → rail top to bottom, while a landscape
          tablet or a desktop puts the rail down the left and the sheet down
          the right, so neither eats into the canvas's height. */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="order-first flex min-h-0 flex-1 flex-col lg:order-none">
      {/* Stage */}
      <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3"
        data-testid="canvas-stage">
        {card.w > 0 && (
          <div style={{ width: card.w }} data-testid="canvas-card-box">
            {elements ? (
              <SlideEditor spec={spec} brand={brand} aspectCls={aspectCls} cardRef={cardRef}
                selectedId={selectedId} onSelect={onSelect} onChangeElement={onChangeElement} />
            ) : (
              <div className={`${aspectCls} relative w-full overflow-hidden rounded-xl`}>
                <div ref={cardRef} className="h-full w-full">
                  <VisualCard spec={spec} brand={brand} scale={card.w / 440} />
                </div>
                <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/70 to-transparent p-4">
                  <Button onClick={onEnterLayoutEdit} data-testid="canvas-enter-layout-edit"
                    className="h-11 gap-2 rounded-xl bg-lime px-5 text-sm font-semibold text-[#0A0A0A] hover:bg-lime-hover">
                    <LayoutTemplate size={16} /> Customize layout
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Slide strip — jumping between slides without leaving the canvas is
          what makes this usable for a deck rather than a single graphic. */}
      {slideCount > 1 && (
        <div className="flex flex-shrink-0 gap-2 overflow-x-auto border-t border-white/10 px-3 py-2 [&::-webkit-scrollbar]:hidden"
          data-testid="canvas-slide-strip">
          {(slides || []).map((a, i) => (
            <button key={i} onClick={() => onSelectSlide(i)} data-testid={`canvas-slide-${i}`}
              className={`relative flex-shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${i === activeIndex ? "border-lime" : "border-white/10"}`}
              style={{ width: 44 }}>
              <div className={`${aspectCls} w-full`}>
                <VisualCard spec={a.spec} brand={brand} scale={44 / 440} />
              </div>
            </button>
          ))}
          <button onClick={onAddSlide} data-testid="canvas-add-slide"
            className={`flex ${aspectCls} w-11 flex-shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-white/15 text-zinc-600 hover:border-lime/40 hover:text-lime`}>
            <Plus size={14} />
          </button>
        </div>
      )}
      {elements && !el && (
        <p className="flex-shrink-0 pb-1.5 pt-1 text-center text-[10px] text-zinc-600" data-testid="canvas-hint">
          Tap an element to select it · drag to move · pinch to scale &amp; rotate
        </p>
      )}
      </div>

      {/* Tool sheet */}
      {elements && sheet === "add" && (
        <Sheet title="Add to slide" onClose={() => setSheet(null)} testid="canvas-sheet-add">
          <div className="flex flex-wrap gap-2">
            {[{ t: "text", I: Type, l: "Text" }, { t: "image", I: ImageIcon, l: "Image" }, { t: "logo", I: Upload, l: "Logo" }, { t: "shape", I: Square, l: "Shape" }].map(({ t, I, l }) => (
              <Button key={t} variant="secondary" onClick={() => { onAdd(t); setSheet(null); }} data-testid={`canvas-add-${t}`}
                className="h-10 gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white hover:bg-white/10">
                <I size={14} /> {l}
              </Button>
            ))}
            <Button variant="secondary" onClick={() => { onAddStock(); setSheet(null); }} data-testid="canvas-add-stock"
              className="h-10 gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white hover:bg-white/10">
              <Search size={14} /> Stock photo
            </Button>
            <Button variant="secondary" onClick={() => { onOpenLibrary(); setSheet(null); }} data-testid="canvas-add-library"
              className="h-10 gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white hover:bg-white/10">
              <Shapes size={14} /> Library
            </Button>
          </div>
        </Sheet>
      )}

      {elements && sheet === "bg" && onChangeBg && (
        <Sheet title="Slide background" onClose={() => setSheet(null)} testid="canvas-sheet-bg">
          <ColorRow value={bgColor} onChange={onChangeBg} brand={brand} testid="canvas-bg-color" />
        </Sheet>
      )}

      {el && sheet === "text" && (
        <Sheet title="Text" onClose={() => setSheet(null)} testid="canvas-sheet-text">
          <textarea value={el.text || ""} onChange={(e) => patch({ text: e.target.value })} rows={3} autoFocus
            data-testid="canvas-element-text"
            className="w-full resize-none rounded-xl border border-white/10 bg-[#0A0A0A] px-3 py-2.5 text-sm text-white outline-none focus:border-lime" />
        </Sheet>
      )}

      {el && sheet === "font" && (
        <Sheet title="Font" onClose={() => setSheet(null)} testid="canvas-sheet-font">
          <select value={el.fontFamily || "Inter"} onChange={(e) => patch({ fontFamily: e.target.value })} data-testid="canvas-element-font"
            className="h-10 w-full rounded-xl border border-white/10 bg-[#0A0A0A] px-3 text-sm text-white outline-none [color-scheme:dark]"
            style={{ fontFamily: fontStack(el.fontFamily || "Inter") }}>
            {groupFontsByCategory(fontOptions).map(({ category, fonts }) => (
              <optgroup key={category} label={category}>
                {fonts.map((f) => <option key={f.key} value={f.key} style={{ fontFamily: fontStack(f.key) }}>{f.label || f.key}</option>)}
              </optgroup>
            ))}
          </select>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[400, 500, 600, 700, 800, 900].map((w) => (
              <button key={w} onClick={() => patch({ fontWeight: w })} data-testid={`canvas-weight-${w}`}
                className={`h-9 min-w-[44px] rounded-lg border px-2 text-xs ${(el.fontWeight || 600) === w ? "border-lime text-lime" : "border-white/10 text-zinc-400"}`}
                style={{ fontWeight: w }}>{w}</button>
            ))}
          </div>
        </Sheet>
      )}

      {el && sheet === "size" && (
        <Sheet title="Size & spacing" onClose={() => setSheet(null)} testid="canvas-sheet-size">
          <Slider label="Size" min={8} max={120} step={1} value={el.fontSize || 16}
            onChange={(v) => patch({ fontSize: v })} testid="canvas-element-size" />
          <div className="mt-1">
            {/* Line height rides the slider as a percentage (80-240) because
                a 0.05 step on a 0.8-2.4 range is unhittable with a thumb. */}
            <Slider label="Leading" min={80} max={240} step={5} value={(el.lineHeight ?? 1.2) * 100}
              onChange={(v) => patch({ lineHeight: Number((v / 100).toFixed(2)) })} suffix="%" testid="canvas-element-leading" />
          </div>
        </Sheet>
      )}

      {el && sheet === "color" && (
        <Sheet title={el.type === "text" ? "Text colour" : "Fill"} onClose={() => setSheet(null)} testid="canvas-sheet-color">
          <ColorRow value={el.color} onChange={(c) => patch({ color: c })} brand={brand} testid="canvas-element-color" />
        </Sheet>
      )}

      {el && sheet === "align" && (
        <Sheet title="Alignment" onClose={() => setSheet(null)} testid="canvas-sheet-align">
          <div className="flex gap-2">
            {[{ v: "left", I: AlignLeft }, { v: "center", I: AlignCenter }, { v: "right", I: AlignRight }].map(({ v, I }) => (
              <button key={v} onClick={() => patch({ align: v })} data-testid={`canvas-align-${v}`}
                className={`flex h-10 flex-1 items-center justify-center rounded-xl border ${(el.align || "left") === v ? "border-lime text-lime" : "border-white/10 text-zinc-400"}`}>
                <I size={16} />
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {el && sheet === "image" && (
        <Sheet title="Image" onClose={() => setSheet(null)} testid="canvas-sheet-image">
          <div className="flex gap-2">
            <input value={el.url || ""} onChange={(e) => patch({ url: e.target.value })} placeholder="Image URL"
              data-testid="canvas-element-url"
              className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-[#0A0A0A] px-3 text-xs text-zinc-300 outline-none focus:border-lime" />
            <Button variant="secondary" onClick={() => { onBrowseStock(); setSheet(null); }} data-testid="canvas-element-browse-stock"
              className="h-10 flex-shrink-0 gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white hover:bg-white/10">
              <Search size={14} /> Browse
            </Button>
          </div>
          <div className="mt-2 flex gap-2">
            {["cover", "contain"].map((f) => (
              <button key={f} onClick={() => patch({ fit: f })} data-testid={`canvas-fit-${f}`}
                className={`h-9 flex-1 rounded-xl border text-xs ${(el.fit || "cover") === f ? "border-lime text-lime" : "border-white/10 text-zinc-400"}`}>{f}</button>
            ))}
          </div>
        </Sheet>
      )}

      {el && sheet === "shape" && (
        <Sheet title="Shape" onClose={() => setSheet(null)} testid="canvas-sheet-shape">
          <div className="flex gap-2">
            {["rect", "ellipse"].map((s) => (
              <button key={s} onClick={() => patch({ shape: s })} data-testid={`canvas-shape-${s}`}
                className={`h-9 flex-1 rounded-xl border text-xs ${(el.shape || "rect") === s ? "border-lime text-lime" : "border-white/10 text-zinc-400"}`}>{s}</button>
            ))}
          </div>
        </Sheet>
      )}

      {el && sheet === "opacity" && (
        <Sheet title="Opacity & rotation" onClose={() => setSheet(null)} testid="canvas-sheet-opacity">
          <Slider label="Opacity" min={0} max={100} step={5} value={(el.opacity ?? 1) * 100}
            onChange={(v) => patch({ opacity: v / 100 })} suffix="%" testid="canvas-element-opacity" />
          <div className="mt-1">
            <Slider label="Rotate" min={-180} max={180} step={1} value={el.rotation || 0}
              onChange={(v) => patch({ rotation: v })} suffix="°" testid="canvas-element-rotation" />
          </div>
        </Sheet>
      )}

      {el && sheet === "layer" && (
        <Sheet title="Arrange" onClose={() => setSheet(null)} testid="canvas-sheet-layer">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => onReorder(el.id, "front")} data-testid="canvas-bring-front"
              className="h-10 gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white hover:bg-white/10">
              <ChevronsUp size={14} /> Bring to front
            </Button>
            <Button variant="secondary" onClick={() => onReorder(el.id, "back")} data-testid="canvas-send-back"
              className="h-10 gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white hover:bg-white/10">
              <ChevronsDown size={14} /> Send to back
            </Button>
            {slideCount > 1 && (
              <Button variant="secondary" onClick={() => onApplyAll(el.id)} data-testid="canvas-apply-all"
                className="h-10 gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white hover:bg-white/10">
                <CopyPlus size={14} /> Apply to all slides
              </Button>
            )}
            {onSaveToLibrary && (
              <Button variant="secondary" onClick={() => onSaveToLibrary(el.id)} data-testid="canvas-save-library"
                className="h-10 gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white hover:bg-white/10">
                <BookmarkPlus size={14} /> Save to library
              </Button>
            )}
          </div>
        </Sheet>
      )}

      {/* Tool rail — the contextual half (what you can do to the selected
          element) replaces the add half, the way a mobile design app swaps
          its bottom bar the moment something is selected. */}
      {elements && (
        <div data-testid="canvas-toolbar"
          className="order-last flex flex-shrink-0 items-center gap-1 overflow-x-auto border-t border-white/10 bg-[#0A0A0A] px-2 py-1.5 [&::-webkit-scrollbar]:hidden lg:order-first lg:w-[76px] lg:flex-col lg:items-stretch lg:overflow-x-hidden lg:overflow-y-auto lg:border-r lg:border-t-0 lg:px-1.5 lg:py-2">
          {el ? (
            <>
              <Tool icon={X} label="Deselect" onClick={() => { onSelect(null); setSheet(null); }} testid="canvas-tool-deselect" />
              {el.type === "text" && <Tool icon={Type} label="Text" active={sheet === "text"} onClick={() => openSheet("text")} testid="canvas-tool-text" />}
              {el.type === "text" && <Tool icon={Baseline} label="Font" active={sheet === "font"} onClick={() => openSheet("font")} testid="canvas-tool-font" />}
              {el.type === "text" && <Tool icon={Layers} label="Size" active={sheet === "size"} onClick={() => openSheet("size")} testid="canvas-tool-size" />}
              {el.type === "text" && <Tool icon={AlignLeft} label="Align" active={sheet === "align"} onClick={() => openSheet("align")} testid="canvas-tool-align" />}
              {el.type !== "image" && <Tool icon={Palette} label="Colour" active={sheet === "color"} onClick={() => openSheet("color")} testid="canvas-tool-color" />}
              {el.type === "image" && <Tool icon={Crop} label="Image" active={sheet === "image"} onClick={() => openSheet("image")} testid="canvas-tool-image" />}
              {el.type === "shape" && <Tool icon={Square} label="Shape" active={sheet === "shape"} onClick={() => openSheet("shape")} testid="canvas-tool-shape" />}
              <Tool icon={Droplets} label="Opacity" active={sheet === "opacity"} onClick={() => openSheet("opacity")} testid="canvas-tool-opacity" />
              <Tool icon={ChevronsUp} label="Arrange" active={sheet === "layer"} onClick={() => openSheet("layer")} testid="canvas-tool-layer" />
              <Tool icon={Copy} label="Duplicate" onClick={() => onDuplicate(el.id)} testid="canvas-tool-duplicate" />
              <Tool icon={Trash2} label="Delete" danger onClick={() => { onRemove(el.id); setSheet(null); }} testid="canvas-tool-delete" />
            </>
          ) : (
            <>
              <Tool icon={Plus} label="Add" active={sheet === "add"} onClick={() => openSheet("add")} testid="canvas-tool-add" />
              <Tool icon={Type} label="Text" onClick={() => onAdd("text")} testid="canvas-tool-add-text" />
              <Tool icon={ImageIcon} label="Photo" onClick={onAddStock} testid="canvas-tool-add-photo" />
              <Tool icon={Shapes} label="Library" onClick={onOpenLibrary} testid="canvas-tool-library" />
              {onChangeBg && <Tool icon={Palette} label="Background" active={sheet === "bg"} onClick={() => openSheet("bg")} testid="canvas-tool-bg" />}
              <Tool icon={RotateCw} label="Undo" onClick={onUndo} disabled={!canUndo} testid="canvas-tool-undo" />
            </>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
