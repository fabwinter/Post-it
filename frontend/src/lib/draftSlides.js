// Turning a written or pasted draft into the cards themselves.
//
// Writing a post by hand used to stop at the caption box: you could type or
// paste a whole post, and the deck stayed empty. The only way to get those
// words onto cards was to retype them one slide at a time, so "write it
// yourself" and "build it" were two disconnected halves of the page.
//
// This is deliberately literal — no model call, no rewording. What you typed
// is what lands on the cards, which is the whole point of having written it
// yourself. Two shapes cover how people actually write a deck:
//
//   - paragraphs separated by a blank line: one paragraph, one card
//   - a run of numbered or bulleted lines: one item, one card, since a list
//     written as a single block still means one idea per line
//
// No imports and no DOM, so e2e/draft-split.mjs can exercise it directly.

const BULLET = /^\s*(?:[-*•–—]|\d+[.)])\s+/;

// A first line becomes the heading only when it reads like one: short, with
// real copy after it. Otherwise the card keeps an empty heading rather than
// inventing one out of a truncated sentence.
const HEADING_MAX = 60;

function asCard(lines) {
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  if (!clean.length) return null;
  if (clean.length > 1 && clean[0].length <= HEADING_MAX) {
    return { heading: clean[0], body: clean.slice(1).join(" ") };
  }
  return { heading: "", body: clean.join(" ") };
}

/**
 * Splits a draft into [{heading, body}], one entry per card.
 * Returns [] for empty or whitespace-only input.
 */
export function splitDraftIntoCards(text) {
  const blocks = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  const cards = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const bulletCount = lines.filter((l) => BULLET.test(l)).length;
    // One stray dash in a paragraph is punctuation, not a list — it takes at
    // least two marked lines before this is a list worth splitting apart.
    if (bulletCount > 1) {
      const first = lines.findIndex((l) => BULLET.test(l));
      // Anything above the first bullet introduces the list, so it is its
      // own card rather than being glued onto item one.
      const lead = asCard(lines.slice(0, first));
      if (lead) cards.push(lead);
      for (const line of lines.slice(first)) {
        // An unmarked line inside the list is a continuation of the item
        // above it, not a card of its own.
        if (BULLET.test(line)) {
          const card = asCard([line.replace(BULLET, "")]);
          if (card) cards.push(card);
        } else if (cards.length) {
          cards[cards.length - 1].body = `${cards[cards.length - 1].body} ${line}`.trim();
        }
      }
      continue;
    }
    const card = asCard(lines);
    if (card) cards.push(card);
  }
  return cards;
}
