import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// Mirrors TEMPLATE_GUIDES in backend/server.py. Fetched on mount; this copy
// renders on first paint and whenever the API is unreachable.
export const FALLBACK_TEMPLATES = [
  { key: "hooks", label: "Hooks", desc: "Scroll-stopping one-liners" },
  { key: "story", label: "Story Arc", desc: "Moment, tension, lesson" },
  { key: "listicle", label: "Listicle", desc: "Numbered, punchy points" },
  { key: "contrarian", label: "Contrarian", desc: "Challenge the consensus" },
  { key: "how_to", label: "How-To", desc: "Outcome, then steps" },
];

export function useTemplateStyles() {
  const [templates, setTemplates] = useState(FALLBACK_TEMPLATES);
  useEffect(() => {
    let live = true;
    api.get("/template-styles")
      .then(({ data }) => { if (live && data?.templates?.length) setTemplates(data.templates); })
      .catch(() => { /* fallback list already rendered */ });
    return () => { live = false; };
  }, []);
  return templates;
}
