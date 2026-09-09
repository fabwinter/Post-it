// The history panel is reachable from every screen, and screens that are not
// its parent (Composer's "insert from history", Studio's "recent renders") need
// to open it too. A DOM event beats threading an open handler through every
// page or hoisting a context nobody else needs.
const EVENT = "createos:open-history";

export function openHistory(filter = "all") {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { filter } }));
}

export function onOpenHistory(handler) {
  const fn = (e) => handler(e.detail?.filter || "all");
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
