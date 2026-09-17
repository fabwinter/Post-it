/**
 * Font embedding for html-to-image exports that survives cross-origin stylesheets.
 *
 * html-to-image's getFontEmbedCSS walks every document.styleSheet and throws
 * if any single sheet's cssRules can't be read (a SecurityError from a
 * cross-origin <link> without a crossorigin attribute — analytics SDKs,
 * third-party widgets). One unreadable sheet kills every font in the export,
 * even though the app's own @font-face rules (Google Fonts loaded with
 * crossOrigin="anonymous", @fontsource bundled CSS, and user-uploaded custom
 * faces injected as same-origin <style> tags) are all perfectly readable.
 *
 * safeFontEmbedCSS collects @font-face rules only from sheets we can read,
 * inlines each font file as a data URL (so the clone isn't blocked by a
 * cross-origin fetch halfway through rasterisation), and returns a CSS string
 * suitable for html-to-image's `fontEmbedCSS` option. If nothing readable is
 * found it returns null, letting the caller fall back gracefully.
 */

const FORMAT_BY_EXT = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };

function srcFormat(url) {
  const ext = String(url).toLowerCase().split(/[.?#]/).filter(Boolean).pop();
  return FORMAT_BY_EXT[ext] || "woff2";
}

// Match url(...) or url("..." / url('...')  — captures the URL inside.
const URL_RE = /url\((['"]?)([^'")]+)\1\)/g;

async function inlineFontSrc(src) {
  // data: URLs are already self-contained.
  if (/^data:/i.test(src)) return src;
  try {
    const res = await fetch(src, { mode: "cors" });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  } catch {
    // Can't inline this source — leave the original URL; the browser will
    // resolve it from the clone's context or fall back.
    return src;
  }
}

/**
 * Returns a CSS string of all readable @font-face rules with font files
 * inlined as data URLs, or null if no readable font rules were found.
 */
export async function safeFontEmbedCSS() {
  const rules = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let cssRules;
    try {
      cssRules = sheet.cssRules;
    } catch {
      // SecurityError: cross-origin sheet without CORS — skip it.
      continue;
    }
    if (!cssRules) continue;
    for (const rule of cssRules) {
      if (rule.type === CSSRule.FONT_FACE_RULE) {
        rules.push(rule.cssText);
      }
    }
  }
  if (!rules.length) return null;

  // Inline every url(...) in every @font-face so the clone doesn't need
  // network access (which can fail mid-rasterisation on slow connections or
  // cross-origin restrictions, dropping the typeface from the output).
  const inlinePromises = [];
  const inlined = rules.map((text) => {
    let result = text;
    let match;
    URL_RE.lastIndex = 0;
    const urls = [];
    while ((match = URL_RE.exec(text)) !== null) {
      urls.push(match[2]);
    }
    for (const url of urls) {
      if (/^data:/i.test(url)) continue;
      inlinePromises.push(
        inlineFontSrc(url).then((dataUrl) => {
          if (dataUrl !== url) {
            result = result.replace(`url(${url})`, `url(${dataUrl})`)
              .replace(`url("${url}")`, `url("${dataUrl}")`)
              .replace(`url('${url}')`, `url('${dataUrl}')`);
          }
        }),
      );
    }
    return result;
  });
  await Promise.all(inlinePromises);
  return inlined.join("\n");
}
