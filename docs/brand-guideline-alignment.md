# Brand Guidelines: editable creation defaults

## Precedence

1. A selected template determines the generated design. Brand Guidelines never supersede it, even when the template has no custom element layout.
2. With no selected template, generation copies available Brand Kit typography, colours and logo into ordinary editable elements.
3. After creation, the stored elements are the source of truth. Canvas edits always win. Loading, playback and export never reapply guidelines.

The earlier render-time enforcement was reverted. Font family, weight, size, line spacing, colours and logo position are editable again. The logo is a normal image element, not a locked overlay; users can move, resize, replace or delete it.

## Scale

Generated element sizes use the existing 440px canvas coordinate system. A saved guideline size is copied directly into `fontSize`, without the previous 440/850 reduction. Actual preview/export size scales uniformly with canvas width, as it does for every other editable element.

If a guideline size has not been configured, use the readable canvas defaults: 40px cover, 30px scene heading and 18px body. The 850px guideline sheet is a document layout, not a video coordinate system. Its sample hierarchy still has document defaults; configured values seed creation.

## Storage and compatibility

No database migration is required. Generation materializes `spec.elements` and `spec.bg_color` once, with descriptive `design_source` metadata. Existing posts and templates are not rewritten. The reverted implementation did not persist its forced sizes, so reopening existing content restores its stored element sizes.

Colours, naming, typography and usage notes remain in the Brand Guidelines sheet. Free-text placement/clear-space notes are documentation, not executable constraints. The preferred logo position supplies a starting position only.

## Verification

- `python e2e/brand-starting-points.py`: direct canvas sizes, readable defaults, template precedence, no-brand behaviour and preservation of edits/deleted logos.
- `node e2e/brand-starting-points.js` against the isolated `serve.py` backend: real generation with/without a template, editable fonts/sizes/logo, save/reload after guideline changes, and video export.
- `cd frontend && npm run build`
- `cd frontend && CI=true npm test -- --watchAll=false --runInBand`

The private preview uses simulated external services and a local test database, not live user data.
