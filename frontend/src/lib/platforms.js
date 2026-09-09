import { Twitter, Linkedin, Instagram, Youtube, Facebook, AtSign, Music2 } from "lucide-react";

export const PLATFORMS = {
  twitter: { key: "twitter", name: "X", handle: "@yourhandle", icon: Twitter, color: "#E7E9EA", limit: 280 },
  linkedin: { key: "linkedin", name: "LinkedIn", handle: "Your Name", icon: Linkedin, color: "#0A66C2", limit: 3000 },
  instagram: { key: "instagram", name: "Instagram", handle: "yourhandle", icon: Instagram, color: "#E4405F", limit: 2200 },
  tiktok: { key: "tiktok", name: "TikTok", handle: "@yourhandle", icon: Music2, color: "#25F4EE", limit: 2200 },
  youtube: { key: "youtube", name: "YouTube", handle: "Your Channel", icon: Youtube, color: "#FF0000", limit: 5000 },
  threads: { key: "threads", name: "Threads", handle: "@yourhandle", icon: AtSign, color: "#EDEDED", limit: 500 },
  facebook: { key: "facebook", name: "Facebook", handle: "Your Page", icon: Facebook, color: "#1877F2", limit: 5000 },
};

export const PLATFORM_LIST = Object.values(PLATFORMS);

export function platformOf(key) {
  return PLATFORMS[key] || PLATFORMS.twitter;
}
