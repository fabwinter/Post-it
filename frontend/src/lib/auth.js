// The whole access-control model: one shared secret, set as APP_ACCESS_TOKEN
// in the backend's environment. No accounts, no sessions — a visitor who
// knows the code gets full access, same as anyone who could see the backend
// code itself. localStorage remembers it per browser so the lock screen
// only appears once per device.
const KEY = "postit_access_token";

export function getToken() {
  try {
    return localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    // Private browsing / storage disabled — the app still works, it just
    // asks again next reload instead of remembering.
  }
}
