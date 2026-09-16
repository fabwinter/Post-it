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

// The first frame a project card can show. A reel's only stored media is
// often its scene footage — an .mp4 — and an <img> pointed at one renders a
// broken-image glyph, not a thumbnail, which looked exactly like the card
// failing to load. So a video URL yields nothing here and the card falls
// back to its format icon (Film), which is at least honest about what the
// project is. Anything without a recognizable video extension is still
// treated as an image, so a blob/CDN URL with no extension behaves as before.
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;
export function isVideoUrl(url) {
  return VIDEO_EXT.test(url || "");
}

export function projectThumb(p) {
  const candidates = [p?.media_urls?.[0], p?.assets?.[0]?.spec?.image_url, p?.assets?.[0]?.spec?.video_url];
  const url = candidates.find((u) => u && !isVideoUrl(u));
  return url || "";
}
