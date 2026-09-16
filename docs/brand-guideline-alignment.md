# Brand Kit and guideline alignment

The Brand Kit editor and printable Brand Guidelines sheet share palette and typography definitions in `frontend/src/lib/brandGuideline.js`.

## Field mapping

- Naming conventions: approved spelling, capitalisation and product naming, shown below the sheet header.
- Colours: Background (`bg`), Text (`fg`), Accent (`accent`) and Muted (`sub`), with both dark and light palettes and colour-usage notes.
- Typography: H1, H2, H3, body and caption each have a font family, size in CSS pixels, weight, line-height ratio and usage text.
- Logo: preferred position and placement notes supplement the existing lockups, clear space, minimum size and do/don't rules.
- Visual style: the existing field now appears under Imagery & Icons.

## Compatibility and scope

New fields are stored under the existing `guideline` JSON object. No database migration is needed. Existing colour keys and display/body font fields are unchanged.

Missing typography rules use the previous sheet hierarchy. Font families inherit the kit's display/body defaults unless overridden per role; “Use default … family” removes the override. Numeric sizes accept 6–96px and line heights accept ratios of 1–3, with bounded input and safe render fallbacks.

Typography sizes describe the sheet at its 850px reference width. Reels and shorts now use the same rules, proportionally scaled by canvas width in thumbnails, the editor, playback and video export. Headlines use H1, body text uses Body, and small labels use Caption. Custom text can select a Brand typography role; local font sizes no longer override the selected kit on reel scenes. Non-reel templates retain their existing typography.

Each scene has a managed uploaded-logo layer. The colour lockup is preferred, followed by the primary uploaded logo and monochrome variants. Placement defaults to bottom right; `logo_width` (24–300, default 120) and `logo_inset` (0–150, default 24) use the same 850px reference. The image fits inside a square box without stretching. Matching custom logo elements are replaced by this managed layer to avoid duplicates. No uploaded logo means no invented logo; the editor warns. Export waits for fonts and logo fallbacks and reports a failed logo rather than silently producing unbranded video. Free-text usage/clear-space notes remain descriptive, not executable layout instructions.

The sheet header keeps its own document layout. Existing videos are not rewritten: reopen and render the reel again to apply updated rules.

## Verification

- `cd frontend && CI=true npm test -- --watchAll=false --runInBand`: helper tests covering defaults, overrides, invalid values, scene roles, proportional sizes, logo placement and fallbacks.
- `cd frontend && npm run build`: production build succeeds.
- `cd e2e && bash run.sh brand-guideline.js`: focused browser regression covering live updates, family inheritance, both palettes, naming and placement, API persistence, reload, empty/out-of-range input, 375px mobile width, and PNG download.
- `cd e2e && node reel-brand-guidelines.js` (against `serve.py`): standard and custom scenes, scaled typography, custom role selection, no duplicate logo, bottom-right dimensions, mobile fit, actual 480px video decoding with logo pixels in both scenes, logo fallback, and explicit export failure for broken uploads.
- Desktop, mobile and guideline screenshots visually inspected.

The preview uses the existing isolated E2E backend with a local test database and simulated external services. No production data or credentials are required.
