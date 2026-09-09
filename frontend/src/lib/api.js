import axios from "axios";

// Empty by default so requests resolve relative to the current origin
// (e.g. Vercel serving the frontend and the /api functions together).
// Set REACT_APP_BACKEND_URL only when the API lives on a different origin.
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API });

// FastAPI errors arrive as { detail: "..." } in the response body — axios's
// own e.message is usually just "Request failed with status code 500",
// so pull the real reason out when there is one.
export function apiErrorMessage(e, fallback) {
  return e?.response?.data?.detail || e?.message || fallback;
}

export async function pollTask(taskId, onUpdate, { interval = 3000, timeout = 360000 } = {}) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - start > timeout) throw new Error("Generation timed out");
    const { data } = await api.get(`/ai/task/${taskId}`);
    if (onUpdate) onUpdate(data);
    if (data.status === "finished") return data;
    if (data.status === "failed") throw new Error(data.error_message || "Generation failed");
    await new Promise((r) => setTimeout(r, interval));
  }
}
