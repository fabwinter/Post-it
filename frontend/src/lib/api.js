import axios from "axios";
import { getToken, setToken } from "@/lib/auth";

// Empty by default so requests resolve relative to the current origin
// (e.g. Vercel serving the frontend and the /api functions together).
// Set REACT_APP_BACKEND_URL only when the API lives on a different origin.
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API });

// Attaches the shared access code once one is stored — a no-op if the
// backend has no APP_ACCESS_TOKEN configured, since it ignores the header
// entirely in that case. See lib/auth.js.
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// A 401 means the stored code is missing, wrong, or was rotated server-side
// — clear it and tell <AuthGate> to show the lock screen again, from
// wherever in the app the call happened to come from.
api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error?.response?.status === 401) {
      setToken("");
      window.dispatchEvent(new Event("postit:unauthorized"));
    }
    return Promise.reject(error);
  }
);

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
