import { COLOR_FIELDS, TYPE_ROLES, getTypeStyle, guidelineFonts } from "./brandGuideline";

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
