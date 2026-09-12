import { useEffect } from "react";

// A wide spread of real Google Fonts (loaded on demand, never all at once —
// see ensureFontLoaded) plus a handful of system fonts that need no network
// request at all. `category` only drives how the pickers group these in a
// <select> (see groupFontsByCategory) — it has no effect on rendering.
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
const CATEGORY_ORDER = ["Sans-serif", "Serif", "Display", "Monospace", "Handwriting", "System"];

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
  link.href = `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f.family}`).join("&")}&display=swap`;
  document.head.appendChild(link);
}

export function useAllFontsLoaded() {
  useEffect(() => { ensureAllFontsLoaded(); }, []);
}
