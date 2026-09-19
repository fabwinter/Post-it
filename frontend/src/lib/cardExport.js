// The one capture used by every PNG export: the Composer's single slide and
// its zip-all, the visual panel, the Brand Kit guideline, and the reel
// exporter's overlay layers. Three copies of most of this had been pasted
// into those files; this is that logic, once, plus the two things none of
// the copies did.
//
// WHAT WAS ALREADY HERE, and is kept:
//   - Cross-origin images are swapped to same-origin proxy URLs before the
//     capture and put back afterwards, so the canvas is never tainted by a
//     stock photo or a logo on someone else's domain.
//   - cacheBust stays off. The query string it appends turns an
//     already-proxied same-origin URL back into an uncached cross-origin
//     fetch, which reintroduces exactly the taint the proxying removes.
//
// WHAT THIS ADDS:
//
// 1. VIDEO. The image proxying above only ever looked at <img>. A card with
//    footage on it — every reel scene, any slide with a stock clip — is
//    rasterised by drawing the <video> into a canvas and reading the canvas
//    back, and a cross-origin clip taints it, so toDataURL throws
//    "Tainted canvases may not be exported" and the export dies with nothing
//    downloaded. The frame is snapshotted here instead (direct if the page is
//    allowed to read it, else through the same proxy), an <img> stands in the
//    video's own box for the duration, and the <video> is left out of the
//    capture. Hiding it is not enough: a hidden element is still cloned, and
//    a zero-width one makes the library build a 0x0 canvas, read back the
//    string "data:," and reject with a bare Event.
//
// 2. FONTS, SCOPED. Collecting @font-face from every readable stylesheet
//    misses the faces that matter here: this app injects its ~90-family
//    Google stylesheet at runtime (ensureAllFontsLoaded) with no crossorigin
//    attribute, so it is unreadable and every one of those families silently
//    fell back to a system face in exported text. Asking Google for just the
//    families a card actually uses gets them back — and keeps the request
//    small, which is the other half of the problem: left to itself
//    html-to-image re-downloads that entire catalogue and inlines every font
//    file in it, thousands of fetches, on every single export.
import { toPng } from "html-to-image";
import { BRAND_FONTS } from "./fonts";
import { proxied, downloadBlob } from "./videoExport";

const EXPORT_SKIP_ATTR = "data-export-skip";
const normalizeFamily = (f) => f.trim().replace(/["']/g, "");

// Every font family named anywhere inside this card — including the fallbacks
// in a stack, since a face further down it is what renders when the first is
// missing.
function usedFamilies(node) {
  const out = new Set();
  const visit = (el) => {
    const fam = el.style?.fontFamily || getComputedStyle(el).fontFamily || "";
    fam.split(",").forEach((f) => {
      const name = normalizeFamily(f);
      if (name) out.add(name);
    });
    Array.from(el.children).forEach((child) => {
      if (child instanceof HTMLElement) visit(child);
    });
  };
  visit(node);
  return out;
}

// Keyed by the exact set of families asked for, so exporting a whole carousel
// resolves its faces once rather than once per slide.
const fontCssCache = new Map();

async function inlineFontUrls(cssText, baseUrl) {
  const locs = cssText.match(/url\([^)]+\)/g) || [];
  const seen = new Map();
  await Promise.all(locs.map(async (loc) => {
    const raw = loc.replace(/url\(["']?([^"')]+)["']?\)/, "$1");
    if (raw.startsWith("data:") || seen.has(raw)) return;
    const url = raw.startsWith("http") ? raw : new URL(raw, baseUrl).href;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      seen.set(raw, await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      }));
    } catch {
      // This one face stays a live URL. Losing a weight beats losing the export.
      seen.set(raw, null);
    }
  }));
  let out = cssText;
  for (const [raw, dataUrl] of seen) {
    if (dataUrl) {
      out = out.split(`url(${raw})`).join(`url(${dataUrl})`)
        .split(`url("${raw}")`).join(`url(${dataUrl})`)
        .split(`url('${raw}')`).join(`url(${dataUrl})`);
    }
  }
  return out;
}

