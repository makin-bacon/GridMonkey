# CLAUDE.md — GridMonkey

Grid setup tool for Adobe InDesign. **Phase 1: web app** (current). **Phase 2: InDesign UXP plugin** that applies the same results straight to the document.

The original reference (a screenshot, since removed) was a 5-step manual calculator (page and type → baseline and document grid → margins allocated in gridlines → values for InDesign dialogs → image-lines). GridMonkey implements that method as an original tool. Don't copy that site's look or text.

## Commands

```sh
npm install    # first time / fresh clone (also runs `prepare` → git hooks for the font guard)
npm run dev    # Vite dev server → http://127.0.0.1:5280/web/
npm run build  # production build → dist/ (fails if any font file would be bundled)
npm run preview  # serve dist/ on http://127.0.0.1:5281/web/index.html
npm test       # node --test on src/ (Node ≥ 20)
```

- **Stack:** Vite 8 + Tailwind CSS v4 (`@tailwindcss/vite`, `@tailwindcss/forms`), the same as the user's other projects (KITCHEN-SINK, MIDIBOSSv2…).
- **Code:** the app code is still plain ES modules with no framework.
- **Port:** 5173 is avoided because another local Vite project uses it. The dev server binds to 127.0.0.1 only.

## Layout

| Path | What |
|---|---|
| `src/core/grid.js` | **All grid maths.** Pure JS, no DOM or InDesign APIs. `computeGrid(input)` returns the full spec. Shared by web and plugin. |
| `src/core/styles.js` | `computeStyles(grid, options)` returns paragraph style specs. Property names mirror the InDesign DOM. |
| `src/core/indesign-script.js` | `buildStylesScript(grid, styles)` returns ExtendScript `.jsx` text (a stopgap until the plugin). |
| `src/core/zip.js` | Minimal STORE-only ZIP writer (CRC32, no deps). |
| `src/core/dummy.js` | Deterministic lorem copy that uses every style; `'@first'` resolves to Body First or Body. |
| `src/core/document.js` | `computeDocument(grid, styles, format)` returns the export model: pages, spreads, threaded frames, parent spread, guides, image placeholder and story. `fitStory()` trims the story to whole paragraphs. |
| `src/core/idml.js` | `buildIdmlFiles()` / `buildIdml()` turn grid + styles + document into an IDML package. |
| `src/core/*.test.js` | Unit tests (`node:test`). The script test also compile-checks the generated JSX. |
| `web/` | `index.html`, `app.js` (state, rendering, SVG spread preview), `styles-panel.js` (text-styles UI, specimen, .jsx download), `styles.css` (the **Tailwind entry**). Imports `../src/core/grid.js`, so serve from the **repo root**. |
| `web/flow.js` | Text-flow simulation (canvas-measured wrapping and grid snapping), shared by the specimen and the export preview. |
| `web/export-panel.js` | Export card: format picker, in-context preview (frames, threads, flowed copy, optional parent spread) and the IDML download. |
| `web/tour.js` | Guided walkthrough with a spotlight and panel. It runs on the first visit (`gridmonkey:tour-seen`) and from **Take the tour**. Steps are defined in `app.js` (`TOUR_STEPS`). |
| `src/core/version.js` | `VERSION`, shown in the footer. A test keeps it equal to `package.json`. |
| `web/collapse.js` | Turns each card's `<h2>` into a disclosure button. Collapsed card ids are saved in `state.collapsed`. |
| `web/masonry.js` | Lays the app's own cards out on its own grid (see below). |
| `vite.config.js` | Vite config: repo root as the dev root (so `/web/` and `/docs/` both resolve), port 5280, and the **no-fonts-in-build** guard plugin. |
| `web/public/fonts.css` | `@font-face` rules → `/docs/<Family>/…`. It's a *public* file, so Vite copies it untouched and never bundles the fonts. In production the fonts 404 and the system fallback is used. |
| `plugin/` | Placeholder for the UXP plugin (phase 2). |
| `docs/` | Holds only the local, git-ignored font folders now. The reference screenshots were removed once they'd served their purpose. |
| `docs/Graphik/`, `docs/Montserrat/` | **Licensed fonts. Local only and git-ignored.** Never commit, publish, upload or bundle them. |
| `.githooks/pre-commit` | Rejects staged font files, even ones added with `git add -f`. |

## The method (keep code and docs in sync)

