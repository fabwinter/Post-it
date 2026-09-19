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

// Mirrors SCRIPT_STYLES in backend/server.py — the shape a reel/Short's
// scenes get written to. Same deal as above: this copy paints first, the
// server's list replaces it, and the keys are what build-post reads.
export const FALLBACK_SCRIPT_STYLES = [
  { key: "standard", label: "Standard", desc: "Hook, problem, payoff, one-line CTA" },
  { key: "viral-short", label: "Viral YouTube Short", desc: "Hook → rehook → twist → payoff, then a hard cut" },
];

export function useScriptStyles() {
  const [styles, setStyles] = useState(FALLBACK_SCRIPT_STYLES);
  useEffect(() => {
    let live = true;
    api.get("/script-styles")
      .then(({ data }) => { if (live && data?.styles?.length) setStyles(data.styles); })
      .catch(() => { /* fallback list already rendered */ });
    return () => { live = false; };
  }, []);
  return styles;
}
