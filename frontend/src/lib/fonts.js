import { useEffect } from "react";

// A curated set — real Google Fonts (loaded on demand) plus two system
// fallbacks that need no network request at all.
export const BRAND_FONTS = [
  { key: "Inter", family: "Inter:wght@400;600;700;800", stack: "'Inter', sans-serif" },
  { key: "Poppins", family: "Poppins:wght@400;600;700;800", stack: "'Poppins', sans-serif" },
  { key: "Montserrat", family: "Montserrat:wght@400;600;700;800", stack: "'Montserrat', sans-serif" },
  { key: "Playfair Display", family: "Playfair+Display:wght@400;600;700;800", stack: "'Playfair Display', serif" },
  { key: "DM Sans", family: "DM+Sans:wght@400;600;700;800", stack: "'DM Sans', sans-serif" },
  { key: "Space Grotesk", family: "Space+Grotesk:wght@400;500;600;700", stack: "'Space Grotesk', sans-serif" },
  { key: "JetBrains Mono", family: "JetBrains+Mono:wght@400;600;700", stack: "'JetBrains Mono', monospace" },
  { key: "Oswald", family: "Oswald:wght@400;600;700", stack: "'Oswald', sans-serif" },
  { key: "Bebas Neue", family: "Bebas+Neue", stack: "'Bebas Neue', sans-serif" },
  { key: "Merriweather", family: "Merriweather:wght@400;700;900", stack: "'Merriweather', serif" },
  { key: "Work Sans", family: "Work+Sans:wght@400;600;700;800", stack: "'Work Sans', sans-serif" },
  { key: "Roboto", family: "Roboto:wght@400;500;700;900", stack: "'Roboto', sans-serif" },
  { key: "Georgia", family: null, stack: "Georgia, 'Times New Roman', serif" },
  { key: "Arial", family: null, stack: "Arial, Helvetica, sans-serif" },
];

const loaded = new Set();

// Injects a Google Fonts <link> the first time a given font is actually
// needed, instead of loading all fourteen up front.
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
  const f = BRAND_FONTS.find((x) => x.key === fontKey);
  return f ? f.stack : "'Inter', sans-serif";
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