1. **Corrected leading:** `lines = round(pageHeight / leadingMm)`, then `leadingMm = pageHeight / lines`, so the page height holds a whole number of baselines. Proportion L/F is flagged outside 120–145%.
2. **Document grid.** InDesign names these fields for the **direction of spacing**:
   - **"Horizontal: Gridline Every"** = spacing *across* the page (the vertical lines) = grid unit = `pageWidth / round(pageWidth / leadingMm)`, which gives near-square units that fit the width exactly.
   - **"Vertical: Gridline Every"** = spacing *down* the page (the horizontal lines) = corrected leading.
   - IDML `HorizontalGridlineDivision` and `VerticalGridlineDivision` use the same meaning.
   - **Subdivisions:** horizontal = 1, vertical = the baseline divisor.
   - **Baseline start** = 1 leading from the top of the page, so baselines sit on the horizontal gridlines.
   - **Verified, do not swap:** this was swapped until 2026-11-13. A 4000% zoom in InDesign (screenshot since removed) showed the document grid about 0.02 mm off the margins in both directions, in exactly the pattern the swap predicts.
   - **Precision:** the grid steps are irrational in mm and pt. The UI shows 3 dp but copies 6 dp, and IDML and `.jsx` write 8 dp, so errors don't build up across 60+ gridlines.
   - **Baseline divisor** (`baselineDivisor`: 1, 2 or 4, halving only, chosen in the Preferences › Grids card): baseline increment = leading ÷ divisor. The start, margins and columns don't change. Document grid subdivisions = divisor, so the finer steps show on the document grid too.
3. **Margins in grid units:** for each axis, the valid margin totals are those where `(units − total − (tracks−1)·gutter) % tracks === 0` (whole-unit columns/rows, each side ≥ 1). Requests snap to the nearest valid total. The default target is 20% of the units. Inside/top default to `floor(total/2)`.
4. **Outputs:** margins, column gutter and row gutter are unit counts × step. These map to Preferences › Grids, Layout › Margins and Columns, and Layout › Create Guides (Fit to Margins).
5. **Image-lines (optional):** `firstY = topMargin + leading − capHeight`. Step and Repeat count = rows − 1, vertical offset = rowHeight + rowGutter.

6. **Text styles** (`styles.js`). Everything inherits from **Body**.
   - **Body:** size = font size, leading = corrected baseline, align to grid on all lines. Paragraph separation is either a first-line indent of 1 grid unit (this also adds a **Body First** style with no indent) or 1 baseline of space after.
   - **Headings 1–3:** sizes = body × scale³, ², ¹, rounded to 0.5 pt. Space before/after in lines: H1 2/1, H2 1/1, H3 1/0. Keep with next 2, no hyphenation.
     - **÷1 grid:** leading = the smallest multiple of ½ leading that is ≥ the point size, with *align first line only*, so body text snaps back onto the grid.
     - **÷2 or ÷4 grid:** leading = the smallest multiple of leading ÷ divisor that is ≥ the size, and **all lines** align. Space after is padded so that before + leading + after = whole lines, which keeps the next body line on the full-leading grid. This is exact for one-line headings; multi-line headings can push body text onto a sub-line.
   - **Body and lists:** always use full leading, whatever the divisor.
   - **Bullet 1/2, Number 1/2:** hanging indent = whole grid units, at least 1.2 em wide. Level 2 = 2 × hang. Bullets are • and –. Numbers are `1.` and then `a.`, in one numbering list called "GridMonkey".
   - **Generated .jsx:** sets the baseline grid (start + increment, relative to top of page) and creates or updates the styles in a "GridMonkey" style group. It runs as a single Undo step, wraps each property in try/catch, and reports warnings in an alert.
   - **Specimen:** wraps text with canvas measurement and simulates InDesign's grid snapping. Line breaks are approximate.

All units are mm internally. Type sizes are pt. Displayed values are rounded to 3 dp.

## Fonts

- **Body styles** (Body, Body First, all lists) use **Graphik**: `Regular` or `Medium` only.
- **Headings** use **Montserrat**: `Regular`, `Medium` or `SemiBold` only, with a separate weight for each level. Defaults: H1 SemiBold, H2 SemiBold, H3 Medium.
- **Where it's enforced:** `FONTS` in `src/core/styles.js`. Disallowed weights fall back to the defaults, and the UI only offers allowed weights.
- **Names:** they match the fonts' typographic family/subfamily names, which is what InDesign shows. Graphik spells it `Semibold`; Montserrat spells it `SemiBold`. Re-check the names if the font files change.
- **Keeping them out of the repo:**
  - `.gitignore` covers both folders, plus every font extension and `Document Fonts/`.
  - The pre-commit hook blocks forced adds.
  - The dev server only listens on 127.0.0.1.
  - The UXP plugin must use installed fonts and never package them.
  - Don't put font files into Artifacts, uploads or any external service.
- **This is an obscurity measure, not real protection.** Anyone with access to the machine can still find the files. That's acceptable because the project is private.

## IDML export

- **Formats:**
  - `single`: 1 page, no facing pages.
  - `double`: 2 pages, facing; page 1 sits alone on the right, page 2 alone on the left.
  - `facing4`: 4 pages, spreads `[1] [2–3] [4]`.
  - The page size always follows the grid.
