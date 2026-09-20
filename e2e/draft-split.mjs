// Pure checks for turning a hand-written draft into cards, run before the
// browser tests. draftSlides.js has no imports and no DOM, so the splitting
// rules can be pinned down exactly here — which matters because the whole
// promise of this path is "what you typed is what lands on the cards", and
// a browser test can only ever show you a few of the shapes people write in.
import { pathToFileURL } from "node:url";
import path from "node:path";

const mod = await import(pathToFileURL(path.resolve("frontend/src/lib/draftSlides.js")).href);
const { splitDraftIntoCards } = mod;

let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  -> ${extra}`}`);
  if (!cond) failed++;
};

// --- nothing in, nothing out ---
ok("empty input makes no cards", splitDraftIntoCards("").length === 0);
ok("whitespace only makes no cards", splitDraftIntoCards("   \n\n  \n").length === 0);
ok("null is tolerated", splitDraftIntoCards(null).length === 0);

// --- a blank line is the break ---
const paras = splitDraftIntoCards("First idea.\n\nSecond idea.\n\nThird idea.");
ok("a blank line starts a new card", paras.length === 3, JSON.stringify(paras));
ok("...and the words are carried over verbatim", paras[1].body === "Second idea.", JSON.stringify(paras[1]));
ok("...with several blank lines counting as one break",
   splitDraftIntoCards("One.\n\n\n\nTwo.").length === 2);
ok("...and Windows line endings handled the same",
   splitDraftIntoCards("One.\r\n\r\nTwo.").length === 2);

// --- heading vs body inside one card ---
const titled = splitDraftIntoCards("Week one\nYou publish and nobody claps.");
ok("a short first line becomes the heading", titled[0].heading === "Week one", JSON.stringify(titled[0]));
ok("...and the rest becomes the body",
   titled[0].body === "You publish and nobody claps.", JSON.stringify(titled[0]));
const longFirst = splitDraftIntoCards(
  "This opening line is quite a lot longer than a heading has any business being, truly.\nAnd a second line.");
ok("a long first line is body, not a truncated heading", longFirst[0].heading === "", JSON.stringify(longFirst[0]));
const single = splitDraftIntoCards("Just the one line.");
ok("a lone line is body, so no heading gets invented", single[0].heading === "" && single[0].body === "Just the one line.",
   JSON.stringify(single[0]));

// --- a list is one card per item ---
const numbered = splitDraftIntoCards("1. Ship weekly\n2. Cut the intro\n3. Reply to everyone");
ok("a numbered list is one card per item", numbered.length === 3, JSON.stringify(numbered));
ok("...with the marker stripped", numbered[0].body === "Ship weekly", JSON.stringify(numbered[0]));
const dashes = splitDraftIntoCards("- First\n- Second\n- Third");
ok("a dash list splits the same way", dashes.length === 3, JSON.stringify(dashes));
ok("bullet characters work too", splitDraftIntoCards("• One\n• Two").length === 2);
ok("paren-numbered items work too", splitDraftIntoCards("1) One\n2) Two").length === 2);

const led = splitDraftIntoCards("Three things I learned:\n- First\n- Second");
ok("a line introducing a list is its own card", led.length === 3, JSON.stringify(led));
ok("...and it keeps its own words", led[0].body === "Three things I learned:", JSON.stringify(led[0]));

const wrapped = splitDraftIntoCards("- First item\n  which wraps onto another line\n- Second item");
ok("an unmarked line inside a list continues the item above it", wrapped.length === 2, JSON.stringify(wrapped));
ok("...joined onto that item's body",
   wrapped[0].body === "First item which wraps onto another line", JSON.stringify(wrapped[0]));

// One dash in a sentence is punctuation. Splitting on it would chop ordinary
// prose into fragments, which is the opposite of leaving the draft alone.
const oneDash = splitDraftIntoCards("It was fine — until it wasn't.\nThen we shipped.");
ok("a single dashed line is not treated as a list", oneDash.length === 1, JSON.stringify(oneDash));

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
