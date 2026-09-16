// Offline regression: these are injected failures, not live provider findings.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const B = "http://127.0.0.1:8123";
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  await page.route("**/*", r => r.request().url().startsWith(B) || /^(data:|blob:)/.test(r.request().url()) ? r.continue() : r.abort());
  try {
    const response = await page.request.post(B + "/api/posts", { data: {
      title: "Voice diagnostics QA", format: "reel", platforms: ["instagram"],
      assets: [{ type: "scene", spec: { template: "slide", heading: "Hello", body: "A short voice test." } }],
    } });
    const post = await response.json();
    await page.goto(B + "/");
    await page.evaluate(id => { history.pushState({ usr: { postId: id }, key: "voice-qa" }, "", "/composer"); dispatchEvent(new PopStateEvent("popstate")); }, post.id);
    await page.getByTestId("composer-scene-voice-retry").waitFor();
    assert.equal(await page.getByTestId("composer-custom-template-select").locator('option[value=""]').textContent(), "Brand Guidelines (no template)");
    await page.getByTestId("composer-brand-guidelines-help").waitFor();
    await page.getByTestId("composer-brand-kit-select").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/tmp/postit-guidelines-selection.png" });
    const submitError = "Speech provider rejected this voice (injected test error).";
    await page.route("**/api/ai/generate", r => r.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ detail: submitError }) }));
    await page.getByTestId("composer-scene-voice-retry").click();
    await page.getByTestId("composer-scene-voice-error").waitFor();
    assert.equal(await page.getByTestId("composer-scene-voice-error").textContent(), submitError);
    await page.unroute("**/api/ai/generate");
    const taskError = "Speech task failed at provider (injected test error).";
    await page.route("**/api/ai/task/*", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "failed", error_message: taskError }) }));
    await page.getByTestId("composer-scene-voice-retry").click();
    await page.getByText(taskError, { exact: true }).waitFor();
    await page.getByTestId("composer-scene-voice-error").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/tmp/postit-voice-error.png" });
    await page.unroute("**/api/ai/task/*");
    await page.getByTestId("composer-scene-voice-retry").click();
    await page.getByText("Scene 1's voiceover updated", { exact: true }).waitFor({ timeout: 20000 });
    assert.equal(await page.getByTestId("composer-scene-voice-error").count(), 0);
    console.log("PASS: explicit Brand Guidelines design option; submit and task errors retain actual reason; successful retry clears error.");
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