- **Contents:**
  - The grid: document defaults plus a margin/column preference on each page.
  - The baseline and document grid, **shown on open** along with guides (`GuidePreference GuidesShown`, `GridPreference DocumentGridShown/BaselineGridShown`).
  - Units set to mm.
  - The GridMonkey style group, with Next Style set (heading → Body First → Body) and a "GridMonkey" numbering list.
  - Row guides, plus image-line guides on their own non-printing "Image-lines" layer, in Magenta.
- **Frames and text:**
  - One text frame per page, with as many text columns as divide the grid evenly while keeping lines at least 40 characters. The frames are threaded in page order.
  - The parent spread "A-Parent" has its own threaded frames (left → right).
  - Smart text reflow is on, with `LimitToMasterTextFrames=false`.
  - Page 1 has a grey image placeholder: its top is on the first image-line (if set) and its bottom on a row edge.
- **Dummy copy:** generated at about 120% of the estimated capacity. The preview flows it, then `fitStory` keeps only the whole paragraphs that fit (dropping a stranded heading at the end), and the **download uses that trimmed story**, so the file opens without overset text. Line breaks come from browser fonts, so InDesign's fit can differ slightly.
- **Format details:** targets DOMVersion 8.0. Geometry is in points, in spread coordinates (x = 0 at the spine, page top at y = −H/2). The mimetype is the first entry and stored uncompressed.
- **Tests:** they check the zip with `unzip -t` and every XML part with `xmllint`. **Not yet opened in real InDesign.** The parts most likely to need fixes are attribute names and enums (`GridAlignment`, `GuideColor`, `PrimaryTextFrame` deliberately omitted), element order in Preferences.xml, and grouped style `Name="GridMonkey:Body"`.

## App layout (masonry)

