import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// Verified against PoYo's live model catalog (poyo_search_models, service_type:
// chat) — all 27 returned "stable". Used whenever /ai/models comes back empty,
// which is the normal case: PoYo doesn't expose a public /v1/models endpoint.
export const CHAT_MODELS = [
  "claude-fable-5", "claude-fable-5-1",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-5-20251101", "claude-opus-4-6", "claude-opus-4-7", "claude-opus-4-7-thinking", "claude-opus-4-8", "claude-opus-5",
  "claude-sonnet-4-5-20250929", "claude-sonnet-4-6", "claude-sonnet-5",
  "deepseek-v4-flash", "deepseek-v4-pro",
  "gemini-3-flash-preview", "gemini-3-pro-preview", "gemini-3.1-pro-preview", "gemini-3.5-flash", "gemini-3.7-flash",
  "gpt-5", "gpt-5.4", "gpt-5.5", "gpt-5-6-luna", "gpt-5-6-sol", "gpt-5-6-terra",
  "grok-4.6",
  "kimi-k3",
];

// Fetched once per page load and shared across every component that asks —
// there's no reason for Studio, Repurpose, and Visuals to each hit /ai/models.
let cached = null;

async function loadModels() {
  if (cached) return cached;
  try {
    const { data } = await api.get("/ai/models");
    const models = data.models && data.models.length ? data.models : CHAT_MODELS;
    cached = { models, default: data.default || "" };
  } catch {
    cached = { models: CHAT_MODELS, default: "" };
  }
  return cached;
}

// Returns the PoYo chat models available for text generation (ideate, write,
// repurpose, visual copy), discovered from the backend when it has a real
// list, falling back to the verified static catalog otherwise. `fallbackDefault`
// covers the window before the fetch resolves.
export function useTextModels(fallbackDefault) {
  const [state, setState] = useState({ models: CHAT_MODELS, default: fallbackDefault });
  useEffect(() => {
    let alive = true;
    loadModels().then((r) => {
      if (alive) setState({ models: r.models, default: r.default || fallbackDefault });
    });
    return () => { alive = false; };
  }, [fallbackDefault]);
  return state;
}
