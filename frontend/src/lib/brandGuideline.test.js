import { COLOR_FIELDS, TYPE_ROLES, getTypeStyle, guidelineFonts, sceneTypography, sceneTypeRole, sceneLogoLayout, sceneLogoSettings, brandLogoUrls, isBrandLogoElement } from "./brandGuideline";

test("legacy kits inherit the existing hierarchy and family defaults", () => {
  expect(getTypeStyle({ fonts: { display: "Montserrat" } }, TYPE_ROLES[0]))
    .toMatchObject({ font: "Montserrat", size: 22, weight: 800 });
  expect(getTypeStyle(null, TYPE_ROLES[4])).toMatchObject({ font: "Inter", size: 8.5 });
  expect(COLOR_FIELDS.map((c) => c.label)).toEqual(["Background", "Text", "Accent", "Muted"]);
});

test("saved role overrides drive the guideline and required fonts", () => {
  const brand = { guideline: { typography: { h1: { font: "Lora", size: "32", weight: 700, line_height: "1.5", usage: "Campaign headlines" } } } };
  expect(getTypeStyle(brand, TYPE_ROLES[0])).toMatchObject({ font: "Lora", size: 32, weight: 700, line_height: 1.5, usage: "Campaign headlines" });
  expect(guidelineFonts(brand).h1).toBe("Lora");
});

test("empty, out-of-range and malformed values fall back safely", () => {
  const brand = { guideline: { typography: { h1: { font: "", size: -1, weight: "invalid", line_height: "", usage: "" } } } };
  expect(getTypeStyle(brand, TYPE_ROLES[0])).toMatchObject({ font: "Inter", size: 22, weight: 800, line_height: 1.2, usage: "" });
});

test("scene roles override legacy local sizes and scale consistently", () => {
  const brand = { guideline: { typography: { h1: { size: 64, font: "Lora", weight: 700, line_height: 1.5 }, body: { size: 32 } } } };
  for (const width of [68, 375, 440, 480, 850, 1080]) {
    expect(sceneTypography(brand, { role: "heading", fontSize: 99 }, width)).toMatchObject({ font: "Lora", size: 64 * width / 850, weight: 700, line_height: 1.5 });
  }
  expect(sceneTypeRole({ role: "body", fontKind: "display" })).toBe("body");
  expect(sceneTypeRole({ role: "title", brandTypeRole: "h2" })).toBe("h2");
  expect(sceneTypeRole({ role: "footer" })).toBe("caption");
  expect(sceneTypeRole({ fontKind: "display" })).toBe("h1");
  expect(sceneTypography(null, {}, 850).size).toBe(10);
});

test("logo placement and dimensions share a bounded reference scale", () => {
  expect(sceneLogoSettings(null)).toEqual({ position: "bottom-right", width: 120, inset: 24 });
  expect(sceneLogoLayout(null, 425)).toMatchObject({ width: 60, height: 60, right: 12, bottom: 12, objectFit: "contain" });
  expect(sceneLogoLayout({ guideline: { logo_position: "top-left", logo_width: 140, logo_inset: 34 } }, 850)).toMatchObject({ width: 140, top: 34, left: 34 });
  expect(sceneLogoLayout({ guideline: { logo_position: "center" } }, 850)).toMatchObject({ top: "50%", left: "50%", transform: "translate(-50%, -50%)" });
  expect(sceneLogoSettings({ guideline: { logo_position: "nonsense", logo_width: -1, logo_inset: 900 } })).toEqual(sceneLogoSettings(null));
});

test("logo variants fall back without duplicating imported brand elements", () => {
  const brand = { logo_url: "main.png", guideline: { logos: { color: "color.png", black_on_white: "main.png", white_on_black: "white.png" } } };
  expect(brandLogoUrls(brand)).toEqual(["color.png", "main.png", "white.png"]);
  expect(brandLogoUrls(null)).toEqual([]);
  expect(isBrandLogoElement({ type: "image", url: "main.png" }, brand)).toBe(true);
  expect(isBrandLogoElement({ type: "image", role: "logo", url: "old.png" }, brand)).toBe(true);
  expect(isBrandLogoElement({ type: "image", url: "photo.png" }, brand)).toBe(false);
});