The UI follows its own grid:
- **Rows:** cards sit on 8 px CSS grid rows. Each card's height rounds up to whole rows, and gaps are 3 rows (24 px).
- **Placement:** each card has a `data-track`. `inputs` cards always go left and `results` cards always go right. `any` cards are placed by trying every left/right split (document order is kept within each column) and picking the most even bottoms, then the shortest page.
- **No stretching:** every card, open or collapsed, takes only its natural height, rounded up to whole rows (less than 8 px extra). Column bottoms may differ; the balancing keeps the difference small. Stretching was tried and removed because it pushed card content out of view.
- **Re-layout** happens through ResizeObserver (which watches each card **and its children**, because a placed card's own box has a fixed row span), a media-query change, and after every app `update()`.
- **Narrow screens:** at 860 px and below it falls back to a normal stacked flow.

When you add a card, give it a `data-track`. `form.inputs` and `.results` become `display: contents` in masonry mode, so their children are the grid items, and every card needs `min-width: 0`.

## Releases

- **Current version:** `0.1.0-alpha` (alpha). An "Alpha" badge sits in the top bar, and the version is in the footer.
- **To release:** bump `version` in **both** `package.json` and `src/core/version.js` (the test fails if they differ), add a `CHANGELOG.md` entry, and remove the badge once out of alpha.
- **When you add a card,** add a `TOUR_STEPS` entry if it's worth explaining.

## Styling (Tailwind v4)

`web/styles.css` follows the house pattern from KITCHEN-SINK's `src/style.css`:
- `@import 'tailwindcss'` and `@plugin '@tailwindcss/forms'`.
- **One theme block:**
  - **One accent scale,** `--color-accent-50…950`, currently mapped to `orange`. Re-skin by swapping that word.
  - **Durations:** `--duration-fast/base/slow`.
  - **Type scale:** `text-h1 / h2 / minor / body / label / small`.
- **Neutrals:** slate.

Semantic tokens (`--bg`, `--ink`, `--line`, `--accent`…) in `:root` are built from theme variables and drive the component CSS and the SVG previews. Existing component classes live in `@layer components`, so utilities override them. **Prefer Tailwind utilities for new markup** (the footer and collapse chevron already use them), and migrate older components when you touch them.

Gotchas:
- **SVG guide colours** (`--margin`, `--colguide`, `--rowguide`, `--imageline`, `--thread`) stay plain sRGB hex. Wide-gamut oklch theme colours render with yellow fringes on hairline SVG strokes.
- **Forms plugin:** it styles inputs, selects and checkboxes. Use `background-color` (not the `background` shorthand) on selects, or its arrow disappears. Checked boxes take `color: accent`.
- **Dark mode** follows `prefers-color-scheme`. The other projects use a manual `.dark` class, so switch to `@custom-variant dark` if a toggle is added.

## UI conventions

- **Type scale** (in `styles.css`):
  - h1: 18/24 600.
  - h2 (card titles): 16/24 600.
  - `.minor` h3: 11/16 600, uppercase and tracked, used for sub-sections such as "Total margin gridlines".
  - Body: 14/20. Labels: 13/18, muted. Hints and captions: 12/18, muted.
- **Numbers are always monospace.** Wrap numbers in `<span class="num">` when writing HTML strings. Numeric inputs, values, tables, pills and readouts use `var(--mono)` already.
- **Main preview:** a **Spread / Single page** switch (`state.previewView`). Single page shows a right-hand page (inside margin on the left), so the inside/outside difference is easy to judge. "Margin sizes" labels each margin with its name and mm value.

## Conventions

- New logic goes in `src/core/` with tests. UI files only handle display and state.
- `computeGrid` must stay synchronous, pure and serialisable, because the plugin will call it as is.
- The web app persists inputs in `localStorage` (`gridmonkey:v1`), wrapped in try/catch.
- Single accent colour (`--accent`). Light and dark mode come from CSS tokens in `:root`.

## Status / log

- **2026-11-13**: **Fix:** the document grid's Horizontal and Vertical "Gridline Every" values were swapped, leaving the grid about 0.02 mm off the margins at 4000% zoom. Both the UI and IDML are corrected, and subdivisions are now split by direction. Copy buttons give 6 dp; IDML and `.jsx` write 8 dp. The Grids card follows InDesign's field order. 43 tests passing.
- **2026-11-13**: Moved to Vite + Tailwind v4 (house setup) with slate neutrals and an accent scale; the build blocks bundled fonts. Collapse chevrons are right-aligned in each header. Inline favicon.
- **2026-11-13**: **0.1.0-alpha.** Guided walkthrough, footer with version (5rem bottom space), Alpha badge, `CHANGELOG.md`. 42 tests passing.
- **2026-11-13**: Masonry no longer stretches cards to level the columns. Each card keeps its own height.
- **2026-11-13**: IDML export (single / double-sided / 4-page facing) with grids and guides shown on open, threaded doc and parent frames, smart reflow, an image placeholder, and dummy copy trimmed to fit. Export preview with format picker, threads and optional parent spread. Shared `web/flow.js`. Type hierarchy pass (minor headings, monospace numbers), tagline removed, Spread / Single-page preview switch with margin labels, collapsible cards. 41 tests passing.
- **2026-11-13**: Masonry app layout (`web/masonry.js`). Cards snap to an 8 px rhythm, free cards balance between the columns, and column bottoms always align. Checked at 1400, 1000 and 390 px and across several states.
- **2026-11-13**: Project fonts: Graphik for body (Regular/Medium), Montserrat for headings (Regular to SemiBold, chosen per level). Fonts are git-ignored with a pre-commit guard, and the preview loads them locally via `web/fonts.css` and re-wraps the specimen when they finish loading. 25 tests passing.
- **2026-11-12**: Added a baseline divisor (full leading, ÷2, ÷4) to the Preferences › Grids card. Heading styles adapt to it, and the specimen draws the finer steps dashed. 23 tests passing.
- **2026-11-12**: Added text styles (step 5): Body (+ Body First), H1–H3, bullet and numbered lists two levels deep. Includes a style table, a live specimen on the baseline grid, and a `.jsx` download. 18 tests passing.
- **2026-11-12**: Scaffold → working web app. Core maths + 8 passing tests. Web UI with page presets, margin steppers that only offer valid totals, facing-pages SVG preview (document grid, baselines, modules, margins, image-lines), and copy-to-clipboard values for each InDesign dialog. Checked with headless Chrome at 1400px.

## Next up

- [ ] Check the web app by hand in a browser (mobile width too) and against a real InDesign document.
- [ ] **Open each IDML format in InDesign** and fix anything it rejects or ignores.
- [ ] **Run the generated .jsx in InDesign.** Not run yet. Check bullet characters, numbering levels and restarts, and missing-font behaviour.
- [ ] Possible style additions: character styles (bold, italic), caption, pull quote, space before/after lists.
- [ ] Unit toggle (mm / in / pt) for page size and outputs.
- [ ] Option to allow off-grid layouts (any margin total, with a warning).
- [ ] Export or share settings (URL hash or JSON).
- [ ] **Phase 2: UXP plugin** (`plugin/`): `manifest.json` (InDesign ≥ 18.5), panel UI that reuses `src/core/grid.js`. Apply settings with the InDesign DOM: `document.gridPreferences` (baselineStart, baselineDivision, horizontal/verticalGridlineDivision, subdivisions), `documentPreferences` (page size, facing pages), parent spread `marginPreferences` (top, bottom, left=inside, right=outside, columnCount, columnGutter), `createGuides` for rows, and image-line guides on their own layer. Set `viewPreferences` units to mm while applying, then restore them. Load with the UXP Developer Tool.
