import { useLayoutEffect, useState } from "react";

// A slide can carry a freeform `elements` array instead of (alongside) its
// fixed template fields (title/heading/body/...). Every element is
// positioned as a percentage of the card box — 0-100 on x/y/w/h — so the
// same numbers render identically at any card size (a 68px strip thumbnail,
// a 380px preview, or a 2x PNG export) without unit conversion.
const genId = () => `el_${Math.random().toString(36).slice(2, 9)}`;

// Font sizes, unlike positions, are plain px — VisualCard multiplies them by
// its `scale` prop, which only lines up with the authored design when it is
// the card's real width over this reference width.
export const CARD_REF_WIDTH = 440;

// The scale a VisualCard should render at to fill `ref`'s box exactly.
// Hardcoding it (the canvas used to pass 0.86 into a 200px-wide box) draws
// every element about twice its authored size, so text overruns the box it
// was measured into and the card clips it.
export function useCardScale(ref, fallback = 1) {
  const [scale, setScale] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const width = el.getBoundingClientRect().width;
      if (width) setScale(width / CARD_REF_WIDTH);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return scale ?? fallback;
}

export function elementBoxStyle(el) {
  return {
    position: "absolute",
    left: `${el.x}%`, top: `${el.y}%`,
    width: `${el.w}%`, height: `${el.h}%`,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    opacity: el.opacity ?? 1,
  };
}

// Turns a template-based spec into an equivalent freeform layout, so
// "customize this layout" has something sane to start from instead of a
// blank card. Only ever runs once, the moment a slide enters edit mode —
// after that the elements array is the source of truth for that slide.
export function elementsFromSpec(spec, theme, brand) {
  const displayFont = brand?.fonts?.display || "Inter";
  const bodyFont = brand?.fonts?.body || "Inter";
  const fg = theme?.fg || "#FFFFFF";
  const sub = theme?.sub || "#a1a1aa";
  const PAD = 8;
  const fullW = 100 - PAD * 2;
  const mk = (over) => ({ id: genId(), rotation: 0, opacity: 1, align: "left", lineHeight: 1.2, fontWeight: 600, ...over });
  const t = spec?.template;

  if (t === "quote") {
    return [
      mk({ type: "text", text: spec.quote || "", x: PAD, y: 30, w: fullW, h: 40, fontFamily: displayFont, fontSize: 26, fontWeight: 700, color: fg, lineHeight: 1.25 }),
      mk({ type: "text", text: `— ${spec.author || ""}`, x: PAD, y: 80, w: fullW * 0.7, h: 8, fontFamily: bodyFont, fontSize: 13, fontWeight: 600, color: sub }),
    ];
  }
  if (t === "tweet") {
    return [
      mk({ type: "text", text: `${spec.name || ""}\n${spec.handle || ""}`, x: PAD, y: 8, w: fullW, h: 16, fontFamily: bodyFont, fontSize: 15, fontWeight: 700, color: fg }),
      mk({ type: "text", text: spec.text || "", x: PAD, y: 30, w: fullW, h: 45, fontFamily: bodyFont, fontSize: 20, fontWeight: 500, color: fg, lineHeight: 1.3 }),
    ];
  }
  if (t === "infographic") {
    const pts = spec.points || [];
    const rowH = pts.length ? Math.min(14, 55 / pts.length) : 14;
    return [
      mk({ type: "text", text: spec.title || "", x: PAD, y: 12, w: fullW, h: 16, fontFamily: displayFont, fontSize: 28, fontWeight: 800, color: fg }),
      ...pts.map((p, i) => mk({ type: "text", text: p, x: PAD, y: 34 + i * (rowH + 3), w: fullW, h: rowH, fontFamily: bodyFont, fontSize: 15, fontWeight: 500, color: fg })),
    ];
  }
  // cover / slide
  const isCover = t === "cover";
  const els = [
    mk({
      type: "text", text: isCover ? (spec.title || "") : (spec.heading || ""),
      x: PAD, y: isCover ? 40 : 34, w: fullW, h: isCover ? 30 : 20,
      fontFamily: displayFont, fontSize: isCover ? 32 : 24, fontWeight: 800, color: fg, lineHeight: 1.1,
    }),
  ];
  if (!isCover && spec.body) {
    els.push(mk({ type: "text", text: spec.body, x: PAD, y: 56, w: fullW, h: 22, fontFamily: bodyFont, fontSize: 15, fontWeight: 400, color: sub, lineHeight: 1.4 }));
  }
  return els;
}

export function newElement(type, theme, brand) {
  const base = { id: genId(), x: 20, y: 40, rotation: 0, opacity: 1 };
  if (type === "text") return { ...base, type: "text", text: "New text", w: 60, h: 15, fontFamily: brand?.fonts?.body || "Inter", fontSize: 20, fontWeight: 600, color: theme?.fg || "#FFFFFF", align: "left", lineHeight: 1.2 };
  if (type === "logo") return { ...base, type: "image", url: brand?.logo_url || "", w: 20, h: 20, fit: "contain" };
  if (type === "image") return { ...base, type: "image", url: "", w: 40, h: 30, fit: "cover" };
  // A video behaves like an image with a grade: same box, same handles, so a
  // scene can carry several of them (a cutaway over a background plate, a
  // picture-in-picture) instead of the one full-bleed clip it used to.
  if (type === "video") return { ...base, type: "video", url: "", w: 50, h: 35, fit: "cover", effects: {} };
  return { ...base, type: "shape", shape: "rect", w: 30, h: 20, color: theme?.accent || "#E2FF3D" };
}

export const MIN_SIZE = 6; // percent — an element can't be resized smaller than this
