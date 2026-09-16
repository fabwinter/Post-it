import { useLayoutEffect, useState } from "react";
import { brandLogoUrls } from "@/lib/brandGuideline";

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
  //
  // The two text elements carry the same `role` tags _fill_layout stamps on
  // its own output (server side), because role is how every other part of
  // the app finds a slide's words once elements exist: slideText reads
  // through them, elementsWithText writes through them, templateSlidesPayload
  // sends the edited copy back to a template through them. Untagged, a slide
  // materialized by "Edit layout" looks to all three like a slide with no
  // words at all, and they quietly fall back to the spec.heading/spec.body
  // this very function just froze a copy of — so an edit on the canvas never
  // reaches the voiceover, the template, or anything else downstream.
  const isCover = t === "cover";
  const els = [
    mk({
      type: "text", role: isCover ? "title" : "heading",
      text: isCover ? (spec.title || "") : (spec.heading || ""),
      x: PAD, y: isCover ? 40 : 34, w: fullW, h: isCover ? 30 : 20,
      fontFamily: displayFont, fontSize: isCover ? 32 : 24, fontWeight: 800, color: fg, lineHeight: 1.1,
    }),
  ];
  if (!isCover && spec.body) {
    els.push(mk({ type: "text", role: "body", text: spec.body, x: PAD, y: 56, w: fullW, h: 22, fontFamily: bodyFont, fontSize: 15, fontWeight: 400, color: sub, lineHeight: 1.4 }));
  }
  return els;
}

// Once a slide has freeform elements, THEY are the source of truth for its
// words — spec.heading/spec.body stop being updated the moment "Edit layout"
// materializes them (see enterLayoutEdit in Composer.jsx), and a design
// applied at build time bakes the copy straight into element text
// (_fill_layout, server side). So anything that READS a slide's words has to
// ask the elements first, and anything that WRITES them has to write there
// too — otherwise the two drift and whichever one you're not looking at is
// silently wrong: an edit that never appears on the card, or a voiceover
// recorded from a line nobody can see any more.
const textRoles = { heading: ["title", "heading"], body: ["body"] };

export function slideText(spec) {
  const els = spec?.elements;
  const textOf = (roles) => els?.find((el) => el.type === "text" && roles.includes(el.role))?.text;
  const heading = textOf(textRoles.heading);
  const body = textOf(textRoles.body);
  return {
    heading: heading !== undefined ? heading : (spec?.heading || ""),
    body: body !== undefined ? body : (spec?.body || ""),
  };
}

// The write half of slideText: puts fresh copy back into whichever elements
// hold it, and renumbers the ones whose text is the slide's own position
// (number/step) — a design bakes that in at build time too, so a scene moved
// or removed keeps a stale number without this.
export function elementsWithText(elements, { heading, body, index }) {
  if (!elements) return elements;
  return elements.map((el) => {
    if (el.type !== "text") return el;
    if (textRoles.heading.includes(el.role)) return { ...el, text: heading ?? el.text };
    if (textRoles.body.includes(el.role)) return { ...el, text: body ?? el.text };
    if (el.role === "number" && index != null) return { ...el, text: String(index) };
    if (el.role === "step" && index != null) return { ...el, text: `STEP ${index}` };
    return el;
  });
}

export function newElement(type, theme, brand) {
  const base = { id: genId(), x: 20, y: 40, rotation: 0, opacity: 1 };
  if (type === "text") return { ...base, type: "text", text: "New text", w: 60, h: 15, fontFamily: brand?.fonts?.body || "Inter", fontSize: 20, fontWeight: 600, color: theme?.fg || "#FFFFFF", align: "left", lineHeight: 1.2 };
  if (type === "logo") return { ...base, type: "image", role: "logo", url: brandLogoUrls(brand)[0] || "", w: 20, h: 20, fit: "contain" };
  if (type === "image") return { ...base, type: "image", url: "", w: 40, h: 30, fit: "cover" };
  // A video behaves like an image with a grade: same box, same handles, so a
  // scene can carry several of them (a cutaway over a background plate, a
  // picture-in-picture) instead of the one full-bleed clip it used to.
  if (type === "video") return { ...base, type: "video", url: "", w: 50, h: 35, fit: "cover", effects: {} };
  return { ...base, type: "shape", shape: "rect", w: 30, h: 20, color: theme?.accent || "#E2FF3D" };
}

export const MIN_SIZE = 6; // percent — an element can't be resized smaller than this
export const MAX_SIZE = 240; // percent — generous enough for an intentionally oversized bleed image, short of "so big it can't be told apart from the background"

// A bled element (a background image wider than the card, a shape or badge
// hanging off a corner) is a normal design move, so dragging or resizing
// past the card's own edges is allowed rather than clamped to [0, 100] —
// but an element that can slide fully off-canvas becomes unrecoverable: no
// handle left to grab, nothing left to see. clampPos keeps at least
// MIN_OVERLAP percentage-points of the box overlapping the card on each
// axis; the rest of the box is free to hang off any edge, in either
// direction, as far as MAX_SIZE allows.
const MIN_OVERLAP = 10;
export function clampPos(pos, size) {
  return Math.max(MIN_OVERLAP - size, Math.min(100 - MIN_OVERLAP, pos));
}
