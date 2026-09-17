import { useEffect, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api";

// Every typeface the app can set, in four flavours that differ only in where
// the glyphs come from:
//
//   `family`      a Google Fonts css2 parameter — fetched on demand (see
//                 ensureFontLoaded), which is most of this list.
//   `bundled`     shipped with the app itself. Only for faces whose licence
//                 permits redistribution (Open Sauce is SIL OFL); imported
//                 once in index.js so it needs no runtime request at all.
//   `device`      DEVICE: a retail face we have no right to redistribute —
//                 Canva/Creative Market scripts and the like. Selectable so
//                 a deck built around one keeps its real name instead of
//                 silently reading "Inter", and it renders wherever the
//                 viewer has it installed. Where they don't, upload the file
//                 you licensed (see registerCustomFont) and it renders for
//                 everyone, exports included — an uploaded face claims the
//                 same family name, so it simply fills this entry in.
//   `family: null` with no flag — a system font, already on the machine.
//
// `category` only drives how the pickers group these in a <select> (see
// groupFontsByCategory) — it has no effect on rendering.
export const BRAND_FONTS = [
  // ---- Sans-serif (general purpose / UI) ----
  { key: "Inter", family: "Inter:wght@400;500;600;700;800", stack: "'Inter', sans-serif", category: "Sans-serif" },
  { key: "Poppins", family: "Poppins:wght@400;500;600;700;800", stack: "'Poppins', sans-serif", category: "Sans-serif" },
  { key: "Montserrat", family: "Montserrat:wght@400;500;600;700;800", stack: "'Montserrat', sans-serif", category: "Sans-serif" },
  { key: "DM Sans", family: "DM+Sans:wght@400;500;600;700;800", stack: "'DM Sans', sans-serif", category: "Sans-serif" },
  { key: "Space Grotesk", family: "Space+Grotesk:wght@400;500;600;700", stack: "'Space Grotesk', sans-serif", category: "Sans-serif" },
  { key: "Work Sans", family: "Work+Sans:wght@400;500;600;700;800", stack: "'Work Sans', sans-serif", category: "Sans-serif" },
  { key: "Roboto", family: "Roboto:wght@400;500;700;900", stack: "'Roboto', sans-serif", category: "Sans-serif" },
  { key: "Open Sans", family: "Open+Sans:wght@400;500;600;700;800", stack: "'Open Sans', sans-serif", category: "Sans-serif" },
  { key: "Lato", family: "Lato:wght@400;700;900", stack: "'Lato', sans-serif", category: "Sans-serif" },
  { key: "Nunito", family: "Nunito:wght@400;600;700;800", stack: "'Nunito', sans-serif", category: "Sans-serif" },
  { key: "Nunito Sans", family: "Nunito+Sans:wght@400;600;700;800", stack: "'Nunito Sans', sans-serif", category: "Sans-serif" },
  { key: "Raleway", family: "Raleway:wght@400;600;700;800", stack: "'Raleway', sans-serif", category: "Sans-serif" },
  { key: "Rubik", family: "Rubik:wght@400;500;600;700;800", stack: "'Rubik', sans-serif", category: "Sans-serif" },
  { key: "Manrope", family: "Manrope:wght@400;500;600;700;800", stack: "'Manrope', sans-serif", category: "Sans-serif" },
  { key: "Karla", family: "Karla:wght@400;600;700;800", stack: "'Karla', sans-serif", category: "Sans-serif" },
  { key: "Mulish", family: "Mulish:wght@400;600;700;800", stack: "'Mulish', sans-serif", category: "Sans-serif" },
  { key: "Barlow", family: "Barlow:wght@400;600;700;800", stack: "'Barlow', sans-serif", category: "Sans-serif" },
  { key: "Urbanist", family: "Urbanist:wght@400;600;700;800", stack: "'Urbanist', sans-serif", category: "Sans-serif" },
  { key: "Sora", family: "Sora:wght@400;600;700;800", stack: "'Sora', sans-serif", category: "Sans-serif" },
  { key: "Outfit", family: "Outfit:wght@400;500;600;700;800", stack: "'Outfit', sans-serif", category: "Sans-serif" },
  { key: "Plus Jakarta Sans", family: "Plus+Jakarta+Sans:wght@400;600;700;800", stack: "'Plus Jakarta Sans', sans-serif", category: "Sans-serif" },
  { key: "Figtree", family: "Figtree:wght@400;600;700;800", stack: "'Figtree', sans-serif", category: "Sans-serif" },
  { key: "Lexend", family: "Lexend:wght@400;600;700;800", stack: "'Lexend', sans-serif", category: "Sans-serif" },
  { key: "Public Sans", family: "Public+Sans:wght@400;600;700;800", stack: "'Public Sans', sans-serif", category: "Sans-serif" },
  { key: "IBM Plex Sans", family: "IBM+Plex+Sans:wght@400;500;600;700", stack: "'IBM Plex Sans', sans-serif", category: "Sans-serif" },
  { key: "Source Sans 3", family: "Source+Sans+3:wght@400;600;700;800", stack: "'Source Sans 3', sans-serif", category: "Sans-serif" },
  { key: "Quicksand", family: "Quicksand:wght@400;600;700", stack: "'Quicksand', sans-serif", category: "Sans-serif" },
  { key: "Josefin Sans", family: "Josefin+Sans:wght@400;600;700", stack: "'Josefin Sans', sans-serif", category: "Sans-serif" },
  { key: "Archivo", family: "Archivo:wght@400;600;700;800", stack: "'Archivo', sans-serif", category: "Sans-serif" },
  { key: "Epilogue", family: "Epilogue:wght@400;600;700;800", stack: "'Epilogue', sans-serif", category: "Sans-serif" },
  { key: "Hanken Grotesk", family: "Hanken+Grotesk:wght@400;600;700;800", stack: "'Hanken Grotesk', sans-serif", category: "Sans-serif" },
  { key: "Red Hat Display", family: "Red+Hat+Display:wght@400;600;700;800", stack: "'Red Hat Display', sans-serif", category: "Sans-serif" },
  { key: "Albert Sans", family: "Albert+Sans:wght@400;600;700;800", stack: "'Albert Sans', sans-serif", category: "Sans-serif" },
  // Not a Google font: SIL OFL, so we ship it ourselves (see index.js's
  // @fontsource import). The stack names the bundled family first and the
  // foundry's own name second, so a machine with the retail "Open Sauce"
  // installed still gets the same letterforms everyone else sees.
  { key: "Open Sauce", family: null, bundled: true, stack: "'Open Sauce Sans', 'Open Sauce', sans-serif", category: "Sans-serif" },

  // ---- Serif ----
  { key: "Playfair Display", family: "Playfair+Display:wght@400;600;700;800", stack: "'Playfair Display', serif", category: "Serif" },
  { key: "Merriweather", family: "Merriweather:wght@400;700;900", stack: "'Merriweather', serif", category: "Serif" },
  { key: "Lora", family: "Lora:wght@400;600;700", stack: "'Lora', serif", category: "Serif" },
  { key: "Libre Baskerville", family: "Libre+Baskerville:wght@400;700", stack: "'Libre Baskerville', serif", category: "Serif" },
  { key: "PT Serif", family: "PT+Serif:wght@400;700", stack: "'PT Serif', serif", category: "Serif" },
  { key: "Cormorant Garamond", family: "Cormorant+Garamond:wght@400;600;700", stack: "'Cormorant Garamond', serif", category: "Serif" },
  { key: "Crimson Text", family: "Crimson+Text:wght@400;600;700", stack: "'Crimson Text', serif", category: "Serif" },
  { key: "EB Garamond", family: "EB+Garamond:wght@400;600;700", stack: "'EB Garamond', serif", category: "Serif" },
  { key: "Source Serif 4", family: "Source+Serif+4:wght@400;600;700", stack: "'Source Serif 4', serif", category: "Serif" },
  { key: "Noto Serif", family: "Noto+Serif:wght@400;600;700", stack: "'Noto Serif', serif", category: "Serif" },
  { key: "Bitter", family: "Bitter:wght@400;600;700;800", stack: "'Bitter', serif", category: "Serif" },
  { key: "Domine", family: "Domine:wght@400;600;700", stack: "'Domine', serif", category: "Serif" },
  { key: "Spectral", family: "Spectral:wght@400;600;700", stack: "'Spectral', serif", category: "Serif" },
  { key: "Fraunces", family: "Fraunces:wght@400;600;700;800", stack: "'Fraunces', serif", category: "Serif" },
  { key: "Frank Ruhl Libre", family: "Frank+Ruhl+Libre:wght@400;600;700", stack: "'Frank Ruhl Libre', serif", category: "Serif" },
  { key: "Vollkorn", family: "Vollkorn:wght@400;600;700", stack: "'Vollkorn', serif", category: "Serif" },

  // ---- Display / headline ----
  { key: "Bebas Neue", family: "Bebas+Neue", stack: "'Bebas Neue', sans-serif", category: "Display" },
  { key: "Oswald", family: "Oswald:wght@400;600;700", stack: "'Oswald', sans-serif", category: "Display" },
  { key: "Anton", family: "Anton", stack: "'Anton', sans-serif", category: "Display" },
  { key: "Archivo Black", family: "Archivo+Black", stack: "'Archivo Black', sans-serif", category: "Display" },
  { key: "Abril Fatface", family: "Abril+Fatface", stack: "'Abril Fatface', serif", category: "Display" },
  { key: "Bungee", family: "Bungee", stack: "'Bungee', sans-serif", category: "Display" },
  { key: "Righteous", family: "Righteous", stack: "'Righteous', sans-serif", category: "Display" },
  { key: "Passion One", family: "Passion+One:wght@400;700;900", stack: "'Passion One', sans-serif", category: "Display" },
  { key: "Alfa Slab One", family: "Alfa+Slab+One", stack: "'Alfa Slab One', serif", category: "Display" },
  { key: "Fjalla One", family: "Fjalla+One", stack: "'Fjalla One', sans-serif", category: "Display" },
  { key: "Teko", family: "Teko:wght@400;600;700", stack: "'Teko', sans-serif", category: "Display" },
  { key: "Staatliches", family: "Staatliches", stack: "'Staatliches', sans-serif", category: "Display" },
  { key: "Big Shoulders Display", family: "Big+Shoulders+Display:wght@400;600;700;800", stack: "'Big Shoulders Display', sans-serif", category: "Display" },
  { key: "Prata", family: "Prata", stack: "'Prata', serif", category: "Display" },
  { key: "Yeseva One", family: "Yeseva+One", stack: "'Yeseva One', serif", category: "Display" },
  { key: "Barrio", family: "Barrio", stack: "'Barrio', cursive", category: "Display" },

  // ---- Monospace ----
  { key: "JetBrains Mono", family: "JetBrains+Mono:wght@400;600;700", stack: "'JetBrains Mono', monospace", category: "Monospace" },
  { key: "Roboto Mono", family: "Roboto+Mono:wght@400;600;700", stack: "'Roboto Mono', monospace", category: "Monospace" },
  { key: "Space Mono", family: "Space+Mono:wght@400;700", stack: "'Space Mono', monospace", category: "Monospace" },
  { key: "IBM Plex Mono", family: "IBM+Plex+Mono:wght@400;600;700", stack: "'IBM Plex Mono', monospace", category: "Monospace" },
  { key: "Fira Code", family: "Fira+Code:wght@400;600;700", stack: "'Fira Code', monospace", category: "Monospace" },
  { key: "Source Code Pro", family: "Source+Code+Pro:wght@400;600;700", stack: "'Source Code Pro', monospace", category: "Monospace" },
  { key: "Inconsolata", family: "Inconsolata:wght@400;600;700", stack: "'Inconsolata', monospace", category: "Monospace" },
  { key: "Courier Prime", family: "Courier+Prime:wght@400;700", stack: "'Courier Prime', monospace", category: "Monospace" },

  // ---- Handwriting / script ----
  { key: "Pacifico", family: "Pacifico", stack: "'Pacifico', cursive", category: "Handwriting" },
  { key: "Caveat", family: "Caveat:wght@400;600;700", stack: "'Caveat', cursive", category: "Handwriting" },
  { key: "Dancing Script", family: "Dancing+Script:wght@400;600;700", stack: "'Dancing Script', cursive", category: "Handwriting" },
  { key: "Sacramento", family: "Sacramento", stack: "'Sacramento', cursive", category: "Handwriting" },
  { key: "Satisfy", family: "Satisfy", stack: "'Satisfy', cursive", category: "Handwriting" },
  { key: "Great Vibes", family: "Great+Vibes", stack: "'Great Vibes', cursive", category: "Handwriting" },
  { key: "Shadows Into Light", family: "Shadows+Into+Light", stack: "'Shadows Into Light', cursive", category: "Handwriting" },
  { key: "Kalam", family: "Kalam:wght@400;700", stack: "'Kalam', cursive", category: "Handwriting" },
  { key: "Indie Flower", family: "Indie+Flower", stack: "'Indie Flower', cursive", category: "Handwriting" },
  { key: "Permanent Marker", family: "Permanent+Marker", stack: "'Permanent Marker', cursive", category: "Handwriting" },
  { key: "Architects Daughter", family: "Architects+Daughter", stack: "'Architects Daughter', cursive", category: "Handwriting" },

  // ---- Device fonts (licensed elsewhere; see DEVICE note below) ----
  { key: "Brittany", family: null, device: true, stack: "'Brittany', 'Brittany Signature', cursive", category: "Device" },
  { key: "Moontime", family: null, device: true, stack: "'Moontime', cursive", category: "Device" },
  { key: "Apricots", family: null, device: true, stack: "'Apricots', cursive", category: "Device" },
  { key: "Beautifully Delicious Script", family: null, device: true, stack: "'Beautifully Delicious Script', cursive", category: "Device" },
  { key: "Above The Beyond Script", family: null, device: true, stack: "'Above The Beyond Script', cursive", category: "Device" },
  { key: "Biro Script Plus", family: null, device: true, stack: "'Biro Script Plus', 'Biro Script', cursive", category: "Device" },
  { key: "Cinema Outfit", family: null, device: true, stack: "'Cinema Outfit', sans-serif", category: "Device" },

  // ---- System (no network request) ----
  { key: "Georgia", family: null, stack: "Georgia, 'Times New Roman', serif", category: "System" },
  { key: "Times New Roman", family: null, stack: "'Times New Roman', Times, serif", category: "System" },
  { key: "Arial", family: null, stack: "Arial, Helvetica, sans-serif", category: "System" },
  { key: "Helvetica", family: null, stack: "Helvetica, Arial, sans-serif", category: "System" },
  { key: "Verdana", family: null, stack: "Verdana, Geneva, sans-serif", category: "System" },
  { key: "Trebuchet MS", family: null, stack: "'Trebuchet MS', sans-serif", category: "System" },
  { key: "Courier New", family: null, stack: "'Courier New', Courier, monospace", category: "System" },
];

// Category order controls how <optgroup>s appear in a picker — most likely
// to be used first, esoteric/system fallbacks last.
const CATEGORY_ORDER = ["Your fonts", "Sans-serif", "Serif", "Display", "Monospace", "Handwriting", "Device", "System"];

// Groups a font list (BRAND_FONTS, or BRAND_FONTS plus a synthetic "detected"
// entry) into {category, fonts} buckets in a stable, sensible order — a flat
// 90-option <select> is usable but a grouped one is a lot faster to scan.
// Entries without a `category` (e.g. a one-off "detected" font) land in
// their own leading "Other" group instead of being dropped.
export function groupFontsByCategory(fonts) {
  const groups = new Map();
  for (const f of fonts) {
    const cat = f.category || "Other";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(f);
  }
  const order = ["Other", ...CATEGORY_ORDER];
  return order.filter((c) => groups.has(c)).map((category) => ({ category, fonts: groups.get(category) }));
}

const loaded = new Set();

// Injects a Google Fonts <link> the first time a given font is actually
// needed, instead of loading the whole catalog up front.
export function ensureFontLoaded(fontKey) {
  const f = BRAND_FONTS.find((x) => x.key === fontKey);
  if (!f || !f.family || loaded.has(f.key)) return;
  loaded.add(f.key);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.crossOrigin = "anonymous"; // CORS mode so html-to-image can read cssRules for export
  link.href = `https://fonts.googleapis.com/css2?family=${f.family}&display=swap`;
  document.head.appendChild(link);
}

export function fontStack(fontKey) {
  if (!fontKey) return "'Inter', sans-serif";
  const f = BRAND_FONTS.find((x) => x.key === fontKey);
  if (f) return f.stack;
  // A name outside our curated catalog — e.g. extracted from an uploaded
  // PPTX/PDF template ("Calibri", "Cambria", a corporate font we don't
  // carry) — used as-is with a generic fallback rather than silently
  // discarded for Inter, so a template's real font still shows when it's
  // actually installed, and degrades sanely when it isn't.
  return `'${fontKey}', sans-serif`;
}

// Loads a brand's display/body fonts as soon as they're known — call this
// anywhere a brand theme might actually render (VisualCard, the Brand Kit
// preview) so the picked fonts are on the page before they're needed.
export function useBrandFonts(fonts) {
  useEffect(() => {
    if (fonts?.display) ensureFontLoaded(fonts.display);
    if (fonts?.body) ensureFontLoaded(fonts.body);
  }, [fonts?.display, fonts?.body]);
}

let allFontsLoaded = false;

// A font <select>'s own options are worth previewing in their real
// typeface (that's the whole point of picking one by eye) — which needs
// every family on the page at once, unlike ensureFontLoaded's one-at-a-time
// lazy load for whatever's actually been chosen. One combined Google Fonts
// request (the css2 API accepts any number of `family=` params) is far
// cheaper than ~80 separate <link> tags.
export function ensureAllFontsLoaded() {
  if (allFontsLoaded) return;
  allFontsLoaded = true;
  const families = BRAND_FONTS.filter((f) => f.family && !loaded.has(f.key));
  if (!families.length) return;
  families.forEach((f) => loaded.add(f.key));
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.crossOrigin = "anonymous"; // CORS mode so html-to-image can read cssRules for export
  link.href = `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f.family}`).join("&")}&display=swap`;
  document.head.appendChild(link);
}

export function useAllFontsLoaded() {
  useEffect(() => { ensureAllFontsLoaded(); }, []);
}


// ---------------------------------------------------------------------------
// Custom fonts — the files a user licensed and uploaded
// ---------------------------------------------------------------------------
// The catalogue above can only carry faces we may legally serve. A retail
// script (Brittany, Moontime, the Canva library) can't be one of those, so
// instead the user uploads the file they already own and we register it as a
// web font under the family name they give it.
//
// That name is the whole mechanism: `fontStack` already resolves any name to
// `'Name', <generic>`, and a DEVICE entry's stack leads with exactly the same
// family — so an uploaded "Brittany" transparently becomes what the device
// entry was only hoping to find installed, everywhere at once, with no
// key-rewriting and nothing stored on existing slides to migrate.

// A family name goes straight into a CSS string, so it may only contain
// what a font name plausibly contains — never a quote, brace or semicolon
// that could close the rule and start another one.
export function safeFamilyName(name) {
  return String(name || "").replace(/[^A-Za-z0-9 ._-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

const FORMAT_BY_EXT = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };
export const FONT_UPLOAD_ACCEPT = ".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf";

function faceFormat(row) {
  const ext = String(row.filename || row.url || "").toLowerCase().split(/[.?#]/).filter(Boolean).pop();
  return FORMAT_BY_EXT[ext] || "woff2";
}

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.onerror = reject;
  fr.readAsDataURL(blob);
});

const faceRule = (family, src, format) =>
  `@font-face{font-family:'${family}';src:url(${JSON.stringify(src)}) format('${format}');font-display:swap;}`;

const installedFaces = new Map(); // upload id -> the <style> carrying its rule

// Injected as a <style> rather than a FontFace object because the export path
// (html-to-image) discovers web fonts by walking document.styleSheets — a face
// added straight to document.fonts renders on screen and then vanishes from
// every PNG and every exported reel.
async function installCustomFace(row) {
  if (typeof document === "undefined" || installedFaces.has(row.id)) return;
  const family = safeFamilyName(row.name);
  if (!family || !row.url) return;
  const format = faceFormat(row);
  const style = document.createElement("style");
  style.dataset.customFont = row.id;
  style.textContent = faceRule(family, row.url, format);
  document.head.appendChild(style);
  installedFaces.set(row.id, style);
  try {
    // Swap the URL for the bytes once they're here. Rendering doesn't need
    // this, but exporting does: an inlined face can't fail a cross-origin
    // fetch halfway through a render, which would drop the typeface from the
    // output with nothing to show for it.
    // Plain fetch, not the api client: this URL is blob storage, and the
    // client would attach the app's access header to a third-party origin.
    const res = await fetch(row.url);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    style.textContent = faceRule(family, await blobToDataUrl(blob), format);
  } catch {
    /* The URL form above still renders; only export inlining is at risk. */
  }
  try {
    await document.fonts.load(`400 16px '${family}'`);
    await document.fonts.load(`700 16px '${family}'`);
  } catch { /* older browsers just repaint when the face arrives */ }
  bumpInstalled();
}

function uninstallCustomFace(id) {
  installedFaces.get(id)?.remove();
  installedFaces.delete(id);
}

// ---- The live catalogue -----------------------------------------------------

let customFonts = [];
let catalogSnapshot = BRAND_FONTS;
const catalogSubs = new Set();

function rebuildCatalog() {
  const mine = customFonts.map((row) => ({
    key: safeFamilyName(row.name),
    family: null,
    custom: true,
    id: row.id,
    stack: `'${safeFamilyName(row.name)}', ${BRAND_FONTS.find((f) => f.key === safeFamilyName(row.name))?.stack.split(",").pop().trim() || "sans-serif"}`,
    category: "Your fonts",
  })).filter((f) => f.key);
  const claimed = new Set(mine.map((f) => f.key));
  // An upload that names a DEVICE entry has superseded it — showing both
  // would offer the same family twice with only one of them real.
  catalogSnapshot = [...mine, ...BRAND_FONTS.filter((f) => !claimed.has(f.key))];
  catalogSubs.forEach((fn) => fn());
}

export function setCustomFonts(rows) {
  const next = Array.isArray(rows) ? rows : [];
  const gone = customFonts.filter((r) => !next.some((n) => n.id === r.id));
  gone.forEach((r) => uninstallCustomFace(r.id));
  customFonts = next;
  next.forEach(installCustomFace);
  rebuildCatalog();
}

export function customFontList() {
  return customFonts;
}

let fontsFetched = false;

// Pulls the user's uploaded faces once per page load. Called by every picker,
// so whichever screen opens first pays for it and the rest are already set.
export async function loadCustomFonts(force = false) {
  if (fontsFetched && !force) return customFonts;
  fontsFetched = true;
  try {
    const { data } = await api.get("/fonts");
    setCustomFonts(data);
  } catch {
    fontsFetched = false; // a failed load shouldn't poison the next screen
  }
  return customFonts;
}

const subscribeCatalog = (fn) => { catalogSubs.add(fn); return () => catalogSubs.delete(fn); };
const readCatalog = () => catalogSnapshot;

// The full picker list: uploaded faces first, then the built-in catalogue.
// Re-renders whichever pickers are mounted when an upload lands or is deleted.
export function useFontCatalog() {
  useEffect(() => { loadCustomFonts(); }, []);
  return useSyncExternalStore(subscribeCatalog, readCatalog, readCatalog);
}

// ---- Is this face actually on the machine? ---------------------------------

const PROBE_TEXT = "mmmwwwiiillWQ@#0123456789";
const PROBE_BASELINES = ["monospace", "serif", "sans-serif"];
let probeCtx = null;

// document.fonts.check() can't answer this — for a family it has never heard
// of it reports the fallback as a match, so everything looks installed.
// Measuring does answer it: a name the machine can't resolve renders as the
// generic beside it and comes out exactly as wide.
export function isFontAvailable(family) {
  if (typeof document === "undefined" || !family) return false;
  if (!probeCtx) probeCtx = document.createElement("canvas").getContext("2d");
  if (!probeCtx) return false;
  return PROBE_BASELINES.some((base) => {
    probeCtx.font = `72px ${base}`;
    const bare = probeCtx.measureText(PROBE_TEXT).width;
    probeCtx.font = `72px '${family}', ${base}`;
    return probeCtx.measureText(PROBE_TEXT).width !== bare;
  });
}

const installedSubs = new Set();
const bumpInstalled = () => installedSubs.forEach((fn) => fn());

// Whether a DEVICE font will really render here. Recomputed when an upload
// registers a face, so uploading "Brittany" clears the warning immediately
// rather than at the next reload.
export function useFontAvailable(fontKey) {
  const entry = catalogSnapshot.find((f) => f.key === fontKey);
  const isDevice = !!entry?.device;
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    if (!isDevice) { setAvailable(true); return undefined; }
    const check = () => setAvailable(isFontAvailable(fontKey));
    check();
    installedSubs.add(check);
    document.fonts?.ready?.then(check).catch(() => {});
    return () => installedSubs.delete(check);
  }, [fontKey, isDevice]);
  return isDevice ? available : true;
}
