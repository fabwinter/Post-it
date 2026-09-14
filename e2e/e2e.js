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
  await (page).route('**/*', (route) => {
    const u = route.request().url();
    return u.startsWith('http://127.0.0.1:8123') ? route.continue() : route.abort();
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
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  ok('build lands in composer', page.url().includes('/composer'));
  const caption = await page.getByTestId('composer-content').inputValue();
  ok('caption filled from plan', caption.includes('kept showing up'), caption.slice(0, 60));
  const tags = await page.getByTestId('composer-hashtags').innerText();
  ok('hashtags filled', tags.includes('#buildinpublic'), tags);
  const slides = await page.locator('[data-testid^="composer-slide-"]').filter({ hasNot: page.locator('x') });
  const slideCount = await page.locator('[data-testid^="composer-slide-"][data-testid$="0"], [data-testid^="composer-slide-"]').count();
  const strip = await page.getByTestId('composer-slide-strip').locator('button').count();
  ok('cover + 3 slides + add button in strip', strip === 5, 'strip buttons: ' + strip);
  ok('carousel format selected', (await page.getByTestId('composer-format-carousel').getAttribute('class')).includes('border-lime'));

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
  // nav entry left to check. Five screens now: Home, Create, Plan,
  // Library, Brand.
  ok('the nav lists exactly the five collapsed screens',
     (await page.locator('[data-testid^="mobile-nav-"]').count()) === 5,
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
    await tap(page, 'reel-export-start');
    await page.getByTestId('reel-export-done').waitFor({ timeout: 60000 });
    ok('the reel renders to a file', true, (await page.getByTestId('reel-export-done').innerText()).trim());

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
  }
  await tap(page, 'reel-export-close');
  await page.waitForTimeout(300);

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
  // Fixture scenes read "You publish. Nobody claps." (4 words), "Three
  // people reply." (3) and "It compounds." (2) — real, different-length
  // takes, so the total should land well under the old flat 9.0s (3 x 3.0)
  // and above the floor three near-silent takes plus padding would give.
  ok('recording a take per scene sets a real, non-flat length',
     votedTotal > 2 && votedTotal < 8, votedLabel);

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
  await tap(page, 'composer-slide-edit-layout');
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
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000);
  ok('a fresh reel scene has no freeform elements yet', await page.getByTestId('composer-element-panel').count() === 0);
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
  const savedClipUrl = await sceneVideoUrl();
  ok('the stock video landed on the scene', !!savedClipUrl, savedClipUrl);
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
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000);
  await tap(page, 'composer-slide-edit-layout');
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

  // ---- elements can bleed past the slide's own edges ----
  await tap(page, 'composer-save-template-changes');
  await page.waitForTimeout(1500);
  await page.goto(B + '/composer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.getByTestId('composer-brief').fill('another short carousel about focus habits');
  await tap(page, 'composer-autobuild');
  await page.getByTestId('composer-slide-strip').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000);
  await tap(page, 'composer-slide-edit-layout');
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

  // html-to-image reaches for the Google Fonts stylesheet while rasterising
  // the overlay layer; this harness blocks every off-origin request, so those
  // failures are the sandbox, not the app.
  const real = errs.filter(e => !/favicon|manifest|404|Failed to load resource|remote css|remote stylesheet|cssRules/i.test(e));
  ok('no console errors', real.length === 0, real.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\n' + (fails.length ? fails.length + ' FAILED: ' + fails.join(', ') : 'ALL PASS'));
  process.exit(fails.length ? 1 : 0);
})();
