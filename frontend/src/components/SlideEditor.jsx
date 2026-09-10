import { useRef } from "react";
import { VisualCard } from "@/components/VisualCard";
import { elementBoxStyle, MIN_SIZE } from "@/lib/slideElements";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
const angleOf = (a, b) => (Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180) / Math.PI;

// A freeform slide's live preview, with drag-to-move, a resize handle, a
// rotate handle (mouse/desktop), and two-finger pinch (scale + rotate
// together — the natural mobile gesture) on whichever element is selected.
// VisualCard underneath renders the actual pixels; this overlays one
// invisible hit-box per element, in the same percentage coordinate space
// (lib/slideElements.js), purely for gesture handling.
export function SlideEditor({ spec, brand, selectedId, onSelect, onChangeElement, aspectCls, cardRef }) {
  const containerRef = useRef(null);
  const dragState = useRef(null);
  const pinchState = useRef(null);

  const pct = (clientX, clientY) => {
    const rect = containerRef.current.getBoundingClientRect();
    return { x: ((clientX - rect.left) / rect.width) * 100, y: ((clientY - rect.top) / rect.height) * 100 };
  };

  const beginDrag = (e, el, mode) => {
    e.stopPropagation();
    onSelect(el.id);
    dragState.current = { mode, id: el.id, start: pct(e.clientX, e.clientY), startEl: { ...el } };
    e.target.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    const ds = dragState.current;
    if (!ds) return;
    const cur = pct(e.clientX, e.clientY);
    const dx = cur.x - ds.start.x, dy = cur.y - ds.start.y;
    if (ds.mode === "move") {
      onChangeElement(ds.id, {
        x: clamp(ds.startEl.x + dx, 0, 100 - ds.startEl.w),
        y: clamp(ds.startEl.y + dy, 0, 100 - ds.startEl.h),
      });
    } else if (ds.mode === "resize") {
      onChangeElement(ds.id, {
        w: clamp(ds.startEl.w + dx, MIN_SIZE, 100 - ds.startEl.x),
        h: clamp(ds.startEl.h + dy, MIN_SIZE, 100 - ds.startEl.y),
      });
    } else if (ds.mode === "rotate") {
      const cx = ds.startEl.x + ds.startEl.w / 2, cy = ds.startEl.y + ds.startEl.h / 2;
      const deg = Math.atan2(cur.y - cy, cur.x - cx) * (180 / Math.PI) + 90;
      onChangeElement(ds.id, { rotation: Math.round(deg) });
    }
  };
  const endDrag = () => { dragState.current = null; };

  // Two-finger pinch scales + rotates the currently selected element — the
  // primary mobile gesture; the resize/rotate handles above are its desktop
  // (single-pointer) equivalent.
  const onTouchStart = (e) => {
    if (e.touches.length !== 2 || !selectedId) return;
    const el = (spec.elements || []).find((x) => x.id === selectedId);
    if (!el) return;
    const [t1, t2] = e.touches;
    pinchState.current = { id: selectedId, startEl: { ...el }, startDist: dist(t1, t2), startAngle: angleOf(t1, t2) };
  };
  const onTouchMove = (e) => {
    const ps = pinchState.current;
    if (!ps || e.touches.length !== 2) return;
    e.preventDefault();
    const [t1, t2] = e.touches;
    const scale = dist(t1, t2) / (ps.startDist || 1);
    const rot = (ps.startEl.rotation || 0) + (angleOf(t1, t2) - ps.startAngle);
    const cx = ps.startEl.x + ps.startEl.w / 2, cy = ps.startEl.y + ps.startEl.h / 2;
    const w = clamp(ps.startEl.w * scale, MIN_SIZE, 100), h = clamp(ps.startEl.h * scale, MIN_SIZE, 100);
    onChangeElement(ps.id, { w, h, x: clamp(cx - w / 2, 0, 100 - w), y: clamp(cy - h / 2, 0, 100 - h), rotation: Math.round(rot) });
  };
  const onTouchEnd = (e) => { if (e.touches.length < 2) pinchState.current = null; };

  return (
    <div ref={containerRef} className={`relative ${aspectCls} w-full select-none overflow-hidden rounded-xl`}
      style={{ touchAction: "none" }}
      onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
      onPointerDown={() => onSelect(null)} data-testid="slide-editor-canvas">
      <div ref={cardRef} className="absolute inset-0">
        <VisualCard spec={spec} brand={brand} scale={0.86} />
      </div>
      {(spec.elements || []).map((el) => {
        const box = elementBoxStyle(el);
        const selected = el.id === selectedId;
        return (
          <div key={el.id} data-testid={`slide-element-${el.id}`}
            onPointerDown={(e) => beginDrag(e, el, "move")}
            style={{ ...box, cursor: "move", boxSizing: "border-box", border: selected ? "1.5px solid #E2FF3D" : "1.5px dashed transparent" }}>
            {selected && (
              <>
                <div data-testid={`slide-element-resize-${el.id}`}
                  onPointerDown={(e) => beginDrag(e, el, "resize")}
                  className="absolute -bottom-2 -right-2 h-4 w-4 rounded-full border-2 border-[#0A0A0A] bg-lime"
                  style={{ cursor: "nwse-resize" }} />
                <div data-testid={`slide-element-rotate-${el.id}`}
                  onPointerDown={(e) => beginDrag(e, el, "rotate")}
                  className="absolute -top-5 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-[#0A0A0A] bg-lime"
                  style={{ cursor: "grab" }} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
