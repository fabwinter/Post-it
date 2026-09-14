// Regenerates fixtures/clip.webm — the stock clip the reel tests use.
//
// It has to be a REAL decodable video. The placeholder before it was 14
// bytes of ASCII, so every <video> element in the harness failed to load and
// no export ever actually composited footage: the render tests only checked
// that a valid container came out at the right duration, which a reel of
// nothing but background and text passes just as happily. That blind spot is
// why "the export is missing its stock videos" reached production more than
// once. Chromium's own MediaRecorder makes a file the same engine can
// decode, which is exactly the guarantee the fixture needs.
//
// Deliberately magenta: no theme background or text colour is anywhere near
// it, so a frame of the exported reel can be sampled to prove the footage
// really landed rather than just that the file opens.
//
// Run: node make-fixture-clip.js   (only needed if the fixture is lost)
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

(async () => {
  // Same preinstalled-browser dance e2e.js does — see its comment.
  const preinstalled = "/opt/pw-browsers/chromium";
  const browser = await chromium.launch(fs.existsSync(preinstalled) ? { executablePath: preinstalled } : {});
  const page = await browser.newPage();
  const b64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d");
    const stream = canvas.captureStream(25);
    const rec = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise((r) => { rec.onstop = r; });
    rec.start();
    const t0 = performance.now();
    await new Promise((done) => {
      const draw = () => {
        const t = performance.now() - t0;
        ctx.fillStyle = "#FF00FF";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // A moving band so the frames genuinely differ from one another.
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(((t / 12) % canvas.width), 0, 18, canvas.height);
        if (t >= 2000) { done(); return; }
        requestAnimationFrame(draw);
      };
      draw();
    });
    rec.stop();
    await stopped;
    const buf = await new Blob(chunks, { type: "video/webm" }).arrayBuffer();
    let s = "";
    for (const byte of new Uint8Array(buf)) s += String.fromCharCode(byte);
    return btoa(s);
  });
  await browser.close();
  const out = path.join(__dirname, "fixtures", "clip.webm");
  fs.writeFileSync(out, Buffer.from(b64, "base64"));
  console.log(`wrote ${out} (${fs.statSync(out).size} bytes)`);
})();