/**
 * The @font-face rules for the faces this card actually uses, with the font
 * files inlined — and nothing else. Two sources: stylesheets this page is
 * allowed to read (the CORS-loaded webfont links, and uploaded custom faces,
 * which already carry their bytes inline), and Google, fetched scoped to the
 * handful of families in play.
 *
 * Always returns a string. "" is a real answer meaning "embed nothing", and
 * it still has to be passed to html-to-image: the library only skips its own
 * stylesheet walk when fontEmbedCSS is non-null, so dropping an empty string
 * for being falsy hands the export straight back to the catalogue download.
 */
export async function fontEmbedCSSFor(node) {
  const used = usedFamilies(node);
  const local = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    // A sheet this page can't read throws here. Skipping it is right: the
    // families that matters for are handled by the scoped fetch below.
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of Array.from(rules || [])) {
      if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
      const fam = normalizeFamily(rule.style.getPropertyValue("font-family") || "");
      if (used.has(fam)) local.push(rule.cssText);
    }
  }
  const localCss = await inlineFontUrls(local.join("\n"), window.location.href);

  const google = BRAND_FONTS.filter((f) => f.family && used.has(f.key));
  if (!google.length) return localCss;

  const key = google.map((f) => f.family).sort().join("|");
  if (!fontCssCache.has(key)) {
    const href = `https://fonts.googleapis.com/css2?${google.map((f) => `family=${f.family}`).join("&")}&display=swap`;
    fontCssCache.set(key, (async () => {
      try {
        const res = await fetch(href);
        if (!res.ok) throw new Error(String(res.status));
        return await inlineFontUrls(await res.text(), href);
      } catch {
        return "";
      }
    })());
  }
  return [localCss, await fontCssCache.get(key)].filter(Boolean).join("\n");
}

// The frame currently on screen, as a data URL. Null when the canvas is
// tainted — a cross-origin video with no CORS header, whose pixels this page
// is not allowed to read by any means.
function readFrame(video) {
  if (!video.videoWidth || !video.videoHeight) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

// Second attempt at a tainted clip: the same source through the app's own
// media proxy, which serves it same-origin with a permissive CORS header —
// the same route the images above take. Detached from the page, so nothing
// about the live card changes.
function frameViaProxy(url, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const el = document.createElement("video");
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      el.removeAttribute("src");
      el.load();
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    el.muted = true;
    el.playsInline = true;
    el.crossOrigin = "anonymous";
    el.preload = "auto";
    el.onloadeddata = () => { clearTimeout(timer); done(readFrame(el)); };
    el.onerror = () => { clearTimeout(timer); done(null); };
    el.src = proxied(url);
  });
}

// Swaps each <video> for a still of itself, runs the capture, and puts the
// card back exactly as it was. The <img> stands in the video's own box —
// same class list, same inline style — so z-order, object-fit and the clip's
// opacity and filter all land where they were.
async function withVideoStills(node, run) {
  const videos = Array.from(node.querySelectorAll("video"));
  if (!videos.length) return run(false);

  const stills = await Promise.all(videos.map(async (video) => {
    const direct = readFrame(video);
    if (direct) return direct;
    const src = video.currentSrc || video.src;
    return src ? await frameViaProxy(src) : null;
  }));

  const swaps = [];
  videos.forEach((video, i) => {
    if (!video.parentNode) return;
    let img = null;
    // Only stand something in when there is a frame to show. An <img> with no
    // src resolves to the page URL, so the capture fetches index.html and
    // tries to decode the HTML as an image.
    if (stills[i]) {
      img = document.createElement("img");
      img.className = video.className;
      img.style.cssText = video.style.cssText;
      img.setAttribute("data-export-still", "");
      img.src = stills[i];
      video.parentNode.insertBefore(img, video);
    }
    video.setAttribute(EXPORT_SKIP_ATTR, "");
    swaps.push({ video, img });
  });

  try {
    return await run(stills.some((s) => !s));
  } finally {
    swaps.forEach(({ video, img }) => {
      if (img) img.remove();
      video.removeAttribute(EXPORT_SKIP_ATTR);
    });
  }
}

