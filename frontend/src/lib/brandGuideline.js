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
  ["", "Bottom right (default)"], ["top-left", "Top left"], ["top-center", "Top centre"],
  ["top-right", "Top right"], ["center", "Centre"],
  ["bottom-left", "Bottom left"], ["bottom-center", "Bottom centre"], ["bottom-right", "Bottom right"],
];

export const GUIDELINE_REF_WIDTH = 850;
export const DEFAULT_LOGO_WIDTH = 120;
export const DEFAULT_LOGO_INSET = 24;

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

// The guideline's CSS pixels have one reference width everywhere, including
// video. Do not reuse these numbers as 440px template pixels.
export function sceneTypeRole(element = {}) {
  if (TYPE_ROLES.some((r) => r.key === element.brandTypeRole)) return element.brandTypeRole;
  const role = element.role || element.role_hint;
  if (["title", "heading", "h1"].includes(role)) return "h1";
  if (["subheading", "subtitle", "h2"].includes(role)) return "h2";
  if (role === "h3") return "h3";
  if (role === "body") return "body";
  if (["caption", "label", "kicker", "number", "step", "brand", "footer"].includes(role)) return "caption";
  return element.fontKind === "display" ? "h1" : "body";
}

export function sceneTypography(brand, element = {}, width = GUIDELINE_REF_WIDTH) {
  const key = sceneTypeRole(element);
  const type = getTypeStyle(brand, TYPE_ROLES.find((r) => r.key === key));
  return { ...type, size: type.size * width / GUIDELINE_REF_WIDTH };
}

export function brandLogoUrls(brand) {
  const logos = brand?.guideline?.logos || {};
  const mono = brand?.color_mode === "light" ? logos.black_on_white : logos.white_on_black;
  return [...new Set([logos.color, brand?.logo_url, mono, logos.black_on_white, logos.white_on_black]
    .filter((url) => typeof url === "string" && url.trim()))];
}

export function isBrandLogoElement(element, brand) {
  return brandLogoUrls(brand).length > 0 && element.type === "image" &&
    (["logo", "brand_logo"].includes(element.role) || brandLogoUrls(brand).includes(element.url));
}

export function sceneLogoSettings(brand) {
  const g = brand?.guideline || {};
  const position = LOGO_POSITIONS.some(([p]) => p && p === g.logo_position) ? g.logo_position : "bottom-right";
  return { position, width: bounded(g.logo_width, DEFAULT_LOGO_WIDTH, 24, 300), inset: bounded(g.logo_inset, DEFAULT_LOGO_INSET, 0, 150) };
}

export function sceneLogoLayout(brand, width) {
  const settings = sceneLogoSettings(brand);
  const { position } = settings;
  const k = width / GUIDELINE_REF_WIDTH;
  const size = settings.width * k;
  const inset = settings.inset * k;
  const centeredX = position.endsWith("center") || position === "center";
  const centeredY = position === "center";
  return {
    position: "absolute", width: size, height: size,
    ...(position.startsWith("top") ? { top: inset } : centeredY ? { top: "50%" } : { bottom: inset }),
    ...(position.endsWith("left") ? { left: inset } : centeredX ? { left: "50%" } : { right: inset }),
    transform: centeredX ? `translate(-50%, ${centeredY ? "-50%" : "0"})` : undefined,
    objectFit: "contain",
    objectPosition: `${centeredX ? "center" : position.endsWith("left") ? "left" : "right"} ${centeredY ? "center" : position.startsWith("top") ? "top" : "bottom"}`,
    zIndex: 20, pointerEvents: "none",
  };
}
