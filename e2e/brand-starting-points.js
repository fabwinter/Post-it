const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const B = "http://127.0.0.1:8123";
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page.setDefaultTimeout(10000);
  await page.route("**/*", r => r.request().url().startsWith(B) || /^(blob:|data:)/.test(r.request().url()) ? r.continue() : r.abort());
  const json = async response => { assert.ok(response.ok(), await response.text()); return response.json(); };
  const logo = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#ff00ff"/></svg>');
  try {
    const kit = await json(await page.request.post(B + "/api/brand-kits", { data: { name: "Editable brand QA" } }));
    await json(await page.request.put(B + "/api/brand-kits/" + kit.id, { data: {
      logo_url: logo, fonts: { display: "Open Sauce", body: "Open Sauce" },
      guideline: { typography: { h1: { size: 36, weight: 700 }, body: { size: 20 } } }
    } }));
    const request = { topic: "shipping weekly", format: "reel", platform: "instagram", brand_kit_id: kit.id, use_knowledge: false, slides: 3 };
    const plan = await json(await page.request.post(B + "/api/ai/build-post", { data: request }));
    const heading = plan.assets[0].spec.elements.find(e => e.role === "heading");
    const logoElement = plan.assets[0].spec.elements.find(e => e.role === "logo");
    assert.equal(heading.fontSize, 36, "no 850px reduction");
    assert.equal(heading.fontFamily, "Open Sauce");
    assert.ok(logoElement);
    assert.ok(plan.assets.every(a => a.spec.elements.some(e => e.role === "logo")));

    // A deliberately conflicting selected template must win.
    const template = await json(await page.request.post(B + "/api/templates/from-composer", { data: {
      name: "Template beats guidelines", format: "reel", theme: "midnight",
      slides: [0, 1, 2].map(i => ({ template: "slide", heading: "Template title", body: "Body", bg_color: "#123456",
        elements: [{ id: "tpl-" + i, type: "text", role: "heading", text: "Template title", x: 10, y: 20, w: 80, h: 25,
          fontFamily: "Arial", fontSize: 58, fontWeight: 800, color: "#abcdef", lineHeight: 1.1 }] }))
    } }));
    const templated = await json(await page.request.post(B + "/api/ai/build-post", { data: { ...request, custom_template_id: template.id } }));
    for (const asset of templated.assets) {
      const el = asset.spec.elements.find(e => e.type === "text");
      assert.equal(el.fontSize, 58);
      assert.equal(el.fontFamily, "Arial");
      assert.equal(el.color.toLowerCase(), "#abcdef");
      assert.equal(asset.spec.bg_color, "#123456");
      assert.ok(!asset.spec.elements.some(e => e.role === "logo"), "guidelines must not inject a logo into a template");
    }
    plan.assets.forEach(a => { a.spec.clip = { hold: 0.6 }; });
    const post = await json(await page.request.post(B + "/api/posts", { data: {
      title: "Editable QA", format: "reel", platforms: ["instagram"], brand_kit_id: kit.id, assets: plan.assets,
    } }));
    await page.goto(B + "/");
    await page.evaluate(id => { history.pushState({ usr: { postId: id }, key: "editable-qa" }, "", "/composer"); dispatchEvent(new PopStateEvent("popstate")); }, post.id);
    await page.getByTestId("composer-slide-0").waitFor();
    await page.getByTestId("composer-reel-view-canvas").click();
    await page.getByTestId("composer-element-chip-" + heading.id).click();
    await page.getByTestId("composer-element-size").fill("48");
    await page.getByTestId("composer-element-font").selectOption("Arial");
    await page.getByTestId("composer-element-weight").selectOption("500");
    await page.getByTestId("composer-element-color").fill("#ff8800");
    assert.equal(await page.getByTestId("composer-scene-typography").count(), 0);
    await page.getByTestId("composer-open-canvas").click();
    await page.getByTestId("canvas-tool-font").click();
    await page.getByTestId("canvas-element-font").selectOption("Open Sauce");
    await page.getByTestId("canvas-element-font").selectOption("Arial");
    await page.getByTestId("canvas-sheet-close").click();
    await page.getByTestId("canvas-tool-size").click();
    await page.getByTestId("canvas-element-size").focus();
    await page.getByTestId("canvas-element-size").press("ArrowRight");
    assert.equal(await page.getByTestId("canvas-element-size").inputValue(), "49");
    await page.getByTestId("canvas-element-size").press("ArrowLeft");
    await page.getByTestId("canvas-sheet-close").click();
    await page.getByTestId("canvas-editor-done").click();
    await page.getByTestId("composer-element-chip-" + logoElement.id).click();
    await page.getByTestId("composer-element-remove").click();
    assert.equal(await page.getByTestId("composer-element-chip-" + logoElement.id).count(), 0);
    const saved = page.waitForResponse(r => r.url().endsWith("/api/posts/" + post.id) && r.request().method() === "PUT");
    await page.getByTestId("composer-save-draft").click();
    const persisted = await json(await saved);
    assert.equal(persisted.assets[0].spec.elements.find(e => e.id === heading.id).fontSize, 48);
    assert.ok(!persisted.assets[0].spec.elements.some(e => e.role === "logo"));
    await page.request.put(B + "/api/brand-kits/" + kit.id, { data: { guideline: { typography: { h1: { font: "Lora", size: 8 } } } } });
    await page.reload();
    await page.getByTestId("composer-reel-view-canvas").click();
    await page.getByTestId("composer-element-chip-" + heading.id).click();
    assert.equal(await page.getByTestId("composer-element-size").inputValue(), "48");
    assert.equal(await page.getByTestId("composer-element-font").inputValue(), "Arial");
    await page.getByTestId("composer-reel-view-play").click();
    const stage = page.getByTestId("reel-player-stage");
    const actual = await stage.getByText(heading.text, { exact: true }).evaluate(el => ({ size: parseFloat(getComputedStyle(el).fontSize), width: el.parentElement.getBoundingClientRect().width, font: getComputedStyle(el).fontFamily }));
    assert.ok(Math.abs(actual.size / actual.width - 48 / 440) < 0.002, JSON.stringify(actual));
    assert.match(actual.font, /Arial/);
    assert.equal(await stage.locator("img").count(), 0, "deleted logo must not return");
    await stage.screenshot({ path: "/tmp/postit-editable-desktop.png" });
    await page.setViewportSize({ width: 375, height: 812 });
    await stage.screenshot({ path: "/tmp/postit-editable-mobile.png" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByTestId("composer-reel-export").click();
    await page.getByTestId("reel-export-preset-480").click();
    await page.getByTestId("reel-export-start").click();
    await page.getByTestId("reel-export-done").waitFor({ timeout: 60000 });
    const download = page.waitForEvent("download");
    await page.getByTestId("reel-export-download").click();
    await (await download).saveAs("/tmp/postit-editable-export.webm");
    console.log("PASS: creation defaults, template precedence, font/size/weight/colour editing, logo deletion, save/reload, guideline changes cannot reset edits, preview scale, mobile and video export.");
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
