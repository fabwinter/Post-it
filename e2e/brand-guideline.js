// Focused regression: editor -> live guideline -> API -> reload -> PNG.
// Run against serve.py, or: bash run.sh brand-guideline.js
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const B = process.env.E2E_BASE_URL || "http://127.0.0.1:8123";
  const field = (id) => page.getByTestId(id);
  try {
    await page.goto(B + "/brand");
    await field("brand-name").fill("Guideline QA");
    const h1 = field("brand-guideline-doc-h1");
    assert.equal(await h1.evaluate((el) => getComputedStyle(el).fontSize), "22px");
    await field("brand-font-display").selectOption("Lora");
    assert.match(await h1.evaluate((el) => getComputedStyle(el).fontFamily), /Lora/);
    await field("brand-type-h1-font").selectOption("Montserrat");
    await field("brand-type-h1-size").fill("32");
    await field("brand-type-h1-weight").selectOption("700");
    await field("brand-type-h1-line-height").fill("1.5");
    await field("brand-type-h1-usage").fill("Campaign headlines only.");
    await field("brand-guideline-naming").fill("Always write Post-it, never POSTIT.");
    await field("brand-guideline-logo-position").selectOption("bottom-right");
    await field("brand-guideline-logo-placement-notes").fill("Keep 24px inside the safe area.");
    await field("brand-guideline-color-usage").fill("Use accent sparingly.");
    await field("brand-color-bg-hex").fill("#123456");
    await field("brand-color-mode-light").click();
    await field("brand-color-bg-hex").fill("#FEDCBA");
    const doc = field("brand-guideline-doc");
    for (const text of ["Post-it, never POSTIT", "Bottom right", "24px inside", "Use accent sparingly", "#123456", "#FEDCBA", "32px", "Campaign headlines only."]) {
      assert.ok((await doc.innerText()).includes(text), text);
    }
    assert.equal(await h1.evaluate((el) => getComputedStyle(el).fontSize), "32px");
    assert.equal(await h1.evaluate((el) => getComputedStyle(el).fontWeight), "700");
    assert.equal(await h1.evaluate((el) => getComputedStyle(el).lineHeight), "48px");
    const saved = page.waitForResponse((r) => r.url().includes("/api/brand-kits") && ["PUT", "POST"].includes(r.request().method()));
    await field("brand-guideline-save").click();
    const response = await saved;
    assert.ok(response.ok());
    const kit = await response.json();
    assert.equal(kit.guideline.typography.h1.font, "Montserrat");
    assert.equal(kit.guideline.logo_position, "bottom-right");
    await page.reload();
    await field("brand-name").waitFor();
    assert.equal(await field("brand-type-h1-size").inputValue(), "32");
    assert.equal(await field("brand-guideline-logo-position").inputValue(), "bottom-right");
    await field("brand-type-h1-inherit").click();
    assert.equal(await field("brand-type-h1-font").inputValue(), "Lora");
    // Empty and out-of-range numeric fields must never render NaN/negative CSS.
    await field("brand-type-h1-size").fill("");
    await field("brand-type-h1-usage").click();
    assert.equal(await h1.evaluate((el) => getComputedStyle(el).fontSize), "22px");
    await field("brand-type-h1-size").fill("999");
    await field("brand-type-h1-usage").click();
    assert.equal(await field("brand-type-h1-size").inputValue(), "96");
    await field("brand-type-h1-size").fill("32");
    await doc.screenshot({ path: "/tmp/postit-guideline-sheet.png" });
    await field("brand-type-h1-font").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/tmp/postit-brand-desktop.png" });
    await page.setViewportSize({ width: 375, height: 812 });
    await field("brand-type-h1-font").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/tmp/postit-brand-mobile.png" });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no page-wide mobile overflow");
    await page.setViewportSize({ width: 1440, height: 1000 });
    const download = page.waitForEvent("download", { timeout: 60000 });
    await field("brand-guideline-download").click();
    await (await download).saveAs("/tmp/postit-guideline-export.png");
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log("PASS: legacy defaults, family inheritance, live styles, naming, logo position, both palettes, save/reload, numeric boundaries, mobile fit and PNG download.");
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
