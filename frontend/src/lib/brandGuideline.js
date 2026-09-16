// Shared by the Brand Kit editor and its printable guideline.
// Keep the persisted palette keys compatible with existing renderers.
export const COLOR_FIELDS = [
  { key: "bg", label: "Background", usage: "Canvas and large background areas." },
  { key: "fg", label: "Text", usage: "Headings and primary body text." },
  { key: "accent", label: "Accent", usage: "Highlights, emphasis and calls to action." },
  { key: "sub", label: "Muted", usage: "Secondary text and supporting details." },
];

export const TYPE_ROLES = [
  { key: "h1", label: "Heading / H1", font: "display", size: 22, weight: 800, line_height: 1.2, usage: "Main headlines." },
  { key: "h2", label: "Subheading / H2", font: "display", size: 16, weight: 700, line_height: 1.2, usage: "Section headings." },
  { key: "h3", label: "Subheading / H3", font: "body", size: 12.5, weight: 600, line_height: 1.2, usage: "Supporting headings." },
  { key: "body", label: "Body text", font: "body", size: 10, weight: 400, line_height: 1.3, usage: "Paragraphs and descriptions." },
  { key: "caption", label: "Caption", font: "body", size: 8.5, weight: 400, line_height: 1.3, usage: "Captions and fine print." },
];

export const WEIGHTS = { 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold" };
export const LOGO_POSITIONS = [
  ["", "Not specified"], ["top-left", "Top left"], ["top-center", "Top centre"],
  ["top-right", "Top right"], ["center", "Centre"],
  ["bottom-left", "Bottom left"], ["bottom-center", "Bottom centre"], ["bottom-right", "Bottom right"],
];

const bounded = (value, fallback, min, max) => {
  const n = Number(value);
  return value !== "" && value != null && Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

export function getTypeStyle(brand, role) {
  const raw = brand?.guideline?.typography?.[role.key] || {};
  return {
    ...role,
    font: raw.font || brand?.fonts?.[role.font] || "Inter",
    size: bounded(raw.size, role.size, 6, 96),
    weight: WEIGHTS[raw.weight] ? Number(raw.weight) : role.weight,
    line_height: bounded(raw.line_height, role.line_height, 1, 3),
    usage: typeof raw.usage === "string" ? raw.usage : role.usage,
  };
}

export function guidelineFonts(brand) {
  return Object.fromEntries(TYPE_ROLES.map((role) => [role.key, getTypeStyle(brand, role).font]));
}
