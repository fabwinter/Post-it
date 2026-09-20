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

// Resolves once an <img> has either loaded or given up, to a boolean that
// says which — the capture never rasterises one mid-flight, and the caller
// finds out whether it actually has something to draw.
//
// naturalWidth is NOT that signal on its own: a same-origin or successfully
// proxied SVG whose root declares only a viewBox (no explicit width/height)
// decodes and paints fine — you can see it on screen right now — but Chrome
// still reports naturalWidth 0 for it, identically to a genuinely broken
// image. img.decode() asks the browser the real question ("is there usable
// image data here") instead of inferring it from a size that a valid SVG is
// allowed not to have, so it's the one used to tell "failed" from "fine".
function imageSettled(img) {
  if (img.complete && img.naturalWidth) return Promise.resolve(true);
  let viaDecode;
  try {
    viaDecode = typeof img.decode === "function"
      ? img.decode().then(() => true, () => false)
      : Promise.resolve(null); // no decode() support — fall through to events below
  } catch { viaDecode = Promise.resolve(null); }
  return viaDecode.then((ok) => {
    if (ok !== null) return ok;
    return new Promise((resolve) => {
      img.addEventListener("load", () => resolve(true), { once: true });
      img.addEventListener("error", () => resolve(false), { once: true });
      setTimeout(() => resolve(img.complete && !!img.naturalWidth), 8000);
    });
  });
}

// Direct first, our own proxy only as a fallback — the same order
// loadMediaElement/loadClipImage use for a reel's footage in videoExport.js,
// and for the same reason: every one of these <img>s already renders with
// crossOrigin="anonymous" pointed at its real URL (see VisualCard), so if
// the host sends CORS headers at all, the direct URL already works — which
// is exactly what having it visible on screen a moment earlier means. This
// used to swap every cross-origin image to the proxy UNCONDITIONALLY,
// before ever trying the URL it was already rendering successfully. That
// is a real extra hop — our backend fetching the file itself, subject to
// its own timeout, its own content-type sniffing, its own network — and a
// working brand logo failing that hop got dropped from the export with no
// working direct URL ever attempted. Now the proxy is only reached for
// whatever the direct load actually couldn't get.
//
// Whatever still hasn't loaded by the end is LEFT OUT of the capture rather
// than drawn. An <img> that failed renders as nothing on screen (alt="" has
// no alt box to show), so a broken brand logo looks merely absent while you
// are working — but html-to-image faithfully rasterises the browser's own
// broken-image glyph, which is how a downloaded PNG ended up with a little
// grey box with a torn corner sitting where the logo should be. A card that
// is missing its logo is a bad export; a card with a broken-image icon
// burned into it is an unusable one, and the caller is told either way (see
// onMissingMedia) instead of finding out from the file.
async function withProxiedImages(node, run) {
  const imgs = Array.from(node.querySelectorAll("img"));
  const originals = imgs.map((img) => img.getAttribute("src"));
  let settled = await Promise.all(imgs.map(imageSettled));

  const retryIdx = imgs.reduce((acc, img, i) => {
    if (!settled[i] && proxied(originals[i]) !== originals[i]) acc.push(i);
    return acc;
  }, []);
  retryIdx.forEach((i) => {
    const img = imgs[i];
    img.crossOrigin = "anonymous";
    img.setAttribute("src", proxied(originals[i]));
  });
  if (retryIdx.length) {
    const retried = await Promise.all(retryIdx.map((i) => imageSettled(imgs[i])));
    retryIdx.forEach((i, j) => { settled[i] = retried[j]; });
  }

  const missing = [];
  imgs.forEach((img, i) => {
    if (settled[i]) return;
    missing.push(originals[i] || "");
    img.setAttribute(EXPORT_SKIP_ATTR, "");
  });

  try {
    return await run(missing);
  } finally {
    imgs.forEach((img, i) => {
      img.removeAttribute(EXPORT_SKIP_ATTR);
      if (originals[i] == null) img.removeAttribute("src");
      else img.setAttribute("src", originals[i]);
    });
  }
}

/**
 * Rasterises a card to a PNG data URL. `extra` is passed through to
 * html-to-image (the reel exporter sets its own size and drops the backdrop),
 * except for `onMissingMedia`, which is called with the source URLs of any
 * images that could not be loaded and were therefore left out of the capture.
 * Nothing on the card fails the export — the caller decides whether a card
 * missing its logo is worth warning about.
 *
 * Resolves to the data URL. Rejects only when there is no PNG at all.
 */
export async function captureCardPng(node, extra = {}) {
  const { onMissingMedia, ...options } = extra;
  if (!node) throw new Error("There's nothing on the canvas to export yet.");
  if (document.fonts?.ready) {
    // Measure text in the face it will be rasterised in, not in whatever was
    // loaded when the click landed.
    try { await document.fonts.ready; } catch { /* older browsers repaint anyway */ }
  }
  const fontEmbedCSS = (await fontEmbedCSSFor(node)) || "";

  return withVideoStills(node, (footageMissing) => withProxiedImages(node, async (imagesMissing) => {
    const dataUrl = await toPng(node, {
      pixelRatio: 2,
      ...options,
      fontEmbedCSS,
      // The <video>s that withVideoStills has already stood an <img> in for,
      // the images that never loaded, plus whatever the caller wants dropped.
      filter: (n) => {
        if (n instanceof Element && n.hasAttribute(EXPORT_SKIP_ATTR)) return false;
        return options.filter ? options.filter(n) : true;
      },
      // Without this, one unreachable image rejects the entire export. The
      // slot is left empty instead.
      onImageErrorHandler: () => {},
    });
    if (!dataUrl || dataUrl === "data:,") throw new Error("The card came back empty. Try again in a moment.");
    if ((imagesMissing.length || footageMissing) && onMissingMedia) onMissingMedia(imagesMissing, footageMissing);
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