// Cross-origin images, swapped to the proxy for the duration of the capture
// so they can be read back, then restored.
async function withProxiedImages(node, run) {
  const imgs = Array.from(node.querySelectorAll("img"));
  const originals = imgs.map((img) => img.getAttribute("src"));
  imgs.forEach((img) => {
    const src = img.getAttribute("src");
    const p = proxied(src);
    if (p !== src) { img.crossOrigin = "anonymous"; img.setAttribute("src", p); }
  });
  await Promise.all(imgs.map((img) => (img.complete && img.naturalWidth
    ? Promise.resolve()
    : new Promise((resolve) => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", resolve, { once: true });
      setTimeout(resolve, 8000);
    }))));
  try {
    return await run();
  } finally {
    imgs.forEach((img, i) => {
      if (originals[i] == null) img.removeAttribute("src");
      else img.setAttribute("src", originals[i]);
    });
  }
}

/**
 * Rasterises a card to a PNG data URL. `extra` is passed through to
 * html-to-image (the reel exporter sets its own size and drops the backdrop).
 *
 * Resolves to the data URL. Rejects only when there is no PNG at all.
 */
export async function captureCardPng(node, extra = {}) {
  if (!node) throw new Error("There's nothing on the canvas to export yet.");
  if (document.fonts?.ready) {
    // Measure text in the face it will be rasterised in, not in whatever was
    // loaded when the click landed.
    try { await document.fonts.ready; } catch { /* older browsers repaint anyway */ }
  }
  const fontEmbedCSS = (await fontEmbedCSSFor(node)) || "";

  return withVideoStills(node, () => withProxiedImages(node, async () => {
    const dataUrl = await toPng(node, {
      pixelRatio: 2,
      ...extra,
      fontEmbedCSS,
      // The <video>s that withVideoStills has already stood an <img> in for,
      // plus whatever the caller wants dropped.
      filter: (n) => {
        if (n instanceof Element && n.hasAttribute(EXPORT_SKIP_ATTR)) return false;
        return extra.filter ? extra.filter(n) : true;
      },
      // Without this, one unreachable image rejects the entire export. The
      // slot is left empty instead.
      onImageErrorHandler: () => {},
    });
    if (!dataUrl || dataUrl === "data:,") throw new Error("The card came back empty. Try again in a moment.");
    return dataUrl;
  }));
}

/** Turns whatever went wrong into something worth reading in a toast. */
export function exportErrorMessage(e) {
  const raw = (e && (e.message || String(e))) || "";
  if (/tainted|SecurityError/i.test(raw)) {
    return "Couldn't read the media on this card — it's hosted somewhere that blocks copying. Re-add it from the Library and try again.";
  }
  if (/fetch|network|load/i.test(raw)) {
    return "Couldn't reach some of the media on this card. Check your connection and try again.";
  }
  return raw ? `Export failed: ${raw}` : "Export failed.";
}

/**
 * Hands a finished export to the browser's save dialog.
 *
 * Every PNG path used to hand-roll this, and three of them got it wrong the
 * same way:
 *
 *   a.click();
 *   URL.revokeObjectURL(blobUrl);   // <- synchronous
 *
 * A click only STARTS a download; the browser reads the object URL afterwards,
 * so revoking on the next line can pull the bytes out from under it. The click
 * still registers — the toast says "Downloaded PNG" — and no file ever lands.
 * That is what "it looks like it downloaded but there's no file anywhere" is.
 * The anchor was also never put in the document, which some browsers require
 * before they will honour `download` at all.
 *
 * downloadBlob (lib/videoExport) already does both correctly and is what the
 * reel export has always used, which is why saving a reel worked while saving
 * a PNG did not. Everything goes through it now.
 */
export async function saveExport(source, filename) {
  const blob = typeof source === "string" ? await (await fetch(source)).blob() : source;
  if (!blob || !blob.size) throw new Error("The export came back empty, so there was nothing to save.");
  downloadBlob(blob, filename);
  return blob.size;
}
