import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// Mirrors PLATFORM_SPECS in backend/server.py. The backend is the source of
// truth and is fetched on mount; this copy is what renders on the first paint
// and whenever the API is unreachable, so the format pickers are never empty.
export const FALLBACK_SPECS = {
  instagram: { label: "Instagram", char_limit: 2200, hashtags: 8, formats: ["carousel", "reel", "single", "story"], default_format: "carousel", aspect: { carousel: "4:5", single: "4:5", reel: "9:16", story: "9:16" }, slides: { min: 3, max: 10, default: 6 } },
  tiktok: { label: "TikTok", char_limit: 2200, hashtags: 5, formats: ["reel", "carousel", "single"], default_format: "reel", aspect: { reel: "9:16", carousel: "9:16", single: "9:16" }, slides: { min: 3, max: 8, default: 5 } },
  linkedin: { label: "LinkedIn", char_limit: 3000, hashtags: 3, formats: ["single", "carousel", "text"], default_format: "carousel", aspect: { carousel: "1:1", single: "1.91:1", text: "1:1" }, slides: { min: 4, max: 10, default: 7 } },
  twitter: { label: "X / Twitter", char_limit: 280, hashtags: 2, formats: ["single", "thread", "carousel"], default_format: "thread", aspect: { single: "16:9", thread: "16:9", carousel: "1:1" }, slides: { min: 3, max: 8, default: 5 } },
  threads: { label: "Threads", char_limit: 500, hashtags: 1, formats: ["single", "thread", "carousel"], default_format: "single", aspect: { single: "1:1", thread: "1:1", carousel: "1:1" }, slides: { min: 3, max: 8, default: 5 } },
  youtube: { label: "YouTube", char_limit: 5000, hashtags: 3, formats: ["reel", "single"], default_format: "reel", aspect: { reel: "9:16", single: "16:9" }, slides: { min: 3, max: 8, default: 5 } },
  facebook: { label: "Facebook", char_limit: 5000, hashtags: 2, formats: ["single", "carousel", "reel"], default_format: "single", aspect: { single: "1.91:1", carousel: "1:1", reel: "9:16" }, slides: { min: 3, max: 10, default: 5 } },
};

export const FORMAT_LABEL = {
  carousel: "Carousel",
  reel: "Reel / Short",
  single: "Single visual",
  story: "Story",
  thread: "Thread",
  text: "Text only",
};

export function specFor(specs, platform) {
  return specs[platform] || specs.instagram || FALLBACK_SPECS.instagram;
}

export function aspectFor(specs, platform, format) {
  const s = specFor(specs, platform);
  return (s.aspect || {})[format] || "1:1";
}

export function usePlatformSpecs() {
  const [specs, setSpecs] = useState(FALLBACK_SPECS);
  useEffect(() => {
    let live = true;
    api.get("/platform-specs")
      .then(({ data }) => { if (live && data?.platforms) setSpecs(data.platforms); })
      .catch(() => { /* fallback map already rendered */ });
    return () => { live = false; };
  }, []);
  return specs;
}
