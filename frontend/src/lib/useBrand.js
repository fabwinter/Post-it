import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

const DEFAULT_DARK = { bg: "#0A0A0A", fg: "#FFFFFF", accent: "#E2FF3D", sub: "#a1a1aa" };
const DEFAULT_LIGHT = { bg: "#FFFFFF", fg: "#0A0A0A", accent: "#0047FF", sub: "#6b7280" };

export const EMPTY_BRAND = {
  name: "Default brand",
  colors: { dark: DEFAULT_DARK, light: DEFAULT_LIGHT },
  color_mode: "dark",
  fonts: { display: "Inter", body: "Inter" },
  logo_url: null, handle: "", voice: "", style: "", audience: "",
  hashtags: [], cta: "", banned_words: [], is_default: true,
};

// The colors a kit is currently rendering with — bg/fg/accent/sub for
// whichever of its two palettes (dark/light) is active. Every renderer reads
// through this instead of poking brand.colors.dark/light directly.
export function activeColors(brand) {
  const mode = brand?.color_mode === "light" ? "light" : "dark";
  return { ...DEFAULT_DARK, ...(brand?.colors?.[mode] || {}) };
}

// One kit, by id — or the account's default kit when no id is given. Used on
// its own for "the" brand (Visuals, Dashboard) and by the Composer's brand-kit
// picker for whichever kit is currently selected.
export function useBrandKit(kitId) {
  const [brand, setBrand] = useState(EMPTY_BRAND);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    const req = kitId
      ? api.get(`/brand-kits/${kitId}`).then(({ data }) => data)
      : api.get("/brand-kits").then(({ data }) => (Array.isArray(data) ? data.find((k) => k.is_default) || data[0] : data));
    return req
      .then((kit) => setBrand({ ...EMPTY_BRAND, ...kit }))
      .catch(() => setBrand(EMPTY_BRAND))
      .finally(() => setLoading(false));
  }, [kitId]);

  useEffect(() => { reload(); }, [reload]);
  return { brand, setBrand, loading, reload };
}

// The brand kit is read on almost every screen (it themes graphics and feeds
// prompts), so it degrades to defaults rather than throwing when unset.
export function useBrand() {
  return useBrandKit(null);
}

// The full list of saved kits — the Brand Kit page's switcher and the
// Composer's picker both read from this.
export function useBrandKits() {
  const [kits, setKits] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    return api.get("/brand-kits")
      .then(({ data }) => setKits(data))
      .catch(() => setKits([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);
  return { kits, loading, reload };
}
