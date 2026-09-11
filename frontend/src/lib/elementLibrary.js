import {
  Star, Heart, Zap, Check, ArrowRight, Smile, ThumbsUp, Flame, Sun, Moon, Cloud,
  MessageCircle, Bell, Flag, Gift, Music, Camera, MapPin, Clock, Award, TrendingUp,
  Rocket, Lightbulb, Sparkles as SparklesIcon,
} from "lucide-react";

// Code-defined presets, not stored anywhere — they never change, so there's
// nothing to fetch or migrate. Only a user's own uploaded logos/badges/stamps
// (see ElementsLibrary's "Your uploads" tab) need a backend row.

// Keyed by name so an element can reference an icon by a plain string in its
// JSON spec (`{type:"icon", name:"star", ...}`) — VisualCard looks it up here
// to render the actual glyph.
export const ICON_MAP = {
  star: Star, heart: Heart, zap: Zap, check: Check, "arrow-right": ArrowRight,
  smile: Smile, "thumbs-up": ThumbsUp, flame: Flame, sun: Sun, moon: Moon, cloud: Cloud,
  "message-circle": MessageCircle, bell: Bell, flag: Flag, gift: Gift, music: Music,
  camera: Camera, "map-pin": MapPin, clock: Clock, award: Award, "trending-up": TrendingUp,
  rocket: Rocket, lightbulb: Lightbulb, sparkles: SparklesIcon,
};

export const ICON_ELEMENTS = Object.keys(ICON_MAP).map((key) => ({
  key, label: key.replace(/-/g, " "),
  def: { type: "icon", name: key, w: 14, h: 14, color: "#E2FF3D" },
}));

export const STICKER_ELEMENTS = [
  { key: "fire", label: "Fire", emoji: "🔥" },
  { key: "heart", label: "Heart", emoji: "❤️" },
  { key: "hundred", label: "100", emoji: "💯" },
  { key: "star", label: "Star", emoji: "⭐" },
  { key: "clap", label: "Clap", emoji: "👏" },
  { key: "eyes", label: "Eyes", emoji: "👀" },
  { key: "rocket", label: "Rocket", emoji: "🚀" },
  { key: "check", label: "Check", emoji: "✅" },
  { key: "new", label: "New", emoji: "🆕" },
  { key: "arrow", label: "Arrow", emoji: "➡️" },
  { key: "sparkles", label: "Sparkles", emoji: "✨" },
  { key: "warning", label: "Warning", emoji: "⚠️" },
].map((s) => ({
  ...s, def: { type: "text", text: s.emoji, w: 14, h: 14, fontSize: 40, align: "center", lineHeight: 1 },
}));

export const SHAPE_ELEMENTS = [
  { key: "rect", label: "Rectangle", def: { type: "shape", shape: "rect", w: 30, h: 20, color: "#E2FF3D" } },
  { key: "circle", label: "Circle", def: { type: "shape", shape: "ellipse", w: 22, h: 22, color: "#E2FF3D" } },
  { key: "bar", label: "Bar", def: { type: "shape", shape: "rect", w: 40, h: 4, color: "#E2FF3D" } },
  { key: "dot", label: "Dot", def: { type: "shape", shape: "ellipse", w: 8, h: 8, color: "#E2FF3D" } },
];
