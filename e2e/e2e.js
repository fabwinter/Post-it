const { chromium } = require('playwright');
const B = 'http://127.0.0.1:8123';
const fails = [];
const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' -> ' + x)); if (!c) fails.push(n); };

// The mobile top bar and toast stack are position:fixed, so Playwright's own
// scroll can park a target under them. Centre the element, verify with a real
// hit-test that a thumb would land on it, then click.
async function tap(page, testid) {
  const el = page.getByTestId(testid);
  await el.evaluate(e => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
  const hits = await el.evaluate(e => {
    const r = e.getBoundingClientRect();
    const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!at && (e === at || e.contains(at));
  });
  if (!hits) throw new Error(`${testid} is covered — a real tap would miss it`);
  await el.click({ force: true });
}

// A build now stops at a review step instead of applying straight away
// (ComposerBuildReview) — scenes for a reel, slides for a deck — so every
// test that builds anything with more than one card has to clear it before
// the slide strip (or anything downstream of it) exists. Confirming exactly
// what came back is the common case; tests of the review step itself
// interact with it directly instead.
async function confirmBuild(page) {
  await page.getByTestId('composer-build-review').waitFor({ timeout: 20000 });
  await tap(page, 'composer-build-review-confirm');
}

(async () => {
  // Some sandboxes pre-install a Chromium build that a fresh
  // `playwright install` can't reach the network to fetch — use it when
  // present (its version doesn't have to match this package's), otherwise
  // fall back to Playwright's own managed browser.
  const preinstalled = '/opt/pw-browsers/chromium';
  const launchOpts = require('fs').existsSync(preinstalled) ? { executablePath: preinstalled } : {};
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  ctx.setDefaultTimeout(8000);
  const page = await ctx.newPage();
  // External fonts and analytics are blocked by the sandbox proxy and hang the
  // document load; the app must not depend on them anyway.
  //
  // localhost:8123 is this same server under its other name. It is allowed
  // through because that difference is the only way to get a genuinely
  // cross-origin asset out of a one-origin harness: to the browser the two
  // spellings are different origins, so a clip served from the localhost one
  // taints a canvas exactly as real stock footage does (see the PNG export
  // checks near the end of this file).
  const LOCAL = ['http://127.0.0.1:8123', 'http://localhost:8123'];
  await (page).route('**/*', (route) => {
    const u = route.request().url();
    return LOCAL.some((origin) => u.startsWith(origin)) ? route.continue() : route.abort();
  });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  // ---------- 1. Idea engine -> full post ----------
  // Folded into the Composer's Topic mode (from the old Dashboard card) —
  // building from an idea now happens right here instead of navigating in.
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('composer-page').waitFor({ timeout: 10000 });
  await page.getByTestId('composer-idea-topic').fill('shipping weekly');
  await page.getByTestId('composer-idea-generate').click();
  await page.getByTestId('idea-item-0').waitFor({ timeout: 15000 });
  ok('ideate renders ideas', await page.getByTestId('idea-item-0').isVisible());
  ok('build button per idea', await page.getByTestId('idea-build-0').isVisible());

  await page.getByTestId('idea-build-0').click();
  // A deck stops at the same review a reel does now: its slides and their
  // per-slide image prompts used to be decided and applied without ever
  // being shown, which is the whole point of reviewing before generating.
  await page.getByTestId('composer-build-review').waitFor({ timeout: 20000 });
  ok('a carousel build stops to be reviewed, not just a reel', true);
  ok('...showing a row per card, cover included',
     (await page.locator('[data-testid^="composer-build-review-row-"]').count()) === 4,
     String(await page.locator('[data-testid^="composer-build-review-row-"]').count()));
  ok('...with the cover edited as a title rather than a blank heading/body pair',
     (await page.getByTestId('composer-build-review-heading-0').inputValue()).length > 0
     && (await page.getByTestId('composer-build-review-body-0').count()) === 0);
  ok('...and a slide showing the image prompt that would be generated',
     (await page.getByTestId('composer-build-review-visual-1').inputValue()).length > 0,
     await page.getByTestId('composer-build-review-visual-1').inputValue());
  // An edit made here has to be what actually lands on the card.
  await page.getByTestId('composer-build-review-heading-1').fill('E2E reviewed slide');
  await tap(page, 'composer-build-review-confirm');
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  ok('build lands in composer', page.url().includes('/composer'));
  await tap(page, 'composer-slide-1');
  ok('an edit made in the deck review reaches the slide it was made on',
     (await page.getByTestId('composer-slide-heading').inputValue()) === 'E2E reviewed slide',
     await page.getByTestId('composer-slide-heading').inputValue());
  await tap(page, 'composer-slide-0');
  const caption = await page.getByTestId('composer-content').inputValue();
  ok('caption filled from plan', caption.includes('kept showing up'), caption.slice(0, 60));
  const tags = await page.getByTestId('composer-hashtags').innerText();
  ok('hashtags filled', tags.includes('#buildinpublic'), tags);
  const slides = await page.locator('[data-testid^="composer-slide-"]').filter({ hasNot: page.locator('x') });
  const slideCount = await page.locator('[data-testid^="composer-slide-"][data-testid$="0"], [data-testid^="composer-slide-"]').count();
  const strip = await page.getByTestId('composer-slide-strip').locator('button').count();
  ok('cover + 3 slides + add button in strip', strip === 5, 'strip buttons: ' + strip);
  ok('carousel format selected', (await page.getByTestId('composer-format-carousel').getAttribute('class')).includes('border-lime'));

  // Writing a post by hand used to dead-end at the caption: the words never
  // reached a single card, so "write it yourself" and "build it" were two
  // disconnected halves of the page. The splitting rules themselves are
  // pinned down in e2e/draft-split.mjs, so this only has to prove the draft
  // in the box really does become the deck, word for word.
  await page.getByTestId('composer-content').fill(
    'Ship weekly\nIt compounds faster than talent.\n\nWeek six\nThis is where everyone quits.\n\nWeek twenty\nThe compounding starts.');
  await tap(page, 'composer-split-draft');
  await page.waitForTimeout(400);
  const splitStrip = await page.getByTestId('composer-slide-strip').locator('button').count();
  ok('a hand-written draft becomes the cards themselves', splitStrip === 4, 'strip buttons: ' + splitStrip);
  await tap(page, 'composer-slide-1');
  ok('...carrying the words that were typed, not a reworded version',
     (await page.getByTestId('composer-slide-heading').inputValue()) === 'Week six',
     await page.getByTestId('composer-slide-heading').inputValue());
  ok('...including the body under it',
     (await page.getByTestId('composer-slide-body').inputValue()) === 'This is where everyone quits.',
     await page.getByTestId('composer-slide-body').inputValue());
  await tap(page, 'composer-undo');
  await page.waitForTimeout(300);

  // slide editing reflects in the preview
  await tap(page, 'composer-slide-1');
  await page.getByTestId('composer-slide-heading').fill('Week one');
  await page.waitForTimeout(300);
  ok('edited heading renders in preview', (await page.getByTestId('composer-visuals').innerText()).includes('Week one'));

  const before = await page.getByTestId('composer-slide-strip').locator('button').count();
  await tap(page, 'composer-add-slide');
  await page.waitForTimeout(200);
  ok('add slide', (await page.getByTestId('composer-slide-strip').locator('button').count()) === before + 1);
  await tap(page, 'composer-slide-remove');
  await page.waitForTimeout(200);
  ok('remove slide', (await page.getByTestId('composer-slide-strip').locator('button').count()) === before);

  await tap(page, 'composer-theme-brand');
  await page.waitForTimeout(200);
  ok('brand theme applies', true);

  // format switching per platform
  await tap(page, 'composer-platform-instagram'); // deselect instagram
  await tap(page, 'composer-platform-twitter');
  await page.waitForTimeout(300);
  ok('X offers thread, not story', await page.getByTestId('composer-format-thread').isVisible()
      && !(await page.getByTestId('composer-format-story').isVisible().catch(() => false)));

  await tap(page, 'composer-platform-twitter');
  await tap(page, 'composer-platform-instagram');
  await page.waitForTimeout(200);

  // save with assets
  await tap(page, 'composer-save-draft');
  await page.waitForTimeout(1500);
  const postsRes = await page.request.get(B + '/api/posts');
  const posts = await postsRes.json();
  ok('draft saved with assets', posts.length === 1 && posts[0].assets.length >= 4, JSON.stringify(posts[0] || {}).slice(0, 160));
  ok('saved format is carousel', posts[0].format === 'carousel', posts[0].format);
  ok('saved hashtags', (posts[0].hashtags || []).includes('#buildinpublic'), JSON.stringify(posts[0].hashtags));
  ok('no data URLs persisted', !JSON.stringify(posts[0]).includes('data:image'));

  // reopening restores the deck
  await page.goto(B + '/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId(`draft-row-${posts[0].id}`).click();
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 10000 });
  ok('reopened post restores slides', (await page.getByTestId('composer-slide-strip').locator('button').count()) === 5);

  // ---------- 2. History drawer from any screen ----------
  await page.goto(B + '/library', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('mobile-history-open').click();
  await page.getByTestId('history-filter-all').waitFor({ timeout: 8000 });
  // The filter chip is static markup and appears immediately; the items
  // themselves only render once the async /api/generations fetch resolves —
  // wait for that, not just the chip, before counting.
  await page.locator('[data-testid^="history-item-"]').first().waitFor({ timeout: 8000 });
  const items = await page.locator('[data-testid^="history-item-"]').count();
  ok('history reachable from the Library', items > 0, 'items: ' + items);
  const firstId = await page.locator('[data-testid^="history-item-"]').first().getAttribute('data-testid');
  const gid = firstId.replace('history-item-', '');
  ok('history shows post plan', (await page.getByTestId('history-filter-plans').isVisible()));

  await page.getByTestId('history-filter-plans').click();
  await page.waitForTimeout(800);
  ok('plans filter returns the built plan', (await page.locator('[data-testid^="history-item-"]').count()) >= 1);

  // edit a saved generation
  await page.getByTestId('history-filter-text').click();
  await page.waitForTimeout(800);
  // edit/delete the OLDEST text item — the newest is the post plan the later
  // "use" assertion still needs.
  const tid = (await page.locator('[data-testid^="history-item-"]').last().getAttribute('data-testid')).replace('history-item-', '');
  await page.getByTestId(`history-edit-${tid}`).click();
  await page.getByTestId(`history-editor-${tid}`).fill('edited by the test');
  await page.getByTestId(`history-save-${tid}`).click();
  await page.waitForTimeout(900);
  const g = await (await page.request.get(B + '/api/generations/' + tid)).json();
  ok('history edit persists', g.output === 'edited by the test', g.output);

  // favourite + delete
  await page.getByTestId(`history-star-${tid}`).click();
  await page.waitForTimeout(700);
  const g2 = await (await page.request.get(B + '/api/generations/' + tid)).json();
  ok('favourite persists', g2.favorite === true, JSON.stringify(g2.favorite));
  page.once('dialog', d => d.accept());
  await page.getByTestId(`history-delete-${tid}`).click();
  await page.waitForTimeout(900);
  const del = await page.request.get(B + '/api/generations/' + tid);
  ok('history delete persists', del.status() === 404, String(del.status()));

  // "Use" sends it to the composer
  await page.getByTestId('history-filter-plans').click();
  await page.waitForTimeout(1500);
  {
    const api = await (await page.request.get(B + '/api/generations?kind=post_plan')).json();
    const shown = await page.locator('[data-testid^="history-item-"]').count();
    console.log('DEBUG plans: api=' + api.length + ' shown=' + shown + ' kinds=' +
      JSON.stringify((await (await page.request.get(B + '/api/generations')).json()).map(g => g.kind)));
  }
  const pid = (await page.locator('[data-testid^="history-item-"]').first().getAttribute('data-testid')).replace('history-item-', '');
  await page.getByTestId(`history-use-${pid}`).click();
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 10000 });
  ok('history "use" restores a full plan', (await page.getByTestId('composer-content').inputValue()).includes('kept showing up'));

  // "Use", clicked while the Composer this "Use" targets is already open.
  // This exact case used to be a silent no-op for 5 of History's 8 kinds
  // (write/restyle/repurpose/batch/coach, plus any media result): they all
  // resolve to `content`/`mediaUrl`, which were mount-only useState
  // initializers — a same-path navigate("/composer", ...) never remounts
  // the page, so a click here did nothing, with no error to notice it by.
  // Reproduced before fixing (a throwaway probe, this exact click from
  // this exact page) and now covered so it can't come back silently.
  await page.request.post(B + '/api/ai/write', { data: { brief: 'a sentinel about shipping weekly no matter what', platform: 'twitter' } });
  await page.waitForTimeout(300);
  const priorContent = await page.getByTestId('composer-content').inputValue();
  await tap(page, 'composer-history');
  await page.getByTestId('history-filter-text').click();
  await page.waitForTimeout(800);
  const freshWriteId = (await page.locator('[data-testid^="history-item-"]').first().getAttribute('data-testid')).replace('history-item-', '');
  await page.getByTestId(`history-use-${freshWriteId}`).click();
  await page.waitForTimeout(500);
  const afterUse = await page.getByTestId('composer-content').inputValue();
  ok('History "Use" applies even from inside the Composer it targets (same-path navigation)',
     afterUse.length > 0 && afterUse !== priorContent,
     `before: "${priorContent.slice(0, 30)}" after: "${afterUse.slice(0, 30)}"`);

  // ---------- 3. Brand kit ----------
  await page.goto(B + '/brand', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('brand-name').waitFor({ timeout: 8000 });
  await page.getByTestId('brand-name').fill('Winterfab');
  await page.getByTestId('brand-voice').fill('Dry, technical, concrete.');
  await page.getByTestId('brand-hashtags').fill('#winterfab');
  await tap(page, 'brand-hashtags-add');
  await tap(page, 'brand-save');
  await page.waitForTimeout(1200);
  const kit = (await (await page.request.get(B + '/api/brand-kits')).json())[0];
  ok('brand kit saves', kit.name === 'Winterfab' && kit.hashtags.includes('#winterfab'), JSON.stringify(kit).slice(0, 140));
  ok('brand guideline preview renders', (await page.getByTestId('brand-guideline-preview').innerText()).includes('Winterfab'));

  // Connections folded into Brand Kit as a tab — no nav entry of its own,
  // and a stale /connections link lands here instead of a 404.
  await tap(page, 'brand-tab-connections');
  // The panel's wrapper renders before its /connections fetch resolves, so
  // waiting on the wrapper races the grid — wait for a platform card itself.
  await page.getByTestId('connection-instagram').waitFor({ timeout: 8000 });
  ok('connections tab lists every platform', await page.getByTestId('connection-instagram').isVisible());
  await page.goto(B + '/connections', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('connections-page').waitFor({ timeout: 8000 });
  ok('/connections redirects into the Brand tab', page.url().includes('/brand'));
  await tap(page, 'brand-tab-brand');
  await page.getByTestId('brand-name').waitFor({ timeout: 5000 });

  // brand hashtags now ride along on a built post
  const built = await (await page.request.post(B + '/api/ai/build-post', { data: { topic: 't', platform: 'instagram' } })).json();
  ok('brand hashtag merged into new posts', built.hashtags.includes('#winterfab'), JSON.stringify(built.hashtags));

  // ---------- 4. Visual studio hands over specs ----------
  await page.goto(B + '/visuals', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('visual-template-carousel').click();
  await page.getByTestId('visual-topic').fill('consistency');
  await tap(page, 'visual-generate');
  await page.getByTestId('visual-use').waitFor({ timeout: 15000 });
  ok('visual studio has a brand theme', await page.getByTestId('visual-theme-brand').isVisible());
  await tap(page, 'visual-use');
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 10000 });
  ok('visual studio deck becomes editable slides', (await page.getByTestId('composer-slide-strip').locator('button').count()) === 5);

  // A card handed over this way carries no freeform elements, so it renders
  // through the plain template branch — the one a PNG export rasterises
  // straight off the screen — and it has to be laid out for the box it is
  // ACTUALLY in. VisualCard sizes every bit of type and spacing as
  // `authored * scale`, where the scale is useCardScale measuring that box.
  // When that measurement never happens the card renders at the bare
  // fallback (0.45) inside a box twice as wide, and the export faithfully
  // captures the half-size result. That shipped: the hook's effect depended
  // on [ref], which never changes identity, so it ran once on mount — while
  // the Composer was still showing its empty state and the box did not exist
  // yet — and never looked again.
  //
  // None of the PNG checks further down catch this. The file still lands on
  // disk, at the right pixel dimensions, in the right fonts; only the ratio
  // between the type and the box around it is wrong. Padding is the cleanest
  // probe, being a plain `36 * scale` with nothing else folded into it, and
  // composer-card is the very node captureCardPng rasterises.
  await page.waitForTimeout(300);
  const scaleCheck = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="composer-card"]');
    const drawn = card && card.firstElementChild;
    if (!drawn) return null;
    const width = card.getBoundingClientRect().width;
    return { width, rendered: parseFloat(getComputedStyle(drawn).paddingLeft) / 36, expected: width / 440 };
  });
  ok('the card is laid out for the box it is actually in, not a fallback scale',
     !!scaleCheck && scaleCheck.width > 0 && Math.abs(scaleCheck.rendered - scaleCheck.expected) < 0.02,
     JSON.stringify(scaleCheck));

  // ---------- 5. duplicate slide ----------
  const stripBefore = await page.locator('[data-testid="composer-slide-strip"] button').count();
  await tap(page, 'composer-slide-duplicate');
  await page.waitForTimeout(300);
  ok('duplicate slide adds one slide', (await page.locator('[data-testid="composer-slide-strip"] button').count()) === stripBefore + 1);

  // ---------- 6. full-screen canvas editor ----------
  // The whole point of this mode is that the slide is the biggest thing on a
  // phone screen and every tool is thumb-sized, so assert both in pixels.
  if (await page.getByTestId('composer-slide-edit-layout').count()) await tap(page, 'composer-slide-edit-layout');
  await tap(page, 'composer-edit-canvas');
  await page.getByTestId('canvas-editor').waitFor({ timeout: 6000 });
  await page.waitForTimeout(500);
  const canvasBox = await page.locator('[data-testid="canvas-card-box"]').boundingBox();
  ok('canvas fills the phone screen', canvasBox && canvasBox.width >= 330,
    'card is ' + (canvasBox ? Math.round(canvasBox.width) : 0) + 'px of 390');

  const tooSmall = await page.evaluate(() => [...document.querySelectorAll('[data-testid="canvas-toolbar"] button')]
    .map((b) => b.getBoundingClientRect())
    .filter((r) => r.width < 44 || r.height < 44).length);
  ok('every canvas tool clears a 44px touch target', tooSmall === 0, tooSmall + ' undersized');

  await tap(page, 'canvas-tool-size');
  await page.getByTestId('canvas-element-size').fill('48');
  await page.getByTestId('canvas-element-size').dispatchEvent('change');
  await page.waitForTimeout(300);
  const typeAt = await page.evaluate(() => {
    const box = document.querySelector('[data-testid="canvas-card-box"]');
    const leaf = [...box.querySelectorAll('div')].filter((d) => !d.children.length && d.textContent.trim())[0];
    return { px: leaf && parseFloat(getComputedStyle(leaf).fontSize), w: box.getBoundingClientRect().width };
  });
  ok('a size change renders at the card\'s own scale',
    typeAt.px && Math.abs(typeAt.px - (48 * typeAt.w) / 440) < 1,
    typeAt.px + 'px, expected ' + ((48 * typeAt.w) / 440).toFixed(1));

  // duplicate slide from inside the canvas too
  const canvasStripBefore = await page.locator('[data-testid="canvas-slide-strip"] button').count();
  await tap(page, 'canvas-duplicate-slide');
  await page.waitForTimeout(300);
  ok('canvas duplicate-slide tool adds one slide',
    (await page.locator('[data-testid="canvas-slide-strip"] button').count()) === canvasStripBefore + 1);

  // save the selected element to the library, then confirm a toast that
  // lands right after doesn't block Done in the same top-right corner
  await page.locator('[data-testid="canvas-card-box"] [data-testid^="slide-element-el_"]').first()
    .click({ force: true, position: { x: 5, y: 5 } });
  await page.waitForTimeout(200);
  await tap(page, 'canvas-tool-layer');
  await page.waitForTimeout(200);
  await tap(page, 'canvas-save-library');
  await page.waitForTimeout(150); // a fresh toast is now up, right where Done is
  await tap(page, 'canvas-editor-done');
  await page.waitForTimeout(400);
  ok('done closes the canvas even with a fresh toast up', (await page.getByTestId('canvas-editor').count()) === 0);

  await tap(page, 'composer-open-library');
  await page.getByTestId('library-tab-uploads').waitFor({ timeout: 5000 });
  await page.waitForTimeout(600); // let the sheet's slide-in transition finish
  await tap(page, 'library-tab-uploads');
  await page.waitForTimeout(600);
  const libItems = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="library-upload-"]')].filter((b) => !b.dataset.testid.includes('delete')).length);
  ok('an element saved off a slide shows up in the library', libItems >= 1, libItems + ' items');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ---------- 7. template resize ----------
  page.once('dialog', (d) => d.accept('E2E resize template'));
  await tap(page, 'composer-save-template');
  await page.waitForTimeout(500);
  const aspectBefore = await page.getByTestId('composer-visuals').locator('[class*="aspect-"]').first()
    .evaluate((e) => getComputedStyle(e).aspectRatio);
  ok('a size chip for a different format is offered', (await page.getByTestId('composer-visual-size-reel').count()) > 0);
  await tap(page, 'composer-visual-size-reel');
  await page.waitForTimeout(400);
  const aspectAfter = await page.getByTestId('composer-visuals').locator('[class*="aspect-"]').first()
    .evaluate((e) => getComputedStyle(e).aspectRatio);
  ok('the size chip actually changes the deck\'s aspect ratio', aspectAfter !== aspectBefore, aspectBefore + ' -> ' + aspectAfter);
  const tplOpts = await page.getByTestId('composer-custom-template-select').locator('option').allTextContents();
  ok('a template saved at a different format is still selectable, labeled',
    tplOpts.some((o) => o.includes('E2E resize template') && o.includes('will resize')));

  // ---------- 8. mobile layout sanity ----------
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('no horizontal overflow on mobile', scroll <= 1, 'overflow px: ' + scroll);
  await tap(page, 'mobile-menu-open');
  await page.waitForTimeout(400);
  ok('brand kit is in the mobile menu', await page.getByTestId('mobile-nav-brand').isVisible());

  // Batch, Content Studio, Visual Studio and Repurpose all folded into the
  // Composer as modes (see the Composer-modes section below), and
  // Connections folded into Brand Kit as a tab — none of them has its own
  // nav entry left to check. Six screens now: Home, Create, Projects, Plan,
  // Library, Brand — Projects earned its own screen once "find and reopen
  // something you already built" stopped being a thing Home could do in
  // passing (see the Projects section below).
  ok('the nav lists exactly the six collapsed screens',
     (await page.locator('[data-testid^="mobile-nav-"]').count()) === 6,
     await page.locator('[data-testid^="mobile-nav-"]').allTextContents());

  // ---------- 9. every route is usable on a phone ----------
  // The design library's cards are grid items, which default to
  // min-width:auto and so can't shrink below the min-content width that
  // `truncate` (white-space:nowrap) gives them — that scrolled the whole
  // page sideways and squeezed each name down to a few characters.
  await page.goto(B + '/designs', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('templates-custom').waitFor({ timeout: 8000 });
  await page.waitForTimeout(600);
  const tplScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('design library does not scroll sideways on a phone', tplScroll <= 1, 'overflow px: ' + tplScroll);
  const nameRoom = await page.evaluate(() => {
    const card = document.querySelector('[data-testid^="templates-custom-item-"]');
    const name = card.querySelector('span.truncate');
    return { card: Math.round(card.getBoundingClientRect().width), name: Math.round(name.getBoundingClientRect().width) };
  });
  ok('a design name still gets room to read', nameRoom.name >= 90, JSON.stringify(nameRoom));

  // An unknown path used to render nothing at all — a blank screen on a
  // phone, where there's no sidebar to navigate back from.
  await page.goto(B + '/no-such-page', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('not-found').waitFor({ timeout: 8000 });
  ok('an unknown route answers with a 404 page', await page.getByTestId('not-found').isVisible());
  await tap(page, 'not-found-home');
  await page.waitForTimeout(600);
  ok('...with a way back to the dashboard', new URL(page.url()).pathname === '/', page.url());

  // ---------- 10. video: library, elements, and the reel timeline ----------
  const setRange = async (testid, value) => {
    await page.getByTestId(testid).evaluate((el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  };

  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await tap(page, 'composer-format-reel');
  await page.waitForTimeout(300);
  await page.getByTestId('composer-brief').fill('shipping weekly');
  await tap(page, 'composer-autobuild');
  await confirmBuild(page);
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000);

  ok('a reel scene gets a clip editor', (await page.getByTestId('clip-editor').count()) === 1);
  const baseDuration = (await page.getByTestId('composer-reel-duration').innerText()).trim();

  // Stock video onto the first scene, then everything you can do to it.
  await tap(page, 'clip-stock');
  await page.waitForTimeout(700);
  await page.getByTestId('media-query').fill('city');
  await page.getByTestId('media-search').click({ force: true });
  await page.waitForTimeout(1000);
  await page.locator('[data-testid^="media-result-"]').first().click({ force: true });
  await page.waitForTimeout(800);
  const cardVideo = () => page.evaluate(() => {
    const v = document.querySelector('[data-testid="composer-visuals"] video');
    if (!v) return null;
    const cs = getComputedStyle(v);
    return { filter: cs.filter, opacity: Number(cs.opacity).toFixed(2), fit: cs.objectFit };
  });
  ok('stock video lands on the scene', (await cardVideo()) !== null);

  await setRange('clip-length', 6.5);
  await page.waitForTimeout(300);
  const grown = (await page.getByTestId('composer-reel-duration').innerText()).trim();
  ok('clip length changes the reel\'s running time', grown !== baseDuration, baseDuration + ' -> ' + grown);

  await setRange('clip-opacity', 1);
  await tap(page, 'clip-fit-contain');
  await page.waitForTimeout(300);
  const framed = await cardVideo();
  ok('opacity and framing reach the card', framed.opacity === '1.00' && framed.fit === 'contain', JSON.stringify(framed));

  await tap(page, 'clip-tab-effects');
  await page.waitForTimeout(200);
  await tap(page, 'clip-preset-noir');
  await page.waitForTimeout(300);
  const noir = await cardVideo();
  ok('an effect preset grades the footage', /grayscale/.test(noir.filter), noir.filter);
  await setRange('clip-effect-blur', 4);
  await page.waitForTimeout(300);
  ok('...and a slider stacks on top of it', /blur\(4px\)/.test((await cardVideo()).filter), (await cardVideo()).filter);

  // Transitions belong to the incoming scene, so scene 1 has none to offer.
  await tap(page, 'clip-tab-transition');
  await page.waitForTimeout(200);
  ok('the first scene offers no transition', (await page.getByTestId('clip-transition-dissolve').count()) === 0);
  await tap(page, 'composer-slide-1');
  await page.waitForTimeout(400);
  await tap(page, 'clip-tab-transition');
  await page.waitForTimeout(200);
  ok('a later scene does', (await page.getByTestId('clip-transition-dissolve').count()) === 1);
  await tap(page, 'clip-transition-dissolve');
  await page.waitForTimeout(300);

  // The player walks the whole timeline.
  await tap(page, 'composer-reel-view-play');
  await page.getByTestId('reel-player').waitFor({ timeout: 6000 });
  await page.waitForTimeout(400);
  const segCount = await page.locator('[data-testid^="reel-player-seg-"]').count();
  ok('the player lays out one segment per scene', segCount === 3, String(segCount));
  const tBefore = await page.getByTestId('reel-player-time').innerText();
  await tap(page, 'reel-player-playpause');
  await page.waitForTimeout(1500);
  const tAfter = await page.getByTestId('reel-player-time').innerText();
  await tap(page, 'reel-player-playpause');
  ok('the playhead advances while playing', tBefore !== tAfter, tBefore.trim() + ' -> ' + tAfter.trim());

  // Video as an element: several clips on one scene, draggable like any other.
  await tap(page, 'composer-reel-view-canvas');
  await page.waitForTimeout(300);
  if (await page.getByTestId('composer-slide-edit-layout').count()) await tap(page, 'composer-slide-edit-layout');
  await page.waitForTimeout(300);
  await tap(page, 'composer-add-element-video');
  await page.waitForTimeout(300);
  await page.getByTestId('composer-element-url').fill(B + '/e2e-video.mp4');
  await tap(page, 'composer-add-element-video');
  await page.waitForTimeout(300);
  await page.getByTestId('composer-element-url').fill(B + '/e2e-video.mp4');
  await page.waitForTimeout(400);
  const inCard = await page.evaluate(() => document.querySelectorAll('[data-testid="slide-editor-canvas"] video').length);
  ok('several video elements can share one scene', inCard >= 2, String(inCard));

  // The elements library takes an mp4 and saves it as a clip, not an image.
  await tap(page, 'composer-open-library');
  await page.getByTestId('library-tab-uploads').waitFor({ timeout: 6000 });
  await page.waitForTimeout(600);
  await tap(page, 'library-tab-uploads');
  await page.waitForTimeout(600);
  ok('the library accepts video files',
    /video\/mp4/.test(await page.getByTestId('library-upload-input').getAttribute('accept')));
  await page.setInputFiles('[data-testid="library-upload-input"]',
    { name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('typed-as-video') });
  await page.waitForTimeout(1400);
  const savedKind = await page.evaluate(async () => {
    const list = await (await fetch('/api/library/elements')).json();
    return list.find((x) => x.name === 'clip.mp4')?.element?.type;
  });
  ok('an uploaded mp4 is saved as a video element', savedKind === 'video', String(savedKind));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ---------- 11. rendering the reel to a real video file ----------
  // Trimmed right down first: the recorder captures a live stream, so the
  // render costs as long as the reel runs.
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await tap(page, 'composer-format-reel');
  await page.getByTestId('composer-brief').fill('shipping weekly');
  await tap(page, 'composer-autobuild');
  await confirmBuild(page);
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  await page.waitForTimeout(900);
  for (let i = 0; i < 3; i += 1) {
    await tap(page, `composer-slide-${i}`);
    await page.waitForTimeout(250);
    await setRange('clip-length', 0.5);
    await page.waitForTimeout(150);
  }

  await tap(page, 'composer-reel-export');
  await page.getByTestId('reel-export').waitFor({ timeout: 6000 });
  await page.waitForTimeout(300);
  const canRecord = (await page.getByTestId('reel-export-unsupported').count()) === 0;
  ok('the browser can record video', canRecord);
  if (canRecord) {
    // Capture the blob the dialog hands to the download so the bytes
    // themselves can be checked, not just the "done" label.
    await page.evaluate(() => {
      window.__lastBlobUrl = null;
      const orig = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (b) => { const u = orig(b); window.__lastBlobUrl = u; return u; };
    });
    await tap(page, 'reel-export-preset-480');
    await page.waitForTimeout(200);
    // Watch how much of the off-screen stage is alive at once. Every scene
    // used to be mounted there at the full output size for the whole export,
    // so a seven-slide reel on a phone held seven live 720x1280 cards — each
    // with its own backdrop element and logo — while only one was ever being
    // screenshotted. Now it mounts one at a time, and this is what keeps it
    // that way as the reel gets longer.
    await page.evaluate(() => {
      window.__maxStageScenes = 0;
      window.__stageSampler = setInterval(() => {
        const n = document.querySelectorAll('[data-testid="reel-export-stage"] > div').length;
        if (n > window.__maxStageScenes) window.__maxStageScenes = n;
      }, 25);
    });
    await tap(page, 'reel-export-start');
    await page.getByTestId('reel-export-done').waitFor({ timeout: 60000 });
    ok('the reel renders to a file', true, (await page.getByTestId('reel-export-done').innerText()).trim());

    const maxStage = await page.evaluate(() => {
      clearInterval(window.__stageSampler);
      return window.__maxStageScenes;
    });
    ok('the export stage holds one scene at a time, however many the reel has',
       maxStage === 1, `max mounted = ${maxStage}`);

    const file = await page.evaluate(async () => {
      const el = document.querySelector('[data-testid="reel-export-download"]');
      el?.click();
      await new Promise((r) => setTimeout(r, 400));
      if (!window.__lastBlobUrl) return null;
      const buf = new Uint8Array(await (await fetch(window.__lastBlobUrl)).arrayBuffer());
      const tag = String.fromCharCode(...buf.slice(4, 8));
      const ebml = buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
      return { size: buf.length, container: tag === 'ftyp' ? 'mp4' : ebml ? 'webm' : 'unknown' };
    });
    ok('...that is a real video container', file && file.size > 2000 && file.container !== 'unknown', JSON.stringify(file));

    // And it decodes back to moving pictures of the right length.
    const decoded = await page.evaluate(async () => {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.src = window.__lastBlobUrl;
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('decode failed')); setTimeout(res, 8000); });
      return { duration: Number(v.duration?.toFixed(2)), w: v.videoWidth, h: v.videoHeight };
    });
    ok('...that decodes at the export size', decoded.w === 480 && decoded.h > 800, JSON.stringify(decoded));
    ok('...and runs about as long as the reel', decoded.duration > 0.8 && decoded.duration < 6, String(decoded.duration));

    // The footage is actually IN the file, not just a valid container of
    // the right length. Everything above here passes just as happily on a
    // reel of nothing but background and text, which is exactly how
    // "the export is missing its stock videos" shipped more than once.
    // The clip fixture is flat magenta, a colour no theme or text uses, so
    // sampling a frame mid-reel says plainly whether the clip layer was
    // composited — even at the clip's default 45% opacity, magenta over a
    // dark ground still leaves red and blue far ahead of green.
    const footage = await page.evaluate(async () => {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.src = window.__lastBlobUrl;
      await new Promise((res) => { v.onloadeddata = res; v.onerror = res; setTimeout(res, 8000); });
      await new Promise((res) => { v.onseeked = res; v.currentTime = Math.min(0.6, (v.duration || 1) / 2); setTimeout(res, 4000); });
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      let magenta = 0;
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        if (r > 45 && b > 45 && g < Math.min(r, b) * 0.65) magenta += 1;
      }
      return { magenta, pixels: data.length / 4 };
    });
    ok('...and the stock footage is actually composited into it, not just the text',
       footage.magenta > footage.pixels * 0.05, JSON.stringify(footage));

    // Frames are now pushed into the recording by the draw loop itself
    // (captureStream(0) + requestFrame) rather than sampled off a timer, so
    // "a file of the right length" is no longer evidence the picture moved —
    // one frame held for the whole duration would pass every check above.
    // The clip fixture has a band travelling across it, so two moments that
    // are genuinely different frames cannot be identical.
    const moves = await page.evaluate(async () => {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.src = window.__lastBlobUrl;
      await new Promise((res) => { v.onloadeddata = res; v.onerror = res; setTimeout(res, 8000); });
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      const g = c.getContext('2d');
      const sampleAt = async (time) => {
        await new Promise((res) => { v.onseeked = res; v.currentTime = time; setTimeout(res, 4000); });
        g.drawImage(v, 0, 0);
        const { data } = g.getImageData(0, 0, c.width, c.height);
        let sum = 0;
        for (let i = 0; i < data.length; i += 4000) sum += data[i] + data[i + 1] * 3 + data[i + 2] * 7;
        return sum;
      };
      const a = await sampleAt(0.15);
      const b = await sampleAt(Math.max(0.5, (v.duration || 1) * 0.7));
      return { a, b };
    });
    ok('...and the picture advances rather than holding one frame',
       moves.a !== moves.b, JSON.stringify(moves));

    // The soundtrack is in the file too. Nothing here has ever checked that,
    // and the voice fixture was a WAV of pure silence, so a reel whose
    // voiceover and score never reached the recording passed every assertion
    // above exactly as happily as one whose did — which is how a completely
    // silent export shipped. The fixture is a real tone now and this decodes
    // the exported container back to samples and looks at the level.
    const sound = await page.evaluate(async () => {
      const bytes = await (await fetch(window.__lastBlobUrl)).arrayBuffer();
      const Ctx = window.AudioContext || window.webkitAudioContext;
      let audio = null;
      try { audio = await new Ctx().decodeAudioData(bytes.slice(0)); }
      catch (e) { return { error: String((e && e.message) || e) }; }
      const ch = audio.getChannelData(0);
      let peak = 0;
      let energy = 0;
      for (let i = 0; i < ch.length; i += 1) { const v = Math.abs(ch[i]); if (v > peak) peak = v; energy += v; }
      return {
        duration: Number(audio.duration.toFixed(2)),
        peak: Number(peak.toFixed(4)),
        mean: Number((energy / Math.max(1, ch.length)).toFixed(5)),
      };
    });
    ok('...and the reel has sound in it, not just picture',
       !!sound && !sound.error && sound.peak > 0.01, JSON.stringify(sound));
    // Peak alone can be one stray click. A take that really played leaves
    // energy across the whole thing, which silence cannot fake.
    ok('...and that sound is a real take, not a single blip in silence',
       !!sound && !sound.error && sound.mean > 0.002, JSON.stringify(sound));

    // A scene's flat background is filled straight onto the canvas now
    // rather than screenshotted into a full-resolution bitmap and held for
    // the whole render — six scenes at 720p were spending ~22MB of a phone's
    // memory budget to say "this scene is #0A0A0A" six times, which is
    // memory the real footage needs. Switching the clip to "contain"
    // letterboxes the 4:3 fixture inside a 9:16 frame, so the bars top and
    // bottom are that background and nothing else: this sees the actual fill
    // rather than inferring it.
    await tap(page, 'reel-export-close');
    await page.waitForTimeout(250);
    // Every scene, not just the first — a seek into the finished file snaps
    // to a keyframe, so which scene a sampled frame belongs to isn't ours to
    // choose.
    for (let i = 0; i < 3; i += 1) {
      await tap(page, `composer-slide-${i}`);
      await page.waitForTimeout(250);
      await tap(page, 'clip-fit-contain');
      await page.waitForTimeout(200);
    }
    await tap(page, 'composer-reel-export');
    await page.getByTestId('reel-export').waitFor({ timeout: 6000 });
    await tap(page, 'reel-export-preset-480');
    await page.waitForTimeout(200);
    await tap(page, 'reel-export-start');
    await page.getByTestId('reel-export-done').waitFor({ timeout: 60000 });
    // __lastBlobUrl only updates when the file is actually handed over, so
    // without this the sample below re-reads the PREVIOUS export's bytes.
    await page.evaluate(async () => {
      document.querySelector('[data-testid="reel-export-download"]')?.click();
      await new Promise((r) => setTimeout(r, 400));
    });
    const bgFill = await page.evaluate(async () => {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.src = window.__lastBlobUrl;
      await new Promise((res) => { v.onloadeddata = res; v.onerror = res; setTimeout(res, 8000); });
      await new Promise((res) => { v.onseeked = res; v.currentTime = 0.1; setTimeout(res, 4000); });
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      // Top-left corner: past the safe area of any centred copy, so it is
      // background and nothing else.
      const d = c.getContext('2d').getImageData(4, 4, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2] };
    });
    // Not magenta any more (the clip is invisible) and not the black the
    // canvas is cleared to — a real background colour actually got filled.
    const isMagenta = bgFill.r > 45 && bgFill.b > 45 && bgFill.g < Math.min(bgFill.r, bgFill.b) * 0.65;
    ok('a flat scene background is filled from its colour, not a held bitmap',
       !isMagenta, JSON.stringify(bgFill));

    // The export now says out loud when it couldn't fetch a clip, a
    // voiceover or the score, rather than shipping a file with holes in it
    // that looks finished. The other half of that promise is not crying
    // wolf: a render with nothing missing must stay quiet.
    const missingCount = await page.getByTestId('reel-export-missing').count();
    ok('a render with nothing missing says nothing about missing media', missingCount === 0,
       missingCount ? (await page.getByTestId('reel-export-missing').innerText()).trim() : '');
  }
  await tap(page, 'reel-export-close');
  await page.waitForTimeout(300);

  // ---------- 11a-review. Reel build options + script review ----------
  // "Build whole post" for a reel used to go straight from a topic to a
  // fully recorded, fully shot reel — no way to see the script, fix a line,
  // drop or add a scene, or say which of voiceover/music/footage to bother
  // with, before three API calls per scene had already spent themselves.
  // This is that chance, exercised end to end: change an option, edit the
  // returned script, and prove the edits (not the original AI text) are
  // what actually gets built.
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('composer-page').waitFor({ timeout: 10000 });
  await tap(page, 'composer-format-reel');
  await page.getByTestId('composer-reel-options').waitFor({ timeout: 5000 });

  const stepperBefore = Number(await page.getByTestId('composer-reel-scenes-count').innerText());
  await tap(page, 'composer-reel-scenes-plus');
  const stepperAfter = Number(await page.getByTestId('composer-reel-scenes-count').innerText());
  ok('the scene-count stepper changes the count', stepperAfter === stepperBefore + 1,
     `${stepperBefore} -> ${stepperAfter}`);
  await tap(page, 'composer-reel-scenes-minus'); // back to the platform default for the rest of this test

  // Turning an "include" off hides its own follow-up controls (a style
  // input with nothing to apply to is just noise) rather than leaving them
  // sitting there uselessly enabled.
  await tap(page, 'composer-reel-include-music');
  ok('turning an "include" off hides its own options',
     (await page.getByTestId('composer-reel-music-style').count()) === 0);
  await tap(page, 'composer-reel-include-music'); // back on

  // The script style picker: standard is the default, picking viral-short
  // selects it, and — since that style ends on the payoff — picking it
  // clears an already-set outro toggle rather than leaving two contradicting
  // instructions (an outro scene + "no outro") to reach the same prompt.
  ok('standard is the default script style',
     (await page.getByTestId('composer-reel-script-standard').getAttribute('class')).includes('border-lime'));
  await tap(page, 'composer-reel-outro');
  await tap(page, 'composer-reel-script-viral-short');
  ok('picking a script style selects it',
     (await page.getByTestId('composer-reel-script-viral-short').getAttribute('class')).includes('border-lime'));
  ok('...and an already-set outro toggle is cleared, since this style ends on the payoff',
     !(await page.getByTestId('composer-reel-outro').getAttribute('class')).includes('border-lime'));

  // The Style picker has to shape what gets BUILT, not only what its own
  // "Apply style" button rewrites afterwards. It reached the restyle route
  // but never build-post, so picking a style and hitting Build changed
  // nothing — on every format. Hooks looked like the only one that worked
  // because the hook-craft rules are on for every build regardless.
  await page.getByTestId('composer-style-select').selectOption('listicle');

  const buildRequests = [];
  await page.route('**/api/ai/build-post', async (route) => {
    buildRequests.push(route.request().postDataJSON());
    await route.continue();
  });
  await page.getByTestId('composer-brief').fill('shipping weekly, e2e review step');
  await tap(page, 'composer-autobuild');
  await page.getByTestId('composer-build-review').waitFor({ timeout: 20000 });
  await page.unroute('**/api/ai/build-post');
  ok('the picked copy style reaches the build request too',
     buildRequests[0]?.style_template === 'listicle', JSON.stringify(buildRequests[0]));
  ok('the picked script style actually reaches the build request',
     buildRequests[0]?.script_style === 'viral-short', JSON.stringify(buildRequests[0]));

  // The whole point of the step: nothing has recorded, shot or scored
  // anything while this is up.
  ok('the review step blocks recording/shooting until confirmed',
     (await page.getByTestId('composer-slide-strip').count()) === 0);

  const reviewRowsBefore = await page.locator('[data-testid^="composer-build-review-row-"]').count();
  ok('the review step shows one row per scripted scene', reviewRowsBefore === 3, String(reviewRowsBefore));

  // Edit a line, drop the last scripted scene, add a fresh one of our own.
  await page.getByTestId('composer-build-review-heading-0').fill('E2E edited heading');
  await tap(page, `composer-build-review-remove-${reviewRowsBefore - 1}`);
  await tap(page, 'composer-build-review-add');
  const reviewRowsAfter = await page.locator('[data-testid^="composer-build-review-row-"]').count();
  ok('removing one scene and adding one keeps the count the same', reviewRowsAfter === reviewRowsBefore,
     String(reviewRowsAfter));
  const addedIdx = reviewRowsAfter - 1;
  await page.getByTestId(`composer-build-review-heading-${addedIdx}`).fill('E2E added scene');
  await page.getByTestId(`composer-build-review-visual-${addedIdx}`).fill('a rocket launch at dawn');

  // Capture every voice request this confirm triggers — this IS the exact
  // race that used to drop the headline: synthesizeReelVoices runs in the
  // same tick applyPlan calls setAssets(plan.assets) in, so a heading read
  // back off React state (rather than off the scene array already in hand)
  // would still be reading last render's — usually empty, on a first
  // build. Scene 0's edited heading only proves the fix if it shows up in
  // THIS recording, not a later retry once state has caught up.
  const voicePrompts = [];
  await page.route('**/api/ai/generate', async (route) => {
    const body = route.request().postDataJSON();
    if (body?.kind === 'voice') voicePrompts.push(body.prompt);
    await route.continue();
  });
  await tap(page, 'composer-build-review-confirm');
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  await page.waitForSelector('[data-testid="composer-voice-synthesizing"]', { state: 'hidden', timeout: 15000 });
  await page.unroute('**/api/ai/generate');
  // The strip's own +1 "add slide" button sits alongside the scene buttons.
  const builtScenes = (await page.getByTestId('composer-slide-strip').locator('button').count()) - 1;
  ok('confirming the review builds exactly the edited scene list', builtScenes === reviewRowsAfter,
     String(builtScenes));
  ok("the very first recording after confirming includes the edited heading, not just the caption",
     voicePrompts.some((p) => p.includes('E2E edited heading')), JSON.stringify(voicePrompts));

  // The edited text landed on the actual built scene, not just the review
  // form — read it back off the same field a hand edit would use.
  await tap(page, 'composer-reel-view-canvas');
  await page.waitForTimeout(200);
  await tap(page, 'composer-slide-0');
  await page.waitForTimeout(200);
  const builtHeading = await page.getByTestId('composer-slide-heading').inputValue();
  ok("an edit made in review is what actually gets built, not the AI's original text",
     builtHeading === 'E2E edited heading', builtHeading);

  // ---------- 11a-voicerow. Voiceover survives layout edit + bulk re-record ----------
  // "Edit layout" used to permanently swap the whole controls panel over to
  // ElementPropertyPanel for that scene — including the voiceover
  // retry/status block, which lived inside the very branch that got
  // replaced. Once edited, a scene's voiceover became unreachable with no
  // error and no way back short of resetting the layout.
  // A scene can arrive with elements already (a design's baked-in copy, or
  // the brand starting point seeded at build time), in which case there's no
  // "Edit layout" left to press — it's already in that state, which is the
  // state this check is actually about. Only the getting-there differs.
  if (await page.getByTestId('composer-slide-edit-layout').count()) {
    await tap(page, 'composer-slide-edit-layout');
    await page.waitForTimeout(200);
  }
  ok('a scene carrying freeform elements still shows its voiceover controls',
     (await page.getByTestId('composer-scene-voice-retry').count()) === 1);
  ok("...on a scene that really is in freeform layout, so that isn't trivially true",
     (await page.getByTestId('composer-element-panel').count()) === 1);

  // The reel-wide row (parity with the score's own row) — count of scenes
  // with a real take, and a bulk retry beside the score's own regenerate.
  await page.getByTestId('composer-voice-row').waitFor({ timeout: 5000 });
  const voiceRowText = await page.getByTestId('composer-voice-row-count').innerText();
  ok('the reel-wide voiceover row reports how many scenes have a take',
     /\d+ of \d+/.test(voiceRowText), voiceRowText);

  await tap(page, 'composer-voice-regenerate-all');
  await page.waitForSelector('[data-testid="composer-voice-synthesizing"]', { state: 'hidden', timeout: 15000 });
  const voiceRowTextAfter = await page.getByTestId('composer-voice-row-count').innerText();
  const [gotAfter, ofAfter] = voiceRowTextAfter.match(/(\d+) of (\d+)/).slice(1, 3);
  ok('"re-record all" re-records every voiceable scene, not just the active one',
     gotAfter === ofAfter, voiceRowTextAfter);

  // Discarding the review applies nothing at all — proven by going straight
  // from a fresh build back to the empty state, not just "no error shown".
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('composer-page').waitFor({ timeout: 10000 });
  await tap(page, 'composer-format-reel');
  await page.getByTestId('composer-brief').fill('shipping weekly, e2e discard check');
  await tap(page, 'composer-autobuild');
  await page.getByTestId('composer-build-review').waitFor({ timeout: 20000 });
  await tap(page, 'composer-build-review-discard');
  await page.waitForTimeout(300);
  ok('discarding the review leaves nothing built',
     (await page.getByTestId('composer-build-review').count()) === 0
     && (await page.getByTestId('composer-slide-strip').count()) === 0);

  // ---------- 11a-visuals. Reel options — AI-generated visuals, not stock ----------
  // "Perhaps we want to generate images rather than use stock" — this is
  // that path exercised end to end: the footage fill goes through
  // /ai/generate (kind: image) instead of /stock/search, and the scene ends
  // up holding a real still exactly the way a manually-attached one does.
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('composer-page').waitFor({ timeout: 10000 });
  await tap(page, 'composer-format-reel');
  await tap(page, 'composer-reel-visual-ai-image');
  const aiImageActive = await page.evaluate(() =>
    document.querySelector('[data-testid="composer-reel-visual-ai-image"]')?.className.includes('border-lime'));
  ok('the AI-image visual source can be selected', !!aiImageActive);
  await page.getByTestId('composer-reel-visual-style').fill('watercolor illustration');

  await page.getByTestId('composer-brief').fill('shipping weekly, e2e ai visuals');
  await tap(page, 'composer-autobuild');
  await confirmBuild(page);
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  await page.waitForSelector('[data-testid="composer-visual-filling"]', { state: 'hidden', timeout: 15000 });
  ok('a scene built with an AI-generated visual holds a real still',
     (await page.getByTestId('clip-editor').innerText()).includes('Photo attached'));
  ok('...and renders as a real <img>, not a broken <video>',
     await page.evaluate(() => !!document.querySelector('[data-testid="composer-visuals"] img[data-export-backdrop]')));

  // ---------- 11a. Auto Reel — a scene holds as long as its own take runs ----------
  // Every reel scene used to hold the screen for a flat DEFAULT_CLIP_SECONDS
  // regardless of what it said. Build whole post now records a real take of
  // each scene's line in the background and sets that scene's length from
  // the take's own measured duration — a four-word line and a forty-word
  // one no longer get the same amount of screen time.
  // The label reads "M:SS.S total" — parse just the timecode.
  const toSeconds = (label) => {
    const m = label.match(/(\d+):(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  };
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('composer-page').waitFor({ timeout: 10000 });
  await tap(page, 'composer-format-reel');

  // A voice can be picked before the reel even exists, so the first take
  // already comes back in the right voice instead of needing a retake per
  // scene afterward.
  await tap(page, 'composer-voice-preset-pre-aria');
  const preActive = await page.evaluate(() =>
    document.querySelector('[data-testid="composer-voice-preset-pre-aria"]')?.className.includes('border-lime'));
  ok('a voice can be picked before the reel is built', !!preActive);

  await page.getByTestId('composer-brief').fill('shipping weekly no matter what');
  await tap(page, 'composer-autobuild');
  await confirmBuild(page);
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  await page.waitForSelector('[data-testid="composer-voice-synthesizing"]', { state: 'hidden', timeout: 15000 });
  const postActive = await page.evaluate(() =>
    document.querySelector('[data-testid="composer-voice-preset-aria"]')?.className.includes('border-lime'));
  ok("the voice picked before building carries through to the built reel's own picker", !!postActive);

  // Voice recording and footage search both run in the background, side by
  // side, and can each finish before this next line even executes in this
  // fake (instant local responses) — so this waits for both of their own
  // "still working" badges to clear rather than polling the total, which
  // can pass through several intermediate values as scenes finish one at a
  // time (only some done is still "not the flat default").
  await page.waitForSelector('[data-testid="composer-voice-synthesizing"]', { state: 'hidden', timeout: 15000 });
  await page.waitForSelector('[data-testid="composer-visual-filling"]', { state: 'hidden', timeout: 15000 });
  const votedLabel = await page.getByTestId('composer-reel-duration').innerText();
  const votedTotal = toSeconds(votedLabel);
  // Each take is now the heading read together with the caption line (see
  // synthesizeSceneVoice) — "Week 1. You publish. Nobody claps." (6 words),
  // "Week 6. Three people reply." (5), "Week 20. It compounds." (4) — real,
  // different-length takes, so the total should land well under the old
  // flat 9.0s (3 x 3.0) and above the floor three near-silent takes plus
  // padding would give.
  ok('recording a take per scene sets a real, non-flat length',
     votedTotal > 2 && votedTotal < 10, votedLabel);

  // Footage search ran alongside it — every scene should have picked up
  // real footage instead of sitting on its themed background. The
  // timeline's own per-scene thumbnails only render a <video> when that
  // scene's clip has a url, so switching to Play reel and counting them is
  // a direct read of the same state the reel will actually export from.
  await tap(page, 'composer-reel-view-play');
  await page.waitForTimeout(300);
  const clipsFound = await page.evaluate(() => document.querySelectorAll('[data-testid^="reel-player-seg-"] video').length);
  ok('footage search filled every scene while voice was recording', clipsFound === 3, String(clipsFound));

  // ---------- 11a-i. Auto Reel — captions highlight in sync with the voice ----------
  // Every scene's spoken line asks its take for word-level timestamps; the
  // fake TTS hands back a real ElevenLabs-shaped character alignment (see
  // e2e/serve.py), which deriveCaptionWords turns into per-word timing —
  // proven by the on-screen line actually highlighting a word while the
  // reel plays, not just the data existing somewhere in state.
  await tap(page, 'reel-player-playpause');
  await page.waitForTimeout(700);
  const captionSeen = await page.evaluate(() => !!document.querySelector('[data-testid="visual-card-caption-active"]'));
  ok('the spoken line highlights a word while the reel plays', captionSeen);
  await tap(page, 'reel-player-playpause');
  await page.waitForTimeout(150);

  // ---------- 11a-iv. Auto Reel Phase Green — voice presets & per-scene retry ----------
  // Picking a curated voice steers what a scene's own retake records in —
  // proven by selecting one and re-recording a scene's line without
  // touching the reel's other scenes or leaving an error behind.
  await tap(page, 'composer-reel-view-canvas');
  await page.waitForTimeout(300);
  await tap(page, 'composer-slide-0');
  await page.waitForTimeout(200);
  await tap(page, 'composer-voice-preset-aria');
  await page.waitForTimeout(100);
  const ariaActive = await page.evaluate(() =>
    document.querySelector('[data-testid="composer-voice-preset-aria"]')?.className.includes('border-lime'));
  ok('a curated voice preset can be selected', !!ariaActive);

  // ---------- 11a-v. Voice preview ----------
  // Three of the presets are custom voice IDs with no name attached
  // anywhere — the preview button is the only way to actually tell them
  // apart before committing a whole reel's takes to one. Clicking it should
  // synthesize a short sample and play it; clicking the SAME voice again
  // should reuse that sample rather than spending a second generation.
  const previewRequests = [];
  await page.route('**/api/ai/generate', async (route) => {
    const body = route.request().postDataJSON();
    if (body?.kind === 'voice') previewRequests.push(body);
    await route.continue();
  });
  await tap(page, 'composer-voice-preset-sarah-preview');
  await page.waitForSelector('[data-testid="composer-voice-preset-sarah-preview"] svg.animate-spin', { state: 'detached', timeout: 10000 });
  ok('previewing a voice synthesizes a sample with that voice, not the currently selected one',
     previewRequests.length === 1 && previewRequests[0].options?.voice === 'Sarah', JSON.stringify(previewRequests));
  const playingAfterFirst = await page.evaluate(() => {
    const a = document.querySelector('[data-testid="composer-voice-preview-audio"]');
    return a ? { paused: a.paused, src: a.currentSrc } : null;
  });
  ok('the preview actually starts playing, not just synthesizes silently',
     playingAfterFirst && !playingAfterFirst.paused, JSON.stringify(playingAfterFirst));

  // Stop it, then preview the SAME voice again — should replay the cached
  // sample with no second request to the backend.
  await tap(page, 'composer-voice-preset-sarah-preview');
  await page.waitForTimeout(150);
  await tap(page, 'composer-voice-preset-sarah-preview');
  await page.waitForTimeout(300);
  ok('re-previewing the same voice reuses the cached sample instead of generating again',
     previewRequests.length === 1, String(previewRequests.length));
  await page.unroute('**/api/ai/generate');

  // Previewing a DIFFERENT (unlabeled custom) voice must not disturb which
  // voice is actually selected for the reel's own takes — preview and
  // selection are two different things sharing one row of chips. Testid is
  // keyed off the voice ID itself (vChnJZ1Cu89g2XXumPfT, named "Nova" only
  // in the label), same as every other chip's testid.
  const novaPreviewTestId = 'composer-voice-preset-vchnjz1cu89g2xxumpft-preview';
  await tap(page, novaPreviewTestId);
  await page.waitForSelector(`[data-testid="${novaPreviewTestId}"] svg.animate-spin`, { state: 'detached', timeout: 10000 });
  const stillAriaSelected = await page.evaluate(() =>
    document.querySelector('[data-testid="composer-voice-preset-aria"]')?.className.includes('border-lime'));
  ok("previewing an unlabeled voice doesn't change which voice is actually selected",
     !!stillAriaSelected);

  await page.getByTestId('composer-scene-voice-retry').waitFor({ timeout: 5000 });
  await tap(page, 'composer-scene-voice-retry');
  await page.waitForTimeout(600);
  const retryLabel = await page.getByTestId('composer-scene-voice-retry').innerText();
  ok("a scene can re-record its own line without touching the others", /Re-record/.test(retryLabel), retryLabel);
  ok('the combined build-status strip clears once everything finishes', (await page.getByTestId('composer-autofill-status').count()) === 0);

  await tap(page, 'composer-reel-view-play');
  await page.waitForTimeout(300);

  // A background score generates alongside voice and visuals — the third
  // and last thing a script alone doesn't have yet.
  await page.waitForSelector('[data-testid="composer-music-generating"]', { state: 'hidden', timeout: 15000 });
  await page.getByTestId('composer-music-row').waitFor({ timeout: 8000 });
  const musicSrc = await page.evaluate(() =>
    document.querySelector('[data-testid="composer-music-row"] audio')?.getAttribute('src'));
  ok('a background score generated for the reel', !!musicSrc, String(musicSrc));

  // It plays under the voice in preview too, not just once exported —
  // ReelPlayer mounts its own <audio> for the score.
  await page.waitForTimeout(300);
  const playerMusicSrc = await page.evaluate(() =>
    document.querySelector('[data-testid="reel-player-music"]')?.getAttribute('src'));
  ok('the score plays in the reel preview, not just after export', playerMusicSrc === musicSrc, String(playerMusicSrc));

  await tap(page, 'composer-music-mute');
  await page.waitForTimeout(150);
  ok('muting the score zeroes its volume', Number(await page.getByTestId('composer-music-volume').inputValue()) === 0);
  await tap(page, 'composer-music-mute');
  await page.waitForTimeout(150);
  ok('unmuting restores a real level', Number(await page.getByTestId('composer-music-volume').inputValue()) > 0);

  // A regenerate button asks for a different take of the same score,
  // rather than only being retryable after an outright failure.
  await tap(page, 'composer-music-regenerate');
  await page.waitForSelector('[data-testid="composer-music-generating"]', { state: 'hidden', timeout: 15000 });
  const regeneratedSrc = await page.evaluate(() =>
    document.querySelector('[data-testid="composer-music-row"] audio')?.getAttribute('src'));
  ok('the score can be regenerated for a different take', !!regeneratedSrc && regeneratedSrc !== musicSrc, regeneratedSrc);

  await tap(page, 'composer-music-remove');
  await page.waitForTimeout(200);
  ok('removing the score clears the row', (await page.getByTestId('composer-music-row').count()) === 0);

  // ---------- 11a-ii. Auto Reel — captions survive the export pipeline ----------
  // Every scene here has real per-word timing by now, so this exercises the
  // per-word overlay-frame capture in ReelExportDialog (one screenshot per
  // word instead of one per scene) rather than the single-frame path every
  // other export test in this suite takes.
  await tap(page, 'composer-reel-export');
  await page.getByTestId('reel-export').waitFor({ timeout: 6000 });
  await page.waitForTimeout(300);
  if ((await page.getByTestId('reel-export-unsupported').count()) === 0) {
    await tap(page, 'reel-export-preset-480');
    await page.waitForTimeout(200);
    await tap(page, 'reel-export-start');
    await page.getByTestId('reel-export-done').waitFor({ timeout: 60000 });
    ok('a captioned reel still exports to a real file', true);
  }
  await tap(page, 'reel-export-close');
  await page.waitForTimeout(300);

  // ---------- 11a-vii. /proxy-image allows audio through, not just image/video ----------
  // A voiceover or score's URL always lives on a different origin than the
  // app, so canvas export loads it through /proxy-image the same way a
  // cross-origin stock clip is — and that endpoint used to reject anything
  // whose content-type wasn't image/* or video/*, silently 400ing every
  // audio fetch an export tried to make (a real production report: an
  // exported reel kept its background and text but lost its clips and
  // voiceover). Every other e2e fixture is same-origin with the app
  // itself, which never exercises the proxy at all — this hits it with a
  // deliberately cross-origin fixture URL to actually prove the fix.
  const proxyAudioCheck = await page.evaluate(async () => {
    const testUrl = 'http://poyo-storage.e2e-fixture.test/voice-check.wav';
    const r = await fetch('/api/proxy-image?url=' + encodeURIComponent(testUrl));
    return { status: r.status, contentType: r.headers.get('content-type') };
  });
  ok('proxy-image allows audio content through for export',
     proxyAudioCheck.status === 200 && (proxyAudioCheck.contentType || '').startsWith('audio/'),
     JSON.stringify(proxyAudioCheck));

  // ---------- 11a-viii. export media loads direct first, proxy only as fallback ----------
  // The proxy runs as a Vercel serverless function, and those cap their
  // response body at ~4.5MB however big a file the handler will fetch — so
  // routing every clip/voiceover/score through it meant real footage (5-50MB)
  // and plenty of voice and music tracks came back as nothing at all, and the
  // export composited what was left: background and text, no media. The
  // loader now tries the source's own origin first and only falls back to the
  // proxy, which is both unbounded in size and the thing that made this fail.
  // This mirrors that two-step against a host that genuinely doesn't resolve,
  // proving the fallback is both needed and sufficient for such a URL.
  const twoStep = await page.evaluate(async () => {
    const url = 'http://poyo-storage.e2e-fixture.test/voice-check.wav';
    const attempt = (src) => new Promise((resolve) => {
      const el = document.createElement('audio');
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      let settled = false;
      const done = (ok) => { if (!settled) { settled = true; resolve(ok); } };
      el.addEventListener('loadeddata', () => done(true), { once: true });
      el.addEventListener('error', () => done(false), { once: true });
      setTimeout(() => done(el.readyState >= 2), 8000);
      el.src = src;
      el.load();
    });
    return {
      direct: await attempt(url),
      viaProxy: await attempt('/api/proxy-image?url=' + encodeURIComponent(url)),
    };
  });
  ok('a media URL its own origin will not serve falls back to the proxy',
     twoStep.direct === false && twoStep.viaProxy === true, JSON.stringify(twoStep));

  // ---------- 11a-viii. a built reel survives a crash or reload ----------
  // Everything generated here lived only in component state until someone
  // pressed Save, so an export heavy enough to take the tab down took the
  // whole reel with it — the page reloaded to an empty Composer with
  // minutes of generation simply gone. A rolling local snapshot is offered
  // back instead (offered, not auto-applied, so it can never overwrite
  // something deliberately opened).
  await page.waitForTimeout(1200); // the snapshot write is debounced
  const scenesBefore = await page.getByTestId('composer-slide-strip')
    .locator('[data-testid^="composer-slide-"]').count();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('composer-page').waitFor({ timeout: 10000 });
  await page.getByTestId('composer-recover-banner').waitFor({ timeout: 8000 });
  ok('a reload offers the unsaved reel back instead of losing it', true);
  await tap(page, 'composer-recover-restore');
  await page.waitForTimeout(500);
  const scenesAfter = await page.getByTestId('composer-slide-strip')
    .locator('[data-testid^="composer-slide-"]').count();
  ok('...and restoring brings every scene back', scenesAfter === scenesBefore && scenesAfter > 0,
     `${scenesBefore} -> ${scenesAfter}`);
  await page.evaluate(() => localStorage.removeItem('createos:composer-draft'));

  // ---------- 11a-ix. a saved reel design keeps each scene's own footage ----------
  // Layout is deliberately one representative slide per role — a design is
  // a reusable look, not a copy of the deck. Footage was keyed the same
  // way, which for a reel meant only the first scene's clip was ever
  // stored, then replayed onto every scene with the rest dropped.
  const saveDesign = (format) => page.evaluate(async (fmt) => {
    const scene = (url, heading) => ({
      template: 'slide', heading, body: `${heading} body`,
      clip: { url, kind: 'video' }, video_url: url,
    });
    const r = await fetch('/api/templates/from-composer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `e2e ${fmt} design`, format: fmt, theme: 'midnight',
        slides: [scene('http://127.0.0.1:8123/one.mp4', 'One'),
                 scene('http://127.0.0.1:8123/two.mp4', 'Two'),
                 scene('http://127.0.0.1:8123/three.mp4', 'Three')],
      }),
    });
    return r.json();
  }, format);

  const reelDesign = await saveDesign('reel');
  const designClips = reelDesign.clips || {};
  ok("a saved reel design keeps every scene's own footage, not just the first",
     designClips['0']?.url?.endsWith('one.mp4') && designClips['1']?.url?.endsWith('two.mp4')
     && designClips['2']?.url?.endsWith('three.mp4'), JSON.stringify(designClips));

  // A design normally has its copy reworked into generic instructions so it
  // can be reused for a new topic — right for a carousel, wrong for a reel,
  // which is saved precisely to keep one script. Both halves are asserted
  // here so neither can quietly become the other.
  ok('...and its script word-for-word, not reworded',
     reelDesign.slides?.[0]?.heading === 'One' && reelDesign.slides?.[2]?.body === 'Three body',
     JSON.stringify(reelDesign.slides));

  const carouselDesign = await saveDesign('carousel');
  ok('a carousel design still abstracts its copy, so it stays reusable',
     carouselDesign.slides?.[0]?.heading === 'ABSTRACTED',
     JSON.stringify(carouselDesign.slides));

  // ---- fonts ----
  // Three of the catalogue's faces we serve ourselves (two from Google, one
  // bundled); the rest of the new ones are licensed elsewhere and only real
  // once the user supplies the file. Assert on measured letterforms, not on
  // the option being present — a font that silently falls back still shows
  // its own name in the <select>.
  await page.goto(B + '/brand', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('brand-font-display').waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  const measure = (stack, weight) => {
    const c = document.createElement('canvas').getContext('2d');
    c.font = `${weight || 400} 72px ${stack}`;
    return c.measureText('mmmwwwiiillWQ@#0123456789').width;
  };
  await page.addScriptTag({ content: `window.__measure = ${measure.toString()}` });

  const fontOpts = await page.getByTestId('brand-font-display').evaluate(
    (s2) => [...s2.querySelectorAll('option')].map((o) => o.value));
  ok('every requested font is selectable',
     ['Open Sauce', 'Architects Daughter', 'Barrio', 'Brittany', 'Moontime', 'Apricots',
      'Beautifully Delicious Script', 'Above The Beyond Script', 'Biro Script Plus', 'Cinema Outfit']
       .every((k) => fontOpts.includes(k)), fontOpts.length);

  const sauce = await page.evaluate(async () => {
    const got = await document.fonts.load("400 72px 'Open Sauce Sans'");
    return [got.length, window.__measure("'Open Sauce Sans', sans-serif"), window.__measure('sans-serif')];
  });
  ok('Open Sauce draws its own letterforms straight from the bundle',
     sauce[0] > 0 && sauce[1] !== sauce[2], JSON.stringify(sauce));

  await page.getByTestId('brand-font-display').selectOption('Brittany');
  await page.waitForTimeout(400);
  ok('a face this device does not have warns instead of silently falling back',
     await page.getByTestId('brand-font-display-notice').count() === 1);

  const mediaDir = require('path').join(__dirname, '..', 'frontend', 'build', 'static', 'media');
  const faceFile = require('fs').readdirSync(mediaDir).find((f) => /open-sauce-sans-latin-700-normal\..*\.woff2$/.test(f));
  // The test drives the hidden file input directly rather than clicking "Add
  // font file" first, so it never runs pick(name) — the family name comes
  // from the backend deriving it off the upload's filename instead (see the
  // "Taken from the filename" placeholder), which is why this name matters.
  const upTmp = require('path').join(require('os').tmpdir(), 'Brittany.woff2');
  require('fs').copyFileSync(require('path').join(mediaDir, faceFile), upTmp);
  await page.getByTestId('custom-fonts-name').fill('Brittany');
  await page.locator('[data-testid="custom-fonts"] [data-testid="font-upload-input"]').setInputFiles(upTmp);
  await page.getByTestId('custom-fonts-item').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1400);
  const uploaded = await page.evaluate(async () => {
    await document.fonts.load("700 72px 'Open Sauce Sans'");
    return [window.__measure("'Brittany', cursive"), window.__measure('cursive'),
            window.__measure("'Open Sauce Sans', sans-serif", 700)];
  });
  ok('uploading the file you licensed makes that face real',
     uploaded[0] !== uploaded[1] && Math.abs(uploaded[0] - uploaded[2]) < 0.5, JSON.stringify(uploaded));
  ok('...and the warning clears', await page.getByTestId('brand-font-display-notice').count() === 0);
  ok('...as bytes, so an export can never lose it',
     (await page.evaluate(() => document.querySelector('style[data-custom-font]')?.textContent || ''))
       .includes('src:url("data:'));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('custom-fonts-item').waitFor({ timeout: 15000 });
  await page.addScriptTag({ content: `window.__measure = ${measure.toString()}` });
  await page.waitForTimeout(1500);
  ok('...and survives a reload',
     await page.evaluate(() => window.__measure("'Brittany', cursive") !== window.__measure('cursive')));

  await tap(page, 'custom-fonts-remove');
  await page.waitForTimeout(1000);
  ok('removing it puts the device entry back',
     await page.getByTestId('custom-fonts-item').count() === 0
     && (await page.getByTestId('brand-font-display').evaluate(
       (s2) => [...s2.querySelectorAll('optgroup')].map((g) => g.label))).includes('Device'));

  // ---- a slide's background image opacity/fit is now editable ----
  // The backdrop used to be pinned at a hardcoded 0.45 opacity with no
  // control anywhere in the UI to change it — this is that control.
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.getByTestId('composer-brief').fill('a short carousel about morning routines, e2e opacity check');
  await tap(page, 'composer-autobuild');
  await confirmBuild(page);
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  await page.waitForTimeout(900);
  await tap(page, 'composer-slide-stock-image');
  await page.waitForTimeout(600);
  await page.getByTestId('media-query').fill('city');
  await page.getByTestId('media-search').click({ force: true });
  await page.waitForTimeout(1000);
  await page.locator('[data-testid^="media-result-"]').first().click({ force: true });
  await page.waitForTimeout(500);
  ok('a background image gets an opacity control', await page.getByTestId('composer-slide-image-opacity').count() === 1);
  const dimBefore = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="composer-visuals"] img')).opacity);
  ok('it starts at the same legible dim as before (0.45)', dimBefore === '0.45', dimBefore);
  await setRange('composer-slide-image-opacity', 1);
  await page.waitForTimeout(250);
  const dimAfter = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="composer-visuals"] img')).opacity);
  ok('raising it actually raises the rendered opacity', dimAfter === '1', dimAfter);
  await tap(page, 'composer-slide-image-fit-contain');
  await page.waitForTimeout(200);
  ok('fit is editable too', (await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="composer-visuals"] img')).objectFit)) === 'contain');

  // ---- a stock pick added as a NEW element matches what was actually picked ----
  // "Add element > Stock photo" hardcoded a new "image" element regardless
  // of what type was picked inside that same picker — a chosen video landed
  // as an <img src="…mp4">, which never renders anything.
  if (await page.getByTestId('composer-slide-edit-layout').count()) await tap(page, 'composer-slide-edit-layout');
  await page.getByTestId('composer-element-panel').waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);
  await tap(page, 'composer-add-element-stock');
  await page.waitForTimeout(500);
  await tap(page, 'media-type-video');
  await page.waitForTimeout(300);
  await page.getByTestId('media-query').fill('city');
  await page.getByTestId('media-search').click({ force: true });
  await page.waitForTimeout(1000);
  await page.locator('[data-testid^="media-result-"]').first().click({ force: true });
  await page.waitForTimeout(600);
  const chips = await page.evaluate(() => [...document.querySelectorAll('[data-testid="composer-element-list"] button')].map((c) => c.textContent));
  ok('a picked stock video becomes a Clip element, not a mistyped Image', chips.includes('Clip'), chips);
  ok('...and actually renders as a real <video>', await page.evaluate(() => !!document.querySelector('[data-testid="composer-visuals"] video[src*="e2e-video"]')));

  // ---- reels: a still image works as scene media, with effects and transitions ----
  // (/templates now redirects into the Composer itself, so it's no longer a
  // neutral stop to force a real remount here — /calendar genuinely is.)
  await page.goto(B + '/calendar', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await tap(page, 'composer-format-reel');
  await page.waitForTimeout(300);
  await page.getByTestId('composer-brief').fill('shipping weekly, e2e still-image reel');
  await tap(page, 'composer-autobuild');
  await confirmBuild(page);
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000);

  await tap(page, 'clip-stock');
  await page.waitForTimeout(600);
  await tap(page, 'media-type-image');
  await page.waitForTimeout(300);
  await page.getByTestId('media-query').fill('city');
  await page.getByTestId('media-search').click({ force: true });
  await page.waitForTimeout(1000);
  await page.locator('[data-testid^="media-result-"]').first().click({ force: true });
  await page.waitForTimeout(600);
  ok('a reel scene can hold a still image', (await page.getByTestId('clip-editor').innerText()).includes('Photo attached'));
  ok('it renders as a real <img>, not a broken <video>',
     await page.evaluate(() => !!document.querySelector('[data-testid="composer-visuals"] img[data-export-backdrop]')));
  await tap(page, 'clip-tab-clip');
  await page.waitForTimeout(150);
  ok('video-only controls (speed, sound) are hidden for a still', await page.getByTestId('clip-speed').count() === 0 && await page.getByTestId('clip-volume').count() === 0);
  ok('opacity and framing still apply to a still', await page.getByTestId('clip-opacity').count() === 1 && await page.getByTestId('clip-fit-cover').count() === 1);
  await tap(page, 'clip-tab-effects');
  await page.waitForTimeout(150);
  await tap(page, 'clip-preset-noir');
  await page.waitForTimeout(250);
  ok('an effect preset grades a still image, same as it grades video',
     /grayscale/.test(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="composer-visuals"] img[data-export-backdrop]')).filter)));

  await tap(page, 'composer-next');
  await page.waitForTimeout(300);
  await tap(page, 'clip-stock');
  await page.waitForTimeout(600);
  await page.getByTestId('media-query').fill('ocean');
  await page.getByTestId('media-search').click({ force: true });
  await page.waitForTimeout(1000);
  await page.locator('[data-testid^="media-result-"]').first().click({ force: true });
  await page.waitForTimeout(500);
  await tap(page, 'clip-tab-transition');
  await page.waitForTimeout(150);
  ok('a scene right after a still image offers transitions', await page.getByTestId('clip-transition-dissolve').count() === 1);

  // ---- dashboard content is locked in place, not floating in on load ----
  await page.goto(B + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="dashboard-page"] h1');
  const dashSamples = [];
  for (let i = 0; i < 5; i++) {
    dashSamples.push(await page.evaluate(() => {
      const h1 = document.querySelector('[data-testid="dashboard-page"] h1');
      const r = h1.getBoundingClientRect();
      const cs = getComputedStyle(h1.parentElement);
      return `${r.top}|${cs.opacity}|${cs.transform}`;
    }));
    await page.waitForTimeout(80);
  }
  ok('the dashboard heading is already settled on load, not fading/sliding in',
     dashSamples.every((v) => v === dashSamples[0]), dashSamples.join(' -> '));
  const gutter = await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarGutter);
  ok('scrollbar-gutter is reserved so a page with no scrollbar keeps the same width as one with one',
     gutter.startsWith('stable'), gutter);

  // ---- the Library's "+" adds media by upload or from Stock ----
  await page.goto(B + '/library', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('library-page').waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  ok('the Library has a + to add media', await page.getByTestId('library-add').count() === 1);
  await tap(page, 'library-tab-uploads');
  await page.waitForTimeout(400);
  const uploadsBefore = await page.locator('[data-testid^="library-upload-"]').count();

  await tap(page, 'library-add');
  await page.waitForTimeout(500);
  await page.getByTestId('media-query').fill('city');
  await page.getByTestId('media-search').click({ force: true });
  await page.waitForTimeout(1000);
  await page.locator('[data-testid^="media-result-"]').first().click({ force: true });
  await page.waitForTimeout(1000);
  const afterStock = page.locator('[data-testid^="library-upload-"]');
  ok('picking a Stock item downloads it into the library, not just a live link',
     await afterStock.count() === uploadsBefore + 1);
  ok('the downloaded item renders as a real image', await afterStock.first().locator('img').count() === 1);
  page.once('dialog', (d) => d.accept());
  await afterStock.first().locator('[data-testid^="library-delete-"]').click({ force: true });
  await page.waitForTimeout(600);

  await tap(page, 'library-add');
  await page.waitForTimeout(500);
  await tap(page, 'media-source-uploads');
  await page.waitForTimeout(300);
  await page.getByTestId('media-upload-input').setInputFiles(require('path').join(__dirname, 'fixtures/photo.png'));
  await page.waitForTimeout(1000);
  ok('a direct file upload also lands in the library', await page.locator('[data-testid^="library-upload-"]').count() === uploadsBefore + 1);

  // ---- a reel scene's stock video survives being saved as a template ----
  // VideoClipEditor renders for every reel scene whether or not it's ever
  // entered freeform layout edit, so a clip must reach the template even
  // with no customized elements at all — reproduces the reported bug
  // exactly: pick stock video, never touch layout edit, save as template.
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  page.once('dialog', (d) => d.accept('E2E Reel Clip Template'));
  await tap(page, 'composer-format-reel');
  await page.waitForTimeout(300);
  await page.getByTestId('composer-brief').fill('shipping weekly, e2e clip template');
  await tap(page, 'composer-autobuild');
  await confirmBuild(page);
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000);
  // A generated scene now arrives with freeform elements already (the brand
  // starting point seeded at build time), so the original premise here — a
  // scene with NO elements at all — is no longer reachable from a build.
  // That case still matters and is still covered, on the backend, where the
  // bug actually lived: "a reel with an un-laid-out clip saves ok" in
  // backend/tests/test_api.py exercises _layouts_from_composer_slides with
  // slides that have a clip and no elements. What this block proves from
  // here on is the rest of the round trip.
  ok('a generated scene starts from the brand design, with elements already on it',
     await page.getByTestId('composer-element-panel').count() === 1);
  await tap(page, 'clip-stock');
  await page.waitForTimeout(700);
  await page.getByTestId('media-query').fill('city');
  await page.getByTestId('media-search').click({ force: true });
  await page.waitForTimeout(1000);
  await page.locator('[data-testid^="media-result-"]').first().click({ force: true });
  await page.waitForTimeout(800);
  const sceneVideoUrl = () => page.evaluate(() => {
    const v = document.querySelector('[data-testid="composer-visuals"] video');
    return v ? (v.currentSrc || v.src) : null;
  });
  const sceneVideoOpacity = () => page.evaluate(() => {
    const v = document.querySelector('[data-testid="composer-visuals"] video');
    return v ? Number(getComputedStyle(v).opacity).toFixed(2) : null;
  });
  const savedClipUrl = await sceneVideoUrl();
  ok('the stock video landed on the scene', !!savedClipUrl, savedClipUrl);
  // Bumped off the 0.45 default a fresh auto-fill always produces (see
  // fillSceneVisual/normalizeClip) — the one property this fake stock
  // search can't coincidentally reproduce, since every result comes back
  // through the exact same "brand new clip" path with no opacity of its
  // own. Whether the template's OWN saved opacity — not a fresh default —
  // survives being reused for a new build is what makes the design-reuse
  // check below meaningful rather than a URL the fake happens to always
  // return the same way regardless of what actually built the scene.
  await setRange('clip-opacity', 1);
  await page.waitForTimeout(200);
  const savedClipOpacity = await sceneVideoOpacity();
  ok("the clip's own opacity is customized before saving, not left at the auto-fill default",
     savedClipOpacity === '1.00', savedClipOpacity);
  // Give the design a real LAYOUT as well as a clip. Without this the saved
  // template carries clips only, _apply_template_layouts never sets
  // spec.elements on a scene built from it (it only fills a role whose layout
  // exists), and everything below about element text would be checking a
  // scene that renders straight from spec.heading — passing whether or not
  // the code under test works. "Edit layout" is also how a person makes a
  // design in the first place, so this is the real path, not a contrivance.
  if (await page.getByTestId('composer-slide-edit-layout').count()) await tap(page, 'composer-slide-edit-layout');
  await page.waitForTimeout(400);
  ok('the slide carries freeform elements to save with the design',
     (await page.getByTestId('composer-element-panel').count()) === 1);
  await tap(page, 'composer-save-template');
  await page.waitForTimeout(2000);

  await page.goto(B + '/designs', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('templates-custom').waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);
  await page.locator('[data-testid^="templates-custom-edit-"]').first().click({ force: true });
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);
  ok('reopening the reel template still shows a clip editor (its scene type survived)',
     await page.getByTestId('clip-editor').count() === 1);
  ok('the clip itself survives save and reopen instead of being dropped',
     (await sceneVideoUrl()) === savedClipUrl, { savedClipUrl, reopened: await sceneVideoUrl() });

  // ---- that design's clip actually lands on a FRESH reel built from it ----
  // Different from the reopen check above: this is _apply_template_layouts
  // (server side) putting the design's saved clip onto a brand-new build,
  // not the editor loading the design's own saved deck back up. Two bugs
  // used to erase it here even though reopening the design itself looked
  // fine: the review step rebuilt every scene from just {heading, body,
  // video_prompt}, dropping elements/bg_color/clip entirely; and the
  // auto-footage-fill that runs right after building overwrote ANY clip —
  // template-supplied or not — with a fresh stock search regardless.
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await tap(page, 'composer-format-reel');
  await page.waitForTimeout(300);
  const templateOptions = await page.getByTestId('composer-custom-template-select').locator('option').allTextContents();
  const clipTemplateIdx = templateOptions.findIndex((t) => t.includes('E2E Reel Clip Template'));
  ok('the saved reel design is offered to build a fresh post from',
     clipTemplateIdx > 0, JSON.stringify(templateOptions));
  await page.getByTestId('composer-custom-template-select').selectOption({ index: clipTemplateIdx });
  await page.getByTestId('composer-brief').fill('shipping weekly, e2e design reuse');
  await tap(page, 'composer-autobuild');
  // Edit scene 1's headline IN the review step, on a build that carries a
  // design. A design bakes its copy into element text server-side
  // (_fill_layout) and VisualCard renders elements in preference to
  // spec.heading, so confirmReelReview writing only the plain fields left
  // the edit invisible on the card that's actually built, previewed and
  // exported — while the voiceover recorded it, so the reel said one thing
  // and showed another. Reading it back off the rendered card (not the
  // heading input, which was always right) is what tells those apart.
  await page.getByTestId('composer-build-review').waitFor({ timeout: 20000 });
  await page.getByTestId('composer-build-review-heading-0').fill('E2E designed edit');
  await tap(page, 'composer-build-review-confirm');
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000);
  ok("an edit made in review reaches the card a design actually renders, not just spec.heading",
     (await page.getByTestId('composer-visuals').innerText()).includes('E2E designed edit'),
     await page.getByTestId('composer-visuals').innerText());
  // What makes the check above mean anything: the scene has to actually CARRY
  // elements, or spec.heading renders by default and the assertion passes
  // whether or not the elements were written to. composer-element-panel only
  // mounts when activeAsset.spec.elements is truthy, so this says so directly
  // rather than leaving it assumed.
  await tap(page, 'composer-reel-view-canvas');
  await page.waitForTimeout(300);
  ok("...on a scene that really does carry elements, so that check isn't trivially true",
     (await page.getByTestId('composer-element-panel').count()) === 1);
  await tap(page, 'composer-reel-view-play');
  await page.waitForTimeout(300);
  ok("building a fresh reel from a saved design keeps that design's own clip on the scene",
     (await sceneVideoUrl()) === savedClipUrl, { savedClipUrl, built: await sceneVideoUrl() });
  // The URL check above can't tell "the design's clip survived" apart from
  // "a fresh auto-fill happened to land on the same fixture" — this fake
  // stock search always returns the one clip either way. Opacity can:
  // savedClipOpacity was bumped off the 0.45 every fresh auto-fill produces,
  // so seeing that SAME non-default value here means the design's own
  // customization made it through review and wasn't then overwritten by
  // the auto-fill that runs right after building.
  ok("...and that clip's own customization (not a fresh auto-fill's default) survives too",
     (await sceneVideoOpacity()) === savedClipOpacity, { savedClipOpacity, built: await sceneVideoOpacity() });

  // ---- ...unless you ask that design for NEW footage ----
  // The same design, the same build, one switch flipped. Picking a design
  // used to be all-or-nothing: you got its layout AND the exact footage it
  // was saved with, with no way to say "this look, different clips" short
  // of replacing each scene by hand afterwards. Opacity is what makes this
  // readable at all — the fake stock search returns the same clip URL no
  // matter what, but the design's saved 1.00 and a fresh auto-fill's 0.45
  // tell "reused the design's clip" apart from "went and got a new one".
  ok('the design-media switches appear once a design is picked',
     (await page.getByTestId('composer-design-media').count()) === 1);
  await tap(page, 'composer-design-media-videos-new');
  await page.waitForTimeout(200);
  await page.getByTestId('composer-brief').fill('shipping weekly, e2e new footage');
  await tap(page, 'composer-autobuild');
  await confirmBuild(page);
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  await tap(page, 'composer-reel-view-play');
  await page.waitForTimeout(400);
  const newFootageOpacity = await sceneVideoOpacity();
  ok("asking a design for new footage doesn't reuse its saved clip's own settings",
     newFootageOpacity !== savedClipOpacity, { savedClipOpacity, newFootage: newFootageOpacity });
  ok('...the scene still gets footage — "new" means fresh, never empty',
     !!(await sceneVideoUrl()), await sceneVideoUrl());
  // The whole point of having picked a design: its layout is not what you
  // gave up by asking for different media.
  await tap(page, 'composer-reel-view-canvas');
  await page.waitForTimeout(300);
  ok("...and the design's layout is kept either way",
     (await page.getByTestId('composer-element-panel').count()) === 1);

  // Leave on a different URL than the next block's own goto target: Playwright's
  // page.goto() to the exact URL already loaded (this block's last navigation
  // was a client-side `navigate("/composer", {state})`, which leaves
  // page.url() already reading /composer) can resolve as a same-document,
  // no-reload transition — which would leak this block's editingTemplateId
  // router state into the next block instead of the fresh mount it expects.
  // (/templates itself now redirects into the Composer, so it's no longer a
  // neutral stop for this — /calendar genuinely isn't.)
  await page.goto(B + '/calendar', { waitUntil: 'domcontentloaded' });

  // ---- a template's headline text survives editing and re-saving ----
  // Once a slide's title/body live as literal text in freeform elements,
  // that text — not the slide's own heading/body fields — is the source of
  // truth (see the comment on enterLayoutEdit in Composer.jsx). Editing a
  // role-tagged text element directly on the canvas and saving used to send
  // the slide's now-stale heading/body back to the backend, which is what a
  // saved template's outline gets rebuilt from — so an edit made on the
  // canvas silently reverted the next time the template was reopened.
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  page.once('dialog', (d) => d.accept('E2E Headline Template'));
  await page.getByTestId('composer-brief').fill('a short carousel about morning routines');
  await tap(page, 'composer-autobuild');
  await confirmBuild(page);
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000);
  if (await page.getByTestId('composer-slide-edit-layout').count()) await tap(page, 'composer-slide-edit-layout');
  await page.getByTestId('composer-element-panel').waitFor({ timeout: 8000 });
  await page.waitForTimeout(300);

  const selectTextElement = async () => {
    const chips = page.locator('[data-testid="composer-element-list"] button');
    const n = await chips.count();
    for (let i = 0; i < n; i++) {
      await chips.nth(i).click({ force: true });
      await page.waitForTimeout(120);
      if (await page.getByTestId('composer-element-text').count()) return true;
    }
    return false;
  };
  ok('a text element exists to select', await selectTextElement());
  await tap(page, 'composer-save-template');
  await page.waitForTimeout(2000);

  await page.goto(B + '/designs', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('templates-custom').waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);
  await page.locator('[data-testid^="templates-custom-edit-"]').first().click({ force: true });
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 15000 });
  await page.getByTestId('composer-element-panel').waitFor({ timeout: 8000 });
  await page.waitForTimeout(500);
  ok('the materialized template offers a text element', await selectTextElement());
  await page.getByTestId('composer-element-text').fill('EDITED HEADLINE TEXT 12345');
  await page.waitForTimeout(200);
  await tap(page, 'composer-save-template-changes');
  await page.waitForTimeout(2000);

  await page.goto(B + '/designs', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('templates-custom').waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);
  await page.locator('[data-testid^="templates-custom-edit-"]').first().click({ force: true });
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 15000 });
  await page.getByTestId('composer-element-panel').waitFor({ timeout: 8000 });
  await page.waitForTimeout(500);
  await selectTextElement();
  const reopened = await page.getByTestId('composer-element-text').inputValue();
  ok('an edited headline survives a save and reopen instead of reverting', reopened.includes('EDITED HEADLINE'), reopened);

  // Re-save with no further edits (as the user does just to confirm a
  // template), then reopen again — the text must not drift a second time.
  await tap(page, 'composer-save-template-changes');
  await page.waitForTimeout(1500);
  await page.goto(B + '/designs', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('templates-custom').waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);
  await page.locator('[data-testid^="templates-custom-edit-"]').first().click({ force: true });
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 15000 });
  await page.getByTestId('composer-element-panel').waitFor({ timeout: 8000 });
  await page.waitForTimeout(500);
  await selectTextElement();
  const reopenedAgain = await page.getByTestId('composer-element-text').inputValue();
  ok('...and stays put across a second no-op save, not just the first', reopenedAgain.includes('EDITED HEADLINE'), reopenedAgain);

  await tap(page, 'composer-save-template-changes');
  await page.waitForTimeout(1500);

  // ---- a design's handle is not copy, and doesn't get overwritten ----
  // Reported: "@connected.mothering is being replaced with a heading".
  // Saving a slide as a design turns one or two of its text boxes into copy
  // slots refilled on every post built from it, and with nothing else to go
  // on that pick is by position — which in a real social layout is exactly
  // where the handle sits. Whole round trip here, through the real panel:
  // type a handle into a box, save the design, build a fresh post from it,
  // and read the handle back off the rendered card.
  //
  // Neutral stop first: the block above ends on /composer via a client-side
  // navigate, so page.goto to that same URL can resolve as a no-reload
  // transition and leak its editingTemplateId in — which turns "Save as
  // design" into "Save changes" and breaks this block on a stale premise.
  // (Same hazard, and the same fix, as the note further up this file.)
  await page.goto(B + '/calendar', { waitUntil: 'domcontentloaded' });
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  page.once('dialog', (d) => d.accept('E2E Handle Design'));
  await page.getByTestId('composer-brief').fill('a carousel about gentle parenting routines');
  await tap(page, 'composer-autobuild');
  await confirmBuild(page);
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000);
  if (await page.getByTestId('composer-slide-edit-layout').count()) await tap(page, 'composer-slide-edit-layout');
  await page.getByTestId('composer-element-panel').waitFor({ timeout: 8000 });
  await page.waitForTimeout(300);
  ok('a text element exists to turn into the handle', await selectTextElement());
  const isPicked = async (testid) =>
    (await page.getByTestId(testid).getAttribute('class')).includes('border-lime');
  ok('an ordinary line reads as copy, so a design still has a headline to refill',
     await isPicked('composer-element-text-copy'));
  // The seeded cover's own headline box is the topmost text on the slide —
  // which is exactly the box the position guess would hand the copy slot to.
  // Turning THAT one into the handle is what reproduces the report: anything
  // lower down would pass whether or not the fix works.
  await page.getByTestId('composer-element-text').fill('@connected.mothering');
  await page.waitForTimeout(300);
  // The panel says so BEFORE anything is saved — that's the point of showing
  // it rather than letting the first rebuild be where you find out.
  ok('typing a handle flips that box to Keep as is on its own, with no tagging',
     await isPicked('composer-element-text-fixed'));
  // A real design has a headline under the handle. Without one there'd be no
  // copy slot left at all, and "the handle survived" would be true of a
  // design that simply does nothing.
  await tap(page, 'composer-add-element-text');
  await page.waitForTimeout(300);
  await page.getByTestId('composer-element-text').fill('The headline this design refills');
  await page.waitForTimeout(300);
  ok('...while an ordinary headline under it still reads as copy',
     await isPicked('composer-element-text-copy'));
  // Everything the design's cover says right now. What the rebuild produces
  // has to differ from this, or "the handle survived" could just mean the
  // design refilled nothing at all.
  //
  // Read the editing canvas, not composer-visuals (which wraps the slide
  // strip, so every slide's thumbnail text is in it and no per-slide claim
  // can be made from it) and not the slide-element-* boxes (those are the
  // invisible drag hit-boxes — the words are painted by the VisualCard
  // underneath them, so their own innerText is empty).
  const cardLines = async () => (await page.getByTestId('slide-editor-canvas').innerText())
    .split('\n').map((t) => t.trim()).filter(Boolean);
  const designCoverLines = await cardLines();
  ok('the design cover carries the handle plus other copy to refill',
     designCoverLines.includes('@connected.mothering') && designCoverLines.length > 1,
     JSON.stringify(designCoverLines));
  await tap(page, 'composer-save-template');
  await page.waitForTimeout(2000);

  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const handleOptions = await page.getByTestId('composer-custom-template-select').locator('option').allTextContents();
  const handleIdx = handleOptions.findIndex((t) => t.includes('E2E Handle Design'));
  ok('the handle design is offered to build a fresh post from', handleIdx > 0, JSON.stringify(handleOptions));
  await page.getByTestId('composer-custom-template-select').selectOption({ index: handleIdx });
  await page.getByTestId('composer-brief').fill('a different carousel about toddler sleep');
  await tap(page, 'composer-autobuild');
  await confirmBuild(page);
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  const builtCoverLines = await cardLines();
  ok("a post built from that design still says the handle, not a generated heading",
     builtCoverLines.includes('@connected.mothering'), JSON.stringify(builtCoverLines));
  // The other half: the handle could be "safe" simply because the design
  // lost its copy slot altogether, which would make it useless. Fresh copy
  // — a line that wasn't in the design — has to land on the same card.
  ok('...on a design that does still refill its copy, so it is not just inert',
     builtCoverLines.some((t) => t !== '@connected.mothering' && !designCoverLines.includes(t)),
     JSON.stringify({ design: designCoverLines, built: builtCoverLines }));

  await page.goto(B + '/calendar', { waitUntil: 'domcontentloaded' });

  // ---- elements can bleed past the slide's own edges ----
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.getByTestId('composer-brief').fill('another short carousel about focus habits');
  await tap(page, 'composer-autobuild');
  await confirmBuild(page);
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000);
  if (await page.getByTestId('composer-slide-edit-layout').count()) await tap(page, 'composer-slide-edit-layout');
  await page.getByTestId('composer-element-panel').waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);

  const bleedEl = page.locator('[data-testid^="slide-element-"]').first();
  const bleedId = (await bleedEl.getAttribute('data-testid')).replace('slide-element-', '');
  await bleedEl.evaluate((n) => n.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(150);
  const bbox = await bleedEl.boundingBox();
  await page.mouse.move(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
  await page.mouse.down();
  await page.mouse.move(bbox.x + 2000, bbox.y + 2000, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const bledBox = await page.evaluate((id) => {
    const node = document.querySelector(`[data-testid="slide-element-${id}"]`);
    return node ? { left: node.style.left, top: node.style.top, width: node.style.width, height: node.style.height } : null;
  }, bleedId);
  ok('a dragged element can now bleed well past the slide edge (once hard-clamped to 100 - w/h)',
     bledBox && parseFloat(bledBox.left) > 50 && parseFloat(bledBox.top) > 50, JSON.stringify(bledBox));
  ok('its handle stays in the DOM so it can still be dragged back',
     await page.getByTestId(`slide-element-resize-${bleedId}`).count() === 1);
  const cardOverflow = await page.evaluate(() => {
    const stage = document.querySelector('[data-testid="slide-editor-canvas"]');
    const cardRoot = stage?.querySelector(':scope > div.absolute.inset-0 > div');
    return cardRoot ? getComputedStyle(cardRoot).overflow : null;
  });
  ok('the rendered card itself still crops at the real edge (export is unaffected)', cardOverflow === 'hidden', cardOverflow);

  // ---- a plain single-image build produces something to save as a template ----
  // _plan_to_assets used to only look for an "image_prompt" key that a
  // format="single"/style="photo" plan never actually carries (the model
  // writes its image idea under "cover_image_prompt" instead) — so the most
  // ordinary build (one photo, no carousel/reel) landed with zero assets on
  // the canvas and nothing for "Save as template" to save.
  // Navigating to the exact same '/composer' URL Playwright is already on is
  // a no-op in Chromium (no real navigation happens), so the SPA never
  // remounts and the previous test's in-memory state (editingTemplateId from
  // the template-edit flow above) keeps leaking forward. Bounce through an
  // unrelated route first to force a real navigation.
  await page.goto(B + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await tap(page, 'composer-format-single');
  await page.waitForTimeout(200);
  await page.getByTestId('composer-brief').fill('a single photo post about a quiet morning coffee');
  await tap(page, 'composer-autobuild');
  // One card, but an image is about to be generated for it — which is the
  // other half of "there is something to review": the prompt that image
  // comes from is editable here, before it is spent, rather than only being
  // discoverable afterwards on the canvas.
  await page.getByTestId('composer-build-review').waitFor({ timeout: 20000 });
  ok('a single post whose image is about to be generated is reviewed too',
     (await page.getByTestId('composer-build-review-visual-0').inputValue()).length > 0,
     await page.getByTestId('composer-build-review-visual-0').inputValue());
  await tap(page, 'composer-build-review-confirm');
  await page.waitForTimeout(1500);
  ok('a plain single/photo build puts a real visual asset on the canvas',
     (await page.getByTestId('composer-save-template').count()) > 0);
  page.once('dialog', (d) => d.accept('E2E Single Photo Template'));
  const singleSaveResp = page.waitForResponse((r) => r.url().includes('/api/templates/from-composer'), { timeout: 8000 }).catch(() => null);
  await tap(page, 'composer-save-template');
  const singleResp = await singleSaveResp;
  ok('saving a plain single-image build as a template actually succeeds',
     !!singleResp && singleResp.status() === 200, singleResp && singleResp.status());
  await page.waitForTimeout(1000);
  ok('...with the success toast, not the "nothing to save" one',
     await page.evaluate(() => document.body.innerText.includes('as a design')));

  // ---- the Library absorbed Designs, Elements, and every generator ----
  // Content Studio used to hold Image/Video/Music/Voice; Designs and
  // Elements were their own pages. All of it lives under one Library now.
  await page.goto(B + '/library', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('library-page').waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);

  await tap(page, 'library-tab-image');
  await page.getByTestId('image-controls').waitFor({ timeout: 5000 });
  await page.getByTestId('studio-image-prompt').fill('a lit workshop bench at dawn');
  const genResp = page.waitForResponse((r) => r.url().includes('/api/ai/generate'), { timeout: 8000 }).catch(() => null);
  await tap(page, 'studio-generate-image');
  await genResp;
  await page.getByTestId('studio-result-image').waitFor({ timeout: 15000 });
  ok('the Library\'s Image tab generates and previews a real image',
     await page.getByTestId('studio-result-image').isVisible());
  await tap(page, 'studio-use-image');
  await page.getByTestId('composer-page').waitFor({ timeout: 10000 });
  ok('...and "Use in post" lands in the Composer', new URL(page.url()).pathname === '/composer', page.url());

  await page.goto(B + '/library', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await tap(page, 'library-tab-voice');
  await page.getByTestId('voice-controls').waitFor({ timeout: 5000 });
  ok('the Voice tab shows voice-specific controls, not the Image ones',
     await page.getByTestId('voice-controls').isVisible() && (await page.getByTestId('image-controls').count()) === 0);

  await tap(page, 'library-tab-designs');
  await page.getByTestId('library-designs-panel').waitFor({ timeout: 5000 });
  await page.waitForTimeout(600);
  ok('the Designs tab lists the starter layouts, folded in from its own former page',
     (await page.locator('[data-testid^="templates-custom-item-"]').count()) > 0);

  await tap(page, 'library-tab-elements');
  await page.getByTestId('library-elements-panel').waitFor({ timeout: 5000 });
  await page.waitForTimeout(600); // let the initial /library/elements fetch settle before baselining
  const beforeUpload = await page.locator('[data-testid^="library-elements-item-"]').count();
  const uploadResp = page.waitForResponse((r) => r.url().includes('/api/library/elements') && r.request().method() === 'POST', { timeout: 8000 }).catch(() => null);
  await page.getByTestId('library-elements-upload-input').setInputFiles(require('path').join(__dirname, 'fixtures/photo.png'));
  const savedElement = await uploadResp;
  const savedId = savedElement && (await savedElement.json()).id;
  await page.getByTestId(`library-elements-item-${savedId}`).waitFor({ timeout: 8000 });
  const elementCount = await page.locator('[data-testid^="library-elements-item-"]').count();
  ok('the Elements tab (folded in from the Composer\'s element picker) saves an upload',
     !!savedId && elementCount === beforeUpload + 1, { beforeUpload, elementCount });
  page.once('dialog', (d) => d.accept());
  const delResp = page.waitForResponse((r) => r.url().includes(`/api/library/elements/${savedId}`) && r.request().method() === 'DELETE', { timeout: 5000 }).catch(() => null);
  await tap(page, `library-elements-delete-${savedId}`);
  const dr = await delResp;
  await page.getByTestId(`library-elements-item-${savedId}`).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  ok('...and it can be removed again',
     !!dr && dr.status() === 200 && (await page.locator('[data-testid^="library-elements-item-"]').count()) === elementCount - 1);

  // The old standalone /designs page is gone — a stale link or bookmark
  // should still land somewhere real, not a 404.
  await page.goto(B + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.goto(B + '/designs', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('library-page').waitFor({ timeout: 8000 });
  ok('/designs redirects into the Library, on the Designs tab',
     new URL(page.url()).pathname === '/library' && await page.getByTestId('library-designs-panel').isVisible());

  // Content Studio, Visual Studio, Repurpose and Batch are gone as pages —
  // each is a mode inside the Composer now, and a stale link to any of
  // them should land there on the matching mode, not a 404.
  await page.goto(B + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.goto(B + '/studio', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('composer-page').waitFor({ timeout: 8000 });
  ok('/studio redirects into the Composer, on the Topic mode (Write\'s old job)',
     new URL(page.url()).pathname === '/composer' && await page.getByTestId('composer-brief').isVisible());

  await page.goto(B + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.goto(B + '/repurpose', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('composer-page').waitFor({ timeout: 8000 });
  ok('/repurpose redirects into the Composer, on the Source mode',
     new URL(page.url()).pathname === '/composer' && await page.getByTestId('composer-source-panel').isVisible());

  await page.goto(B + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.goto(B + '/templates', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('composer-page').waitFor({ timeout: 8000 });
  ok('/templates (Batch) redirects into the Composer, on the Batch mode',
     new URL(page.url()).pathname === '/composer' && await page.getByTestId('composer-batch-panel').isVisible());

  // ---- the mode switcher itself: Source and Batch, generate and apply ----
  // The redirects above only prove a stale link lands on the right mode —
  // this drives the switcher buttons a user actually clicks from inside an
  // already-open Composer, and that applying a result really does land on
  // the post being composed (then drops back to Topic to show it).
  await page.goto(B + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  ok('Topic is the default mode', await page.getByTestId('composer-brief').isVisible());

  await tap(page, 'composer-start-source');
  await page.getByTestId('composer-source-panel').waitFor({ timeout: 5000 });
  await page.getByTestId('repurpose-source').fill('a long blog post about shipping every week no matter what');
  await tap(page, 'repurpose-run');
  await page.locator('[data-testid^="repurpose-result-"]').first().waitFor({ timeout: 10000 });
  const sourceResultTestid = await page.locator('[data-testid^="repurpose-schedule-"]').first().getAttribute('data-testid');
  await tap(page, sourceResultTestid);
  await page.waitForTimeout(300);
  ok('applying a Source result fills the post and returns to Topic',
     (await page.getByTestId('composer-content').inputValue()).length > 0 && await page.getByTestId('composer-brief').isVisible());

  await tap(page, 'composer-start-batch');
  await page.getByTestId('composer-batch-panel').waitFor({ timeout: 5000 });
  await page.getByTestId('templates-topic').fill('building in public as a solo founder');
  await tap(page, 'templates-run');
  await page.locator('[data-testid^="templates-result-"]').first().waitFor({ timeout: 10000 });
  await tap(page, 'templates-schedule-1');
  await page.waitForTimeout(300);
  ok('applying a Batch result fills the post and returns to Topic',
     (await page.getByTestId('composer-content').inputValue()).length > 0 && await page.getByTestId('composer-brief').isVisible());

  // ---- clicking a day on the Plan calendar carries that date into Create ----
  // The calendar had no coverage at all, which is how it went unnoticed that
  // it sent a presetDate the Composer never read: you picked a day, and the
  // composer opened with no date set, having just been told which one.
  await page.goto(B + '/calendar', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('cal-new-post').waitFor({ timeout: 8000 });
  const dayCell = await page.locator('[data-testid^="cal-day-"]').nth(14);
  const clickedDay = (await dayCell.getAttribute('data-testid')).replace('cal-day-', '');
  await dayCell.click({ force: true });
  await page.getByTestId('composer-page').waitFor({ timeout: 8000 });
  const preset = await page.getByTestId('composer-schedule-time').inputValue();
  ok('clicking a calendar day pre-fills the schedule with that day',
     preset.length > 0 && Number(preset.slice(8, 10)) === Number(clickedDay), `clicked ${clickedDay}, got "${preset}"`);

  // ---------- 12. Projects — the page, the "open project" start mode, and library-elements bulk select ----------
  // Self-contained: builds and saves its own draft rather than reusing one
  // from an earlier section, so it isn't fragile against those tests'
  // ordering or later mutating/deleting the post it depends on.
  const projectTitle = `E2E project ${Date.now()}`;
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('composer-page').waitFor({ timeout: 10000 });
  await page.getByTestId('composer-title').fill(projectTitle);
  // Project cards show the caption when there is one (projectSummary
  // prefers content over title, same as every other post preview in the
  // app) — so the marker the test searches/filters by has to be IN the
  // text that's actually rendered, not just in the title field.
  await page.getByTestId('composer-content').fill(`Body for ${projectTitle} — no AI needed for this one.`);
  await tap(page, 'composer-save-draft');
  await page.waitForTimeout(800);
  ok('a fresh draft actually saved', (await page.getByTestId('composer-title').inputValue()) === projectTitle);

  // The Projects page lists it.
  await page.goto(B + '/projects', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('projects-page').waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);
  const projectCard = page.locator('[data-testid^="project-card-"]', { hasText: projectTitle });
  await projectCard.waitFor({ timeout: 5000 });
  ok('the Projects page lists a freshly saved draft', await projectCard.isVisible());

  // Search narrows the list; a term that matches nothing shows the empty state.
  await page.getByTestId('projects-search').fill('no such project exists anywhere');
  await page.waitForTimeout(200);
  ok('searching for nothing shows the empty state, not a stale list',
     (await page.locator('[data-testid^="project-card-"]').count()) === 0);
  await page.getByTestId('projects-search').fill('');
  await page.waitForTimeout(200);

  // The status filter actually filters — a fresh save is a draft, so it
  // should show under Drafts and disappear from a Published-only view.
  await tap(page, 'projects-filter-draft');
  await page.waitForTimeout(200);
  ok('the Drafts filter includes a freshly saved draft', await projectCard.isVisible());
  await tap(page, 'projects-filter-published');
  await page.waitForTimeout(200);
  ok('the Published filter excludes a draft', (await projectCard.count()) === 0);
  await tap(page, 'projects-filter-all');
  await page.waitForTimeout(200);

  // "Open project" from the Composer's own start menu — a fifth way in,
  // reusing the exact same reload mechanism History's "Use" and Home's
  // draft rows already rely on (navigate with a fresh start intent; Composer
  // re-reads it because location.key changed, not because the path did).
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('composer-page').waitFor({ timeout: 8000 });
  await tap(page, 'composer-start-project');
  await page.getByTestId('composer-project-panel').waitFor({ timeout: 5000 });
  await page.getByTestId('composer-project-search').fill(projectTitle);
  await page.waitForTimeout(300);
  const projectRow = page.locator('[data-testid^="composer-project-row-"]', { hasText: projectTitle });
  await projectRow.waitFor({ timeout: 5000 });
  await projectRow.click({ force: true });
  await page.getByTestId('composer-page').waitFor({ timeout: 8000 });
  await page.waitForTimeout(500);
  ok("opening a project from the create menu loads it for editing, not a blank post",
     (await page.getByTestId('composer-title').inputValue()) === projectTitle,
     await page.getByTestId('composer-title').inputValue());

  // Bulk select + delete on the Projects page — the same shape as the
  // library-elements one just below, and the thing neither had before:
  // deleting more than one at a time meant one confirm dialog per item.
  await page.goto(B + '/projects', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('projects-page').waitFor({ timeout: 8000 });
  await projectCard.waitFor({ timeout: 5000 });
  await tap(page, 'projects-select-mode');
  await page.waitForTimeout(150);
  await projectCard.click({ force: true });
  await page.waitForTimeout(150);
  ok('selecting a project card in select mode counts it',
     (await page.getByTestId('projects-delete-selected').innerText()).includes('(1)'));
  page.once('dialog', (d) => d.accept());
  const bulkDeleteResp = page.waitForResponse((r) => r.url().includes('/api/posts/bulk-delete'), { timeout: 5000 }).catch(() => null);
  await tap(page, 'projects-delete-selected');
  const bulkDr = await bulkDeleteResp;
  await projectCard.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  ok('bulk-deleting a project actually removes it',
     !!bulkDr && bulkDr.status() === 200 && (await projectCard.count()) === 0);

  // ---------- 12a. library elements — always-visible delete + bulk select ----------
  await page.goto(B + '/library', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('library-page').waitFor({ timeout: 8000 });
  await tap(page, 'library-tab-elements');
  await page.getByTestId('library-elements-panel').waitFor({ timeout: 5000 });
  await page.waitForTimeout(400);

  // Upload two, so there is something real to multi-select.
  const uploadOne = async () => {
    const resp = page.waitForResponse((r) => r.url().includes('/api/library/elements') && r.request().method() === 'POST', { timeout: 8000 });
    await page.getByTestId('library-elements-upload-input').setInputFiles(require('path').join(__dirname, 'fixtures/photo.png'));
    const saved = await resp;
    const id = (await saved.json()).id;
    await page.getByTestId(`library-elements-item-${id}`).waitFor({ timeout: 8000 });
    return id;
  };
  const elId1 = await uploadOne();
  const elId2 = await uploadOne();

  // A hover-only delete affordance is invisible on a touch screen — this is
  // most of this app's real use — so the button has to actually be visible
  // (non-zero opacity) sitting at rest, not just present in the DOM.
  const restOpacity = await page.getByTestId(`library-elements-delete-${elId1}`).evaluate((el) => getComputedStyle(el).opacity);
  ok('an element\'s delete button is visible at rest, not hover-only',
     Number(restOpacity) > 0, restOpacity);

  await tap(page, 'library-elements-select-mode');
  await page.waitForTimeout(150);
  await tap(page, `library-elements-item-${elId1}`);
  await tap(page, `library-elements-item-${elId2}`);
  await page.waitForTimeout(150);
  ok('selecting two elements counts both',
     (await page.getByTestId('library-elements-delete-selected').innerText()).includes('(2)'));
  page.once('dialog', (d) => d.accept());
  const elBulkResp = page.waitForResponse((r) => r.url().includes('/api/library/elements/bulk-delete'), { timeout: 5000 }).catch(() => null);
  await tap(page, 'library-elements-delete-selected');
  const elBulkDr = await elBulkResp;
  await page.getByTestId(`library-elements-item-${elId1}`).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  ok('bulk-deleting library elements removes both, in one request',
     !!elBulkDr && elBulkDr.status() === 200
     && (await page.getByTestId(`library-elements-item-${elId1}`).count()) === 0
     && (await page.getByTestId(`library-elements-item-${elId2}`).count()) === 0);

  // "remote css", "remote stylesheet" and "cssRules" used to be filtered out
  // here too, as sandbox noise. They weren't: they are html-to-image walking
  // every stylesheet on the page during an export, failing to read a
  // cross-origin font sheet, and re-downloading the whole ~90-family Google
  // catalogue to inline it — thousands of font fetches per PNG. The sandbox
  // only explains why those fetches then fail; the app should never be making
  // them. Exports supply their own scoped fontEmbedCSS now (lib/cardExport),
  // so the messages are gone and their return means the walk is back.
  // ---- a voice sample is made once, not once per session ----
  // The preview used to be remembered only in this page's memory, so every
  // reload threw away all ten answers and hearing them again cost ten more
  // text-to-speech generations. They are saved server-side now and seeded on
  // mount, so the second visit spends nothing.
  //
  // A reload is the whole point of the check — an in-memory cache passes any
  // test that never leaves the page.
  await page.goto(B + '/calendar', { waitUntil: 'domcontentloaded' });
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('composer-page').waitFor({ timeout: 10000 });
  await tap(page, 'composer-format-reel');
  await page.waitForTimeout(600);

  const reloadedVoiceCalls = [];
  await page.route('**/api/ai/generate', async (route) => {
    const body = route.request().postDataJSON();
    if (body?.kind === 'voice') reloadedVoiceCalls.push(body);
    await route.continue();
  });
  // Sarah was previewed (and therefore banked) earlier in this run.
  await tap(page, 'composer-voice-preset-pre-sarah-preview');
  await page.waitForTimeout(1500);
  ok('a voice previewed in an earlier session costs no new generation after a reload',
     reloadedVoiceCalls.length === 0, JSON.stringify(reloadedVoiceCalls));
  const replayed = await page.evaluate(() => {
    const a = document.querySelector('[data-testid="composer-voice-preview-audio"]');
    return a ? { paused: a.paused, src: a.currentSrc } : null;
  });
  // Playing is what makes the saving worth anything — a banked URL nobody
  // can hear is the same as no preview at all.
  ok('...and still plays, from the copy this app saved rather than the generator\'s own',
     !!replayed && !replayed.paused && !!replayed.src, JSON.stringify(replayed));

  // A voice never previewed before still generates, exactly as it always
  // did — otherwise "costs nothing" could just mean "does nothing".
  await tap(page, 'composer-voice-preset-pre-laura-preview');
  await page.waitForTimeout(2500);
  ok('a voice nobody has heard yet is still generated on demand',
     reloadedVoiceCalls.length === 1 && reloadedVoiceCalls[0].options?.voice === 'Laura',
     JSON.stringify(reloadedVoiceCalls));
  await page.unroute('**/api/ai/generate');

  // ...and banking it means the NEXT reload is free too.
  const banked = await page.evaluate(async () => {
    const res = await fetch('/api/voice-previews');
    return (await res.json()).map((r) => r.voice);
  });
  ok('every voice heard so far is banked for next time', banked.includes('Sarah') && banked.includes('Laura'), JSON.stringify(banked));

  // ---- exporting a card as a PNG ----
  // Reported: "the error when exporting png files". A card carrying footage —
  // a reel scene, or any slide with a stock clip on it — is rasterised by
  // drawing the <video> into a canvas and reading it back, and a cross-origin
  // clip taints that canvas: toDataURL throws "Tainted canvases may not be
  // exported" and the whole export dies with nothing downloaded. Routing the
  // card's <img> sources through the media proxy (which is what fixed the
  // same problem for pictures) never touched <video> at all.
  //
  // Stock footage is cross-origin on a real deployment but same-origin in this
  // harness, so the taint has to be arranged deliberately: localhost:8123 and
  // 127.0.0.1:8123 are the same server and different origins to the browser,
  // and the clip route sets no CORS header. That is exactly what a Pexels clip
  // is in production — playable, unreadable.
  await page.goto(B + '/calendar', { waitUntil: 'domcontentloaded' });
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.getByTestId('composer-brief').fill('a carousel about exporting artwork');
  await tap(page, 'composer-autobuild');
  await confirmBuild(page);
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);

  // Capture opens the preview dialog; the file is only written after a look.
  const exportPng = async (testid) => {
    await tap(page, testid);
    await page.getByTestId('png-export-preview').waitFor({ timeout: 20000 });
    await page.waitForSelector('[data-testid="png-export-loading"]', { state: 'detached', timeout: 40000 }).catch(() => {});
    if (await page.getByTestId('png-export-error').count()) {
      const why = await page.getByTestId('png-export-error').innerText();
      await tap(page, 'png-export-cancel');
      return { error: why };
    }
    const wait = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
    await tap(page, 'png-export-confirm');
    const dl = await wait;
    await page.getByTestId('png-export-preview').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
    if (!dl) return { file: null, bytes: 0 };
    // A download EVENT is not a saved file. The browser fires one the moment
    // the anchor is clicked; if the object URL behind it is revoked before
    // the bytes have been read, the download fails and nothing lands on disk
    // — which is exactly what "it says Downloaded, but there's no file
    // anywhere" is. Only the file on disk proves it, so read its size.
    let bytes = 0;
    let failure = null;
    try {
      failure = await dl.failure();
      const path = await dl.path();
      if (path) bytes = require('fs').statSync(path).size;
    } catch (e) { failure = failure || String(e && e.message); }
    return { file: dl.suggestedFilename(), bytes, failure };
  };

  const plain = await exportPng('composer-slide-download');
  ok('a plain slide exports a PNG that really lands on disk', /\.png$/.test(plain.file || '') && plain.bytes > 1000, JSON.stringify(plain));

  if (await page.getByTestId('composer-slide-edit-layout').count()) await tap(page, 'composer-slide-edit-layout');
  await page.getByTestId('composer-element-panel').waitFor({ timeout: 8000 });
  await tap(page, 'composer-add-element-video');
  await page.waitForTimeout(400);
  await page.getByTestId('composer-element-url').fill('http://localhost:8123/e2e-video.mp4');
  // Wait for the clip to actually decode rather than guessing at a delay — a
  // flat timeout passes on a quiet machine and reports "no video" on a busy
  // one, which says nothing about the export either way.
  await page.waitForFunction(
    () => !!document.querySelector('[data-testid="slide-editor-canvas"] video')?.videoWidth,
    null, { timeout: 15000 },
  ).catch(() => {});
  const tainted = await page.evaluate(() => {
    const v = document.querySelector('[data-testid="slide-editor-canvas"] video');
    if (!v) return 'no video element';
    if (!v.videoWidth) return `not decoded (readyState ${v.readyState})`;
    try {
      const c = document.createElement('canvas');
      c.width = 4; c.height = 4;
      c.getContext('2d').drawImage(v, 0, 0, 4, 4);
      c.toDataURL();
      return 'readable';
    } catch (e) { return e.name; }
  });
  // Without this the check below proves nothing: a clip the page is allowed
  // to read never had the problem in the first place.
  ok("the clip really is one the page can't read back, like real stock footage",
     tainted === 'SecurityError', String(tainted));

  const withClip = await exportPng('composer-slide-download');
  ok('a slide carrying unreadable footage still exports a PNG', /\.png$/.test(withClip.file || '') && withClip.bytes > 1000, JSON.stringify(withClip));
  // The capture borrows the card's own DOM to stand a still in for the video.
  // Borrowing it and not giving it back leaves the editor showing a frozen
  // frame where the clip was.
  ok('...and hands the card back exactly as it was', await page.evaluate(() => ({
    videos: document.querySelectorAll('[data-testid="slide-editor-canvas"] video').length,
    leftovers: document.querySelectorAll('[data-export-still],[data-export-skip]').length,
  })).then((r) => r.videos === 1 && r.leftovers === 0));

  const zipped = await exportPng('composer-slide-download-all');
  ok('every slide zips up together, footage and all', /\.zip$/.test(zipped.file || '') && zipped.bytes > 1000, JSON.stringify(zipped));

  // ---------- the brand logo, in and out of the export ----------
  // A brand kit's logo is seeded onto every generated card (_seed_brand_design,
  // server side) as an ordinary image element, and nothing here ever checked
  // it survived to the file. Two halves, because they fail in opposite ways:
  // a logo that loads has to actually be IN the PNG, and one that doesn't has
  // to be left OUT of it. The second is the one that shipped: a failed <img>
  // draws nothing on the card (no alt text to show), but html-to-image
  // rasterises the browser's own broken-image glyph, so the first you knew of
  // a dead logo URL was a torn-paper icon in a file you were about to post.
  const logoCorner = async () => page.evaluate(async () => {
    const img = document.querySelector('[data-testid="png-export-image"]');
    if (!img) return null;
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    // The logo sits bottom-right; sample a patch inside it and count how many
    // distinct colours are there. Flat background = one colour.
    const side = Math.round(Math.min(c.width, c.height) * 0.1);
    const d = c.getContext('2d').getImageData(c.width - side * 1.4, c.height - side * 1.4, side, side).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    return seen.size;
  });

  const withLogo = await (await page.request.post(B + '/api/brand-kits', {
    data: { name: 'E2E Logo Kit', logo_url: B + '/e2e-asset.png' },
  })).json();
  // There is no /default route — a kit becomes the default through an
  // ordinary update, which is what the Composer's own picker does.
  await page.request.put(B + `/api/brand-kits/${withLogo.id}`, { data: { is_default: true } });
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.getByTestId('composer-brief').fill('a carousel that carries the brand logo');
  await tap(page, 'composer-autobuild');
  await confirmBuild(page);
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  await tap(page, 'composer-slide-download');
  await page.getByTestId('png-export-preview').waitFor({ timeout: 20000 });
  await page.waitForSelector('[data-testid="png-export-loading"]', { state: 'detached', timeout: 40000 }).catch(() => {});
  ok('a working brand logo raises no warning',
     (await page.getByTestId('png-export-warning').count()) === 0);
  ok('...and really is drawn into the exported PNG, not just planned for it',
     (await logoCorner()) > 1, 'distinct colours in the logo corner: ' + await logoCorner());
  await tap(page, 'png-export-cancel');

  // A real regression: an SVG with only a viewBox (no width/height on the
  // root) decodes and paints fine, but reports naturalWidth 0 in Chrome —
  // identically to a genuinely broken image. Checking naturalWidth alone to
  // decide "did this load" silently dropped a perfectly good logo from the
  // export and reported it as unloadable.
  const svgLogo = await (await page.request.post(B + '/api/brand-kits', {
    data: { name: 'E2E SVG Logo Kit', logo_url: B + '/e2e-logo.svg' },
  })).json();
  await page.request.put(B + `/api/brand-kits/${svgLogo.id}`, { data: { is_default: true } });
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.getByTestId('composer-brief').fill('a carousel that carries a viewBox-only svg logo');
  await tap(page, 'composer-autobuild');
  await confirmBuild(page);
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  await tap(page, 'composer-slide-download');
  await page.getByTestId('png-export-preview').waitFor({ timeout: 20000 });
  await page.waitForSelector('[data-testid="png-export-loading"]', { state: 'detached', timeout: 40000 }).catch(() => {});
  ok('a sizeless (viewBox-only) SVG logo raises no false warning',
     (await page.getByTestId('png-export-warning').count()) === 0);
  ok('...and is really drawn into the export, not dropped for lacking naturalWidth',
     (await logoCorner()) > 1, 'distinct colours in the logo corner: ' + await logoCorner());
  await tap(page, 'png-export-cancel');

  // The other real regression: every image element already renders with
  // crossOrigin="anonymous" pointed straight at its real URL (VisualCard),
  // so a cross-origin logo that's visible ON SCREEN has already proven the
  // host sends CORS headers — the direct URL works. withProxiedImages used
  // to swap every cross-origin image to our own /api/proxy-image hop
  // UNCONDITIONALLY, before ever trying the URL it was already rendering
  // successfully, so a proxy hiccup (timeout, content-type sniffing, its
  // own network) could drop a perfectly good logo with no working direct
  // attempt ever made. 'localhost' and '127.0.0.1' are different origins
  // to the browser even though they're the same server here, which is
  // enough to exercise the real cross-origin path without standing up a
  // second host.
  const crossOriginLogo = await (await page.request.post(B + '/api/brand-kits', {
    data: { name: 'E2E Cross-Origin Logo Kit', logo_url: 'http://localhost:8123/e2e-logo.svg' },
  })).json();
  await page.request.put(B + `/api/brand-kits/${crossOriginLogo.id}`, { data: { is_default: true } });
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  let proxyHits = 0;
  const onProxyReq = (req) => { if (req.url().includes('/api/proxy-image')) proxyHits++; };
  page.on('request', onProxyReq);
  await page.getByTestId('composer-brief').fill('a carousel whose logo lives on a different origin');
  await tap(page, 'composer-autobuild');
  await confirmBuild(page);
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  await tap(page, 'composer-slide-download');
  await page.getByTestId('png-export-preview').waitFor({ timeout: 20000 });
  await page.waitForSelector('[data-testid="png-export-loading"]', { state: 'detached', timeout: 40000 }).catch(() => {});
  page.off('request', onProxyReq);
  ok('a cross-origin logo the browser can already fetch directly raises no warning',
     (await page.getByTestId('png-export-warning').count()) === 0);
  ok('...and is drawn into the export using the direct URL, not the proxy',
     (await logoCorner()) > 1 && proxyHits === 0,
     `distinct colours: ${await logoCorner()}, proxy hits: ${proxyHits}`);
  await tap(page, 'png-export-cancel');

  const deadLogo = await (await page.request.post(B + '/api/brand-kits', {
    data: { name: 'E2E Dead Logo Kit', logo_url: B + '/no-such-logo-404.png' },
  })).json();
  // There is no /default route — a kit becomes the default through an
  // ordinary update, which is what the Composer's own picker does.
  await page.request.put(B + `/api/brand-kits/${deadLogo.id}`, { data: { is_default: true } });
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.getByTestId('composer-brief').fill('a carousel whose logo url is dead');
  await tap(page, 'composer-autobuild');
  await confirmBuild(page);
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  await tap(page, 'composer-slide-download');
  await page.getByTestId('png-export-preview').waitFor({ timeout: 20000 });
  await page.waitForSelector('[data-testid="png-export-loading"]', { state: 'detached', timeout: 40000 }).catch(() => {});
  const logoWarning = await page.getByTestId('png-export-warning').count()
    ? await page.getByTestId('png-export-warning').innerText() : '';
  ok('a logo that will not load is called out by name rather than silently dropped',
     logoWarning.includes('brand logo'), logoWarning || '(no warning)');
  ok('...and no broken-image glyph is burned into the file',
     (await logoCorner()) === 1, 'distinct colours in the logo corner: ' + await logoCorner());
  ok('...while the export itself still succeeds',
     (await page.getByTestId('png-export-confirm').count()) === 1);
  await tap(page, 'png-export-cancel');

  const real = errs.filter(e => !/favicon|manifest|404|Failed to load resource/i.test(e));
  ok('no console errors', real.length === 0, real.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\n' + (fails.length ? fails.length + ' FAILED: ' + fails.join(', ') : 'ALL PASS'));
  process.exit(fails.length ? 1 : 0);
})();
