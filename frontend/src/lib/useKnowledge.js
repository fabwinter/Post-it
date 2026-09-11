import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

// What a brand knows, as opposed to how it sounds. Scoped to a kit; the API
// also returns documents saved with no kit, which apply to every one.
export const KNOWLEDGE_KINDS = [
  { key: "values", label: "Values" },
  { key: "philosophy", label: "Philosophy" },
  { key: "story", label: "Origin story" },
  { key: "product", label: "Product" },
  { key: "case_study", label: "Previous work" },
  { key: "inspiration", label: "Inspiration" },
  { key: "audience", label: "Audience" },
  { key: "offer", label: "Offers & pricing" },
  { key: "faq", label: "FAQ" },
  { key: "guideline", label: "House rules" },
  { key: "note", label: "Note" },
];

export const kindLabel = (key) => KNOWLEDGE_KINDS.find((k) => k.key === key)?.label || key;

export function useKnowledge(brandKitId) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    return api.get("/knowledge", { params: brandKitId ? { brand_kit_id: brandKitId } : {} })
      .then(({ data }) => setDocs(data))
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, [brandKitId]);

  useEffect(() => { reload(); }, [reload]);
  return { docs, loading, reload };
}
