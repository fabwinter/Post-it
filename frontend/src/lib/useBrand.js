import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

export const EMPTY_BRAND = {
  name: "Default brand",
  colors: { bg: "#0A0A0A", fg: "#FFFFFF", accent: "#E2FF3D", sub: "#a1a1aa" },
  fonts: { display: "Inter", body: "Inter" },
  logo_url: null, handle: "", voice: "", style: "", audience: "",
  hashtags: [], cta: "", banned_words: [],
};

// The brand kit is read on almost every screen (it themes graphics and feeds
// prompts), so it degrades to defaults rather than throwing when unset.
export function useBrand() {
  const [brand, setBrand] = useState(EMPTY_BRAND);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    return api.get("/brand-kit")
      .then(({ data }) => setBrand({ ...EMPTY_BRAND, ...data }))
      .catch(() => setBrand(EMPTY_BRAND))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);
  return { brand, setBrand, loading, reload };
}
