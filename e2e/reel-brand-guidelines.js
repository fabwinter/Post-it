// Isolated real-browser regression, including decoded exported video pixels.
// Run against serve.py: node reel-brand-guidelines.js
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const B = process.env.E2E_BASE_URL || "http://127.0.0.1:8123";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/*", route => route.request().url().startsWith(B) || /^(data:|blob:)/.test(route.request().url()) ? route.continue() : route.abort());
  const logo = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#ff00ff"/></svg>');
  const kitResponse = await page.request.post(B + "/api/brand-kits", { data: { name: "Reel guideline QA" } });
  assert.ok(kitResponse.ok());
  const kit = await kitResponse.json();
  const updated = await page.request.put(B + "/api/brand-kits/" + kit.id, { data: {
    name: "Reel guideline QA", logo_url: logo,
    fonts: { display: "Open Sauce", body: "Open Sauce" },
    guideline: { logo_position: "bottom-right", logo_width: 140, logo_inset: 34,
      typography: { h1: { size: 64, weight: 700, line_height: 1.25 }, body: { size: 32, weight: 400 }, caption: { size: 20 } } }
  } });
  assert.ok(updated.ok());
  const assets = [
    { type: "scene", spec: { template: "slide", theme: "brand", heading: "Standard scene", body: "Brand sized body text.", aspect: "9:16", clip: { hold: 1 }, index: 1, total: 2, coverCounts: false } },
    { type: "scene", spec: { template: "slide", theme: "brand", heading: "Custom scene", aspect: "9:16", clip: { hold: 1 }, elements: [
      { id: "heading", type: "text", role: "heading", text: "Custom scene", x: 8, y: 25, w: 84, h: 20, fontSize: 90, fontWeight: 800 },
      { id: "body", type: "text", role: "body", text: "Local size must not win.", x: 8, y: 48, w: 84, h: 20, fontSize: 90 },
      { id: "old-logo", type: "image", role: "logo", url: logo, x: 0, y: 0, w: 30, h: 30 },
    ] } },
  ];
  const postResponse = await page.request.post(B + "/api/posts", { data: { title: "Reel brand QA", format: "reel", platforms: ["instagram"], brand_kit_id: kit.id, assets } });
  assert.ok(postResponse.ok());
  const post = await postResponse.json();
  try {
    await page.goto(B + "/");
    await page.evaluate(id => {
      history.pushState({ usr: { postId: id }, key: "brand-qa" }, "", "/composer");
      dispatchEvent(new PopStateEvent("popstate"));
    }, post.id);
    await page.getByTestId("composer-slide-1").waitFor();
    await page.getByTestId("composer-reel-view-play").click();
    const stage = page.getByTestId("reel-player-stage");
    for (const index of [0, 1]) {
      await page.getByTestId(`reel-player-seg-${index}`).click();
      await stage.locator('[data-reel-logo-status="ready"]').waitFor();
      const check = await stage.evaluate(el => {
        const card = el.querySelector("[data-reel-scene]");
        const heading = card.querySelector('[data-scene-text="heading"]');
        const logo = card.querySelector("[data-reel-logo]");
        const box = card.getBoundingClientRect(), image = logo.getBoundingClientRect();
        return { width: box.width, size: parseFloat(getComputedStyle(heading).fontSize), weight: getComputedStyle(heading).fontWeight,
          logos: card.querySelectorAll("img").length, right: box.right - image.right, bottom: box.bottom - image.bottom, logoWidth: image.width };
      });
      assert.ok(Math.abs(check.size / check.width - 64 / 850) < 0.001, JSON.stringify(check));
      assert.equal(check.weight, "700");
      assert.equal(check.logos, 1, "custom logo must not duplicate managed logo");
      for (const edge of ["right", "bottom"]) assert.ok(Math.abs(check[edge] / check.width - 34 / 850) < 0.002, JSON.stringify(check));
      assert.ok(Math.abs(check.logoWidth / check.width - 140 / 850) < 0.002);
      await stage.screenshot({ path: `/tmp/postit-reel-scene-${index}.png` });
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await stage.screenshot({ path: "/tmp/postit-reel-mobile.png" });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "mobile viewport overflow");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByTestId("composer-reel-view-canvas").click();
    await page.getByTestId("composer-element-chip-heading").click();
    await page.getByTestId("composer-scene-typography-role").selectOption("h2");
    assert.equal(await page.getByTestId("composer-element-size").count(), 0, "do not offer ignored local size controls");
    assert.match(await page.getByTestId("composer-scene-typography").innerText(), /16px/);
    await page.getByTestId("composer-scene-typography-role").selectOption("");
    await page.getByTestId("composer-reel-export").click();
    await page.getByTestId("reel-export-preset-480").click();
    await page.evaluate(() => {
      const original = URL.createObjectURL.bind(URL);
      URL.createObjectURL = blob => { const url = original(blob); if (blob.type.startsWith("video/")) window.__videoUrl = url; return url; };
    });
    await page.getByTestId("reel-export-start").click();
    await page.getByTestId("reel-export-done").waitFor({ timeout: 90000 });
    const download = page.waitForEvent("download");
    await page.getByTestId("reel-export-download").click();
    await (await download).saveAs("/tmp/postit-reel-brand-export.webm");
    const pixels = await page.evaluate(async () => {
      const video = document.createElement("video");
      video.muted = true;
      video.src = window.__videoUrl;
      await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; });
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d"), frames = [];
      for (const time of [0.5, 1.5]) {
        await new Promise(resolve => { video.onseeked = resolve; video.currentTime = time; });
        ctx.drawImage(video, 0, 0);
        const x = Math.round(canvas.width * (1 - (34 + 70) / 850));
        const y = Math.round(canvas.height - canvas.width * (34 + 70) / 850);
        frames.push(Array.from(ctx.getImageData(x, y, 1, 1).data));
      }
      return { width: canvas.width, height: canvas.height, frames };
    });
    assert.equal(pixels.width, 480);
    for (const rgba of pixels.frames) assert.ok(rgba[0] > 200 && rgba[1] < 60 && rgba[2] > 200, "logo missing in exported scene: " + rgba);
    // A missing preferred lockup falls back to the primary upload.
    await page.request.put(B + "/api/brand-kits/" + kit.id, { data: { guideline: { logos: { color: B + "/api/missing-logo.png" } } } });
    await page.reload();
    await page.getByTestId("composer-reel-view-play").click();
    await stage.locator('[data-reel-logo-status="ready"]').waitFor();
    assert.equal(await stage.locator("[data-reel-logo]").getAttribute("src"), logo);
    // When every URL fails, export must report the failure, not succeed.
    await page.request.put(B + "/api/brand-kits/" + kit.id, { data: { logo_url: B + "/api/missing-logo.png", guideline: { logos: {} } } });
    await page.reload();
    await page.getByTestId("composer-reel-export").click();
    await page.getByTestId("reel-export-preset-480").click();
    await page.getByTestId("reel-export-start").click();
    await page.getByText("The Brand Kit logo could not be loaded.", { exact: false }).waitFor({ timeout: 20000 });
    assert.equal(await page.getByTestId("reel-export-done").count(), 0);
    // Keep the isolated preview usable after the deliberate error fixture.
    await page.request.put(B + "/api/brand-kits/" + kit.id, { data: { logo_url: logo, guideline: { logos: {}, logo_position: "bottom-right", logo_width: 140, logo_inset: 34 } } });
    assert.deepEqual(errors, []);
    console.log("PASS: standard/custom role typography, proportional preview sizes, duplicate suppression, bottom-right logo/inset, mobile fit, and logo pixels in BOTH exported scenes.", pixels);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
