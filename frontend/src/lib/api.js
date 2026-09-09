import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API });

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
