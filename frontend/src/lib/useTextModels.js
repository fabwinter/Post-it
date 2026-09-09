import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// Fetched once per page load and shared across every component that asks —
// there's no reason for Studio, Repurpose, and Visuals to each hit /ai/models.
let cached = null;

async function loadModels() {
  if (cached) return cached;
  try {
    const { data } = await api.get("/ai/models");
    cached = { models: data.models || [], default: data.default || "" };
  } catch {
    cached = { models: [], default: "" };
  }
  return cached;
}

// Returns the PoYo chat models available for text generation (ideate, write,
// repurpose, visual copy), discovered from the backend, plus its default.
// `fallbackDefault` covers the window before the fetch resolves.
export function useTextModels(fallbackDefault) {
  const [state, setState] = useState({ models: [], default: fallbackDefault });
  useEffect(() => {
    let alive = true;
    loadModels().then((r) => {
      if (alive) setState({ models: r.models, default: r.default || fallbackDefault });
    });
    return () => { alive = false; };
  }, [fallbackDefault]);
  return state;
}
