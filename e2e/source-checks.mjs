// Checks that need no browser and no server — rules about the source itself,
// where a runtime test either can't see the fault or only sees it on a
// browser this harness doesn't run.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "frontend", "src");

let failed = 0;
const ok = (name, pass, detail) => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || detail === undefined ? "" : `  -> ${detail}`}`);
  if (!pass) failed++;
};

function jsFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return jsFiles(full);
    return /\.(js|jsx)$/.test(entry) ? [full] : [];
  });
}

const files = jsFiles(SRC);

// ---- saving a file goes through one helper ----
//
// Downloading used to be hand-rolled in five places, and three of them got it
// wrong the same way:
//
//   a.click();
//   URL.revokeObjectURL(blobUrl);   // <- synchronous
//
// A click only STARTS a download; the browser reads the object URL after it
// returns, so revoking on the next line can pull the bytes away mid-flight.
// The click still registers, the success toast still fires, and no file ever
// lands — "it looks like it downloaded but there's no file anywhere".
//
// This can't be caught at runtime here: headless Chromium happens to snapshot
// the blob at click time and saves the file anyway, so the bug is invisible in
// this harness and shows up only on the browsers that don't. What can be
// checked is that nobody hand-rolls the save again. downloadBlob (which
// appends the anchor, clicks it, and revokes on a timer) is the only place
// allowed to.
const SAVER = join(SRC, "lib", "videoExport.js");
const offenders = files.filter((f) => {
  if (f === SAVER) return false;
  const text = readFileSync(f, "utf8");
  return text.includes("URL.createObjectURL") && /\.click\(\)/.test(text);
});
ok("no file hand-rolls a download instead of using downloadBlob",
   offenders.length === 0, offenders.map((f) => relative(ROOT, f)).join(", "));

// A revoke on the line after the click is the specific mistake; ban it
// outright so it can't come back inside the helper either.
const syncRevoke = files.filter((f) => /\.click\(\);?\s*\n\s*URL\.revokeObjectURL/.test(readFileSync(f, "utf8")));
ok("no object URL is revoked in the same breath as the click that reads it",
   syncRevoke.length === 0, syncRevoke.map((f) => relative(ROOT, f)).join(", "));

// ---- the anchor has to be in the document ----
// Some browsers ignore `download` on an anchor that was never attached.
const helper = readFileSync(SAVER, "utf8");
ok("downloadBlob attaches its anchor before clicking it",
   /appendChild\(a\)[\s\S]{0,80}a\.click\(\)/.test(helper));
ok("...and revokes on a timer, after the browser has had the bytes",
   /setTimeout\(\(\) => URL\.revokeObjectURL/.test(helper));

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
