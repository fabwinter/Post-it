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

Typography sizes describe the sheet at its 850px reference width. These rules and logo placement are guideline documentation, not new overrides for generated post templates. The sheet header keeps its own document layout; the preferred logo position describes branded-content usage.

## Verification

- `cd frontend && CI=true npm test -- --watchAll=false --runInBand`: three tests covering legacy defaults, overrides and invalid values.
- `cd frontend && npm run build`: production build succeeds.
- `cd e2e && bash run.sh brand-guideline.js`: focused browser regression covering live updates, family inheritance, both palettes, naming and placement, API persistence, reload, empty/out-of-range input, 375px mobile width, and PNG download.
- Desktop, mobile and guideline screenshots visually inspected.

The preview uses the existing isolated E2E backend with a local test database and simulated external services. No production data or credentials are required.
