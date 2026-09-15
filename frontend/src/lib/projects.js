import { FileText, Layers, Film, Presentation, Image as ImageIcon } from "lucide-react";

// A post IS a project the moment it exists — every draft, scheduled and
// published post lives in the same `posts` table already. This is just the
// shared display vocabulary for the two places that browse them: the full
// Projects page and the compact picker inside the Composer's own start menu.
export const STATUS_META = {
  draft: { label: "Draft", dotClassName: "bg-zinc-500", badgeClassName: "border-white/15 bg-white/5 text-zinc-400" },
  scheduled: { label: "Scheduled", dotClassName: "bg-iris", badgeClassName: "border-iris/30 bg-iris/10 text-iris" },
  published: { label: "Published", dotClassName: "bg-lime", badgeClassName: "border-lime/30 bg-lime/10 text-lime" },
};

export const FORMAT_ICON = {
  carousel: Layers,
  reel: Film,
  single: ImageIcon,
  story: ImageIcon,
  thread: FileText,
  text: FileText,
};

// What a project card actually shows as its one-line description — the
// caption if there is one, otherwise the title, otherwise "Untitled".
export function projectSummary(p) {
  return (p.content || "").trim() || p.title || "Untitled post";
}
