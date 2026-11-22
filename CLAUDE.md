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
| `src/core/presets.js` | **House defaults** (`HOUSE_GRID`, `HOUSE_STYLES`, `HOUSE_EXPORT`), based on the reference document SPREAD-REV-181126.indd and then tuned in the app: A4, 7.8/10 pt (10.022 corrected), ÷2 baseline, 12 columns × 3 rows (23 lines, 1-line gutter), margins 13 units (7 inside, 2-unit gutters) × 13 lines (6 top), 1.2 scale, ½ line after Body, H1/H2 ½ and H3 none after, 4-page facing export with folios. Fresh state and **Reset** in the web app and plugin use these; `computeGrid`'s own `DEFAULTS` stay neutral for the tests. The reference itself (8 inside, ÷4) differs slightly; a test rebuilds it exactly from the house grid with those two overrides. |
| `src/core/library-data.js` | **Generated** style library (`npm run library:import -- file.idml`, script in `scripts/import-library.mjs`). Currently from `SPREAD-REV-181126.indd` (the user's Downloads, not in the repo). Don't edit by hand. |
| `src/core/library.js` | `resolveLibrary(grid)` rebuilds the imported styles for the current grid (see "Imported style library"). |
| `src/core/sample-content.js` | The course block (table) from the reference document, for the document preview only. |
| `web/course-preview.js` | Lays out and flows the course blocks in the InDesign document preview. |
| `src/core/swatches.js` | `SWATCHES`: the SCU brand colours, 7 CMYK + 7 RGB, named `CMYK-<name>` / `RGB-<name>`. Written to the IDML's Graphic.xml. |
| `src/core/version.js` | `VERSION`, shown in the footer. A test keeps it equal to `package.json`. |
| `web/icons.js` | Fills `[data-icon]` buttons with inline Font Awesome Free solid SVGs (`@fortawesome/free-solid-svg-icons`, a dev dependency bundled by Vite; only imported icons ship). Header: `tour` = circle-question, `reset` = rotate-left. |
| `web/collapse.js` | Turns each card's `<h2>` into a disclosure button. Collapsed card ids are saved in `state.collapsed`. |
| `web/masonry.js` | Lays the app's own cards out on its own grid (see below). |
| `vite.config.js` | Vite config: repo root as the dev root (so `/web/` and `/docs/` both resolve), port 5280, and the **no-fonts-in-build** guard plugin. |
| `web/public/fonts.css` | `@font-face` rules → `/docs/<Family>/…`. It's a *public* file, so Vite copies it untouched and never bundles the fonts. In production the fonts 404 and the system fallback is used. |
| `plugin/` | **InDesign UXP plugin** (see "InDesign plugin" below). `static/` holds the manifest, panel HTML and CSS; `src/main.js` is the panel UI; `src/apply.js` makes the document changes (DOM injected); `src/preview.js` is the live preview; `dist/` is the build output that UDT loads (git-ignored). |
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
   - **Baseline divisor** (`baselineDivisor`: 1, 2 or 4, halving only, chosen in the **Page & type** card, step 1): baseline increment = leading ÷ divisor. The start, margins and columns don't change. Document grid subdivisions = divisor, so the finer steps show on the document grid too.
3. **Document layout** (`facing`, chosen first in Page & type): **Facing pages** (default) or **Single-sided**. The maths is the same; the two horizontal margins are inside/outside (mirrored spreads) or left/right (every page the same). `grid.marginNames` gives the labels, `margins.left/right` alias `inside/outside`, and InDesign's Left/Right fields take the same two values either way. Multi-page exports follow it (`computeDocument`: a single page is always single-sided). **Equal** (`horizontal.equal`) splits the total evenly, offering only even totals; if the grid has none (e.g. 59 units, 12 columns, 2-unit gutters → 13 or 25), it's unavailable and the app says so.
4. **Margins in grid units:** for each axis, the valid margin totals are those where `(units − total − (tracks−1)·gutter) % tracks === 0` (whole-unit columns/rows, each side ≥ 1). Requests snap to the nearest valid total. The default target is 20% of the units. Inside/top default to `floor(total/2)`.
5. **Outputs:** margins, column gutter and row gutter are unit counts × step. These map to Preferences › Grids, Layout › Margins and Columns, and Layout › Create Guides (Fit to Margins).
6. **Image-lines (optional):** `firstY = topMargin + leading − capHeight`. Step and Repeat count = rows − 1, vertical offset = rowHeight + rowGutter.

7. **Text styles** (`styles.js`). Everything inherits from **Body**.
   - **Hyphenation is off in every style** (set on Body; Body First, lists, headings and Folio all have it off).
   - **Body:** size = font size, leading = corrected baseline, align to grid on all lines. Paragraph separation is either a first-line indent of 1 grid unit (this also adds a **Body First** style with no indent) or 1 baseline of space after.
   - **Based On** (InDesign's style linking): H1 → Body, H2 and H3 → Heading 1, everything else → Body. Parents are listed before children.
   - **Character styles** (`characterStyles`, in the same "GridMonkey" group): **Medium** (FontStyle only) and **White** (FillColor = Paper only). Each sets one attribute and nothing else, so it works on top of any paragraph style. Written by the IDML, the `.jsx` and the plugin.
   - **Space after** (`SPACE_AFTER`: 0, ½ or 1 line) is set for Body (`bodySpaceAfter`; `null` = follow separation: space → 1, indent → 0) and per heading (`headingSpaceAfter`; legacy `true`/`false` read as 1/0). ½ line only takes effect on a ÷2/÷4 grid; on ÷1 a warning says the next paragraph snaps to the next whole line. Changing separation in the UI resets Body's space after to `null`.
   - **Space after lists** (`listSpaceAfter`: 0, ½ or 1 line) goes on Bullet 1/2 and Number 1/2, with `sameParaStyleSpacing` 0 (InDesign's "Space Between Paragraphs Using Same Style"), so items of one list style stay tight and the space shows after the list. Moving between levels (Bullet 1 → Bullet 2) also gets the space, because they're different styles. The specimen's text flow follows the same rule. Written by the IDML, the `.jsx` and the plugin. Checked in InDesign 2026.
   - **Align first line only** (`firstLineOnly`: `body`, `1`, `2`, `3`) maps to InDesign's Align to Grid: First Line Only. `null` = automatic: Body off; headings on for ÷1, off for ÷2/÷4. Body First and the lists inherit Body's setting. The UI shows resolved values (from `styles.options`).
   - **Headings 1–3:** sizes = body × scale³, ², ¹, rounded to 0.5 pt. Space before in lines: H1 2, H2 1, H3 1. Keep with next 2, no hyphenation.
     - **÷1 grid:** leading = the smallest multiple of ½ leading (first line only) or of a whole line (all lines) that is ≥ the point size.
     - **÷2 or ÷4 grid:** leading = the smallest multiple of leading ÷ divisor that is ≥ the size. Space after is padded so that before + leading + after = whole lines, which keeps the next body line on the full-leading grid. So the chosen space after is a minimum, and None and ½ can give the same result for some headings. This is exact for one-line headings; multi-line headings can push body text onto a sub-line.
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

## InDesign plugin (UXP, v1)

- **Build:**
  - `npm run plugin:build`, or `npm run plugin:watch`, which also watches `plugin/static/`.
  - Load `plugin/dist/manifest.json` in the **UXP Developer Tool**, then use **Reload** after each rebuild.
  - Manifest v5, host `ID` ≥ 18.5, one panel. Bundled as a single CJS `index.js` with `indesign` and `uxp` left external (UXP loads a classic script).
- **UI:** built-in Spectrum widgets (`sp-*`) and host theme variables. No Tailwind here, because UXP CSS has no grid, `:has()` or `color-mix()`.
  - A fixed top bar holds **Preview**, Match page size, Apply and the status line; settings scroll underneath.
  - All errors show in the status line.
- **Apply** (`applyToDocument`):
  - Runs as one undo step via `app.doScript(fn, UXPSCRIPT, [], ENTIRE_SCRIPT, 'GridMonkey')`, with the script unit set to POINTS and the zero point temporarily `[0,0]`.
  - Sets the grids (InDesign semantics), margins on the defaults plus every parent page and page, row guides and image-line guides on parent pages, and optionally styles.
  - Guides are labelled `gridmonkey` and replaced on each apply, so applying is **idempotent**.
- **Preview** (`createPreview`):
  - Each change undoes the previous step **only if** `doc.undoName === 'GridMonkey preview'`, then re-applies as that step. Unticking undoes it; Apply swaps it for a permanent "GridMonkey" step.
  - It never undoes the user's own edits.
- **New document** (`createDocument`):
  1. Builds the shared IDML with smart reflow **off**.
  2. Writes it to the plugin temp folder and opens it, trying `app.open(nativePath)` and then the file entry.
  3. Trims the overset copy using InDesign itself: it removes whole paragraphs from the longest story and drops any trailing heading.
  4. Turns smart reflow back on.
  - Each step names itself in any error.
- **Rows are optional** in both the panel and the web app (`rowsEnabled`). When off, the grid is computed with `rows: 1` and a vertical gutter of 0, so there are no row guides or row-based image placeholder. The row gutter is remembered for when rows come back.
- **Tests:** `plugin/src/apply.test.js` runs `apply.js` and `preview.js` against a fake InDesign DOM. Real-InDesign behaviour still needs hands-on checking.

## Imported style library

- **What:** every paragraph, character, table, cell and object style in a reference InDesign document that GridMonkey doesn't generate itself, packaged into the downloaded IDML. From `SPREAD-REV-181126.indd`: paragraph BODY-8pt/10.524pt, TABLE-8pt/12.027pt NO-BASELINE, COURSE-TABLE-HEAD, and GridMonkey:QR-Block-Style, Table-vertical-rhythm, Body-qtr-space, Pathway-lozenge; character Pathway-Glyp-Baseline, Course-QR-Text; table COURSE-BLOCK; cell BOTTOM-ROW. It had no custom object styles (the 4 are InDesign's defaults).
- **Updating:** in InDesign, File › Export › InDesign Markup (IDML), then `npm run library:import -- path/to/file.idml`. The source must contain GridMonkey:Body and a document grid (they define the reference size, leading and unit). GridMonkey's own styles (Body, Body First, headings, lists, Folio, Medium, White) are skipped.
- **Scaling** (`library.js`): measurements are stored relative to the source grid.
  - `size` × body point size: PointSize (rounded to 0.1 pt), BaselineShift, shading and border top/bottom offsets, corner radii.
  - `lines` × corrected leading: Leading, SpaceBefore/After, SameParaStyleSpacing, rule offsets, cell and table top/bottom insets.
  - `units` × grid unit: indents, shading and border left/right offsets, rule indents, tab stops, span/split gutters, left/right insets.
  - Everything else (stroke weights, tints, flags, colours, enums) is copied unchanged.
  - **Snapping on import:** paragraph and character leading and spacing round to the nearest **¼ line**, and point sizes within 3% of the body size become the body size, so leftovers from older grids (10.524 pt, 12.027 pt) land on the grid. Table and cell insets keep exact proportions (the 2 mm and 3 mm insets are deliberate).
- **In the IDML:** grouped styles (`GridMonkey:…`) go into the GridMonkey group after GridMonkey's own; the rest sit at the root in source order (parents first). `RootCellStyleGroup` and `RootTableStyleGroup` include InDesign's default styles, copied verbatim. `buildIdmlFiles(…, { library: false })` leaves it all out.
- **Tables follow the grid rows** (`fitTableToRows`): every imported table style gets SpaceBefore 0 and SpaceAfter = the grid's row gutter, so a table that fills a grid row ends on the row's bottom edge and the next starts on the next row's top. **Row heights can't be set by any InDesign style**, so whether a pasted table fills its row depends on its own rows (e.g. a minimum height on the bottom row). The preview shows the intent: each table starts on a row top and its bottom row stretches to fill whole grid rows. **Cell text height in the preview** runs from the font's ascent on the first line to its descent on the last (canvas `fontBoundingBox*`), like InDesign's AscentOffset; counting whole lines made a table about 0.4 line too tall, so it spilled into a second grid row. With the house defaults and the local fonts, 12 tables fit, 3 per page, one per row, as in the reference.
- **QR-Code object style** (generated by `computeStyles` → `objectStyles`, written by `objectStyleXml`): Size and Position on, 4 × 4 grid units; bounding-box text wrap with 1 grid unit on the right only; frame fitting Proportionally, centred, auto-fit; no fill or stroke. Applying it to any frame turns it into the QR box. Checked in InDesign 2026. It sits in `RootObjectStyleGroup` after InDesign's defaults. The preview's QR box and caption offset come from it.
- **Checked in InDesign 2026** at 7.8/10 ÷4 (values match the source) and 10/13 ÷2 (everything scaled, shading on, teal).
- **Not yet:** the plugin's Apply and the `.jsx` don't create the library styles (the plugin's New document does, because it goes through the IDML).

## IDML export

- **Formats:**
  - `single`: 1 page, no facing pages.
  - `double`: 2 pages, facing; page 1 sits alone on the right, page 2 alone on the left.
  - `facing4`: 4 pages, spreads `[1] [2–3] [4]`.
  - The page size always follows the grid.
- **Contents:**
  - The grid: document defaults plus a margin/column preference on each page.
  - The baseline and document grid, set up but **hidden on open** (`GridPreference DocumentGridShown/BaselineGridShown=false`; turn them on with View › Grids & Guides). Guides are **shown** (`GuidePreference GuidesShown`).
  - Units set to mm.
  - The GridMonkey style group, with Next Style set (heading → Body First → Body) and a "GridMonkey" numbering list.
  - The SCU swatches (`swatches.js`) as process colours, alongside Black, Paper and Registration.
  - Row guides, plus image-line guides on their own non-printing "Image-lines" layer, in Magenta.
- **Frames and text:**
  - One text frame per page, with as many text columns as divide the grid evenly while keeping lines at least 40 characters. The frames are threaded in page order.
  - The parent spread "A-Parent" has its own threaded frames (left → right).
  - Smart text reflow is on, with `LimitToMasterTextFrames=false`.
  - Page 1 has a grey image placeholder: its top is on the first image-line (if set) and its bottom on a row edge.
- **Folios** (optional, `folios` + `title` in the export options, off by default):
  - One single-line frame per parent page, same x and width as the parent text frame, each its own story. Verso: `<page#><em space><title>`; recto and single pages: `<title><em space><page#>`. The page number is IDML's auto page number (`<?ACE 18?>`).
  - **Folio** paragraph style: based on Body, no spacing or indent, no hyphenation, `Justification="AwayFromBindingSide"`.
  - Placement (`folioGeometry` in `document.js`): the baseline goes on the baseline grid (start + k × increment, so ÷2/÷4 steps count), at the step nearest to centring the cap height (input cap height, or 0.7 em) between the text-area bottom and the page bottom. The frame uses `FirstBaselineOffset="LeadingOffset"` with its top 0.01 mm above baseline − leading, so align-to-grid snaps the line onto that exact baseline.
  - The download filename comes from the title.
- **Preview content:** course tables from the reference document (`sample-content.js`, drawn by `web/course-preview.js`), set in the current and imported styles. They're **flowed one after another through the threaded frames**, the way the user builds these documents (tables pasted into the parent text frame). A table breaks between rows onto the next frame, and only whole tables are drawn. The preview uses the same empty pages as the download (no image box). The old lorem `story`/`fitStory` is only used by the plugin's New document now. **The web download has no copy:** `emptyDocument(doc)` drops the story (one empty Body paragraph is left) and the page 1 image placeholder, and gives page 1 the full text area. The 4 pages, threaded empty frames, styles, swatches, guides and folios stay. The plugin's New document still uses the trimmed copy.
- **Format details:** targets **DOMVersion 18.0** (InDesign 2023). It was 8.0, but InDesign silently drops attributes newer than the declared version, and paragraph shading (CC 2015) and same-style spacing (CC 2017) disappeared. Geometry is in points, in spread coordinates (x = 0 at the spine, page top at y = −H/2). The mimetype is the first entry and stored uncompressed.
- **Tests:** they check the zip with `unzip -t` and every XML part with `xmllint`.
- **Checked in InDesign 2026 on 2026-11-18** (opened with a script, compared with IDMLs InDesign exported itself). All three formats give the right pages and sides, guides, margins and columns, styles (sizes, leading, spacing, grid alignment, Based On, Next Style, lists, bullets), character styles, swatches and folios (on the expected baseline). What was wrong, so don't revert it:
  - **Guides** go *inside* their `<Page>` (before `MarginPreference`), and a horizontal guide's `Location` is measured from the **page top**, not in spread coordinates. `PageIndex` is 1-based on parent spreads. Before this fix, all the parent guides landed on one page at the wrong heights.
  - **`PagesPerDocument="1"`** in DocumentPreference (as InDesign writes it). With 4, InDesign added 3 extra pages and page 1 opened on the left.
  - **`GridAlignment="AlignBaseline"`**; InDesign silently ignored `AlignToBaseline`, so no style snapped to the grid.

## App layout (masonry)

The UI follows its own grid:
- **Rows:** cards sit on 8 px CSS grid rows. Each card's height rounds up to whole rows, and gaps are 3 rows (24 px).
- **Placement:** each card has a `data-track`. `inputs` cards always go left and `results` cards always go right. `any` cards are placed by trying every left/right split (document order is kept within each column) and picking the most even bottoms, then the shortest page.
- **No stretching:** every card, open or collapsed, takes only its natural height, rounded up to whole rows (less than 8 px extra). Column bottoms may differ; the balancing keeps the difference small. Stretching was tried and removed because it pushed card content out of view.
- **Re-layout** happens through ResizeObserver (which watches each card **and its children**, because a placed card's own box has a fixed row span), a media-query change, and after every app `update()`.
- **Narrow screens:** at 860 px and below it falls back to a normal stacked flow.

**Header:** **Download IDML** (primary; its description is the hover title), then icon buttons for the tour and Reset to defaults (aria-label + title).

**Inputs (left):** 1 Page & type (includes baseline increment), 2 and 3 margins, 4 Text styles (ends with **Download InDesign script**), 5 Image-lines.

**Card order (results):** Preview, Image-lines, InDesign document, Specimen, then **Under the hood** (`#cardHood`, always right). Under the hood is one collapsible card with tabs (Grids / Margins and Columns / Guides / Paragraph styles). The first three hold the hand-entry values and the last holds the style table. Tabs and panels sit in a plain `.hood-body` wrapper, because a utility `display` on a direct child would beat the collapse rule. The tabs use a roving tabindex with arrow keys, Home and End, and the active tab is saved in `state.hoodTab`.

When you add a card, give it a `data-track`. `form.inputs` and `.results` become `display: contents` in masonry mode, so their children are the grid items, and every card needs `min-width: 0`.

## Releases

- **Current version:** `0.2.1-alpha` (alpha). An "Alpha" badge sits in the top bar, and the version is in the footer.
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

- **2026-11-23**: **0.2.1-alpha.** `exports` map so SHERPA (`makin-bacon/sherpa`) can import `gridmonkey/core/*` from a pinned tag. GridMonkey stays standalone; content handling lives in SHERPA. 78 tests passing.

- **2026-11-18**: **0.2.0-alpha.** House defaults updated from the user's browser session: ÷2 baseline and 7 inside / 6 outside units (the reference document's 8/5 and ÷4 are kept in its rebuild test). 78 tests passing.
- **2026-11-18**: **Facing pages / Single-sided** switch (step 1) with left/right margins, an **Equal** option, a one-page preview and non-facing IDML exports; in the web app and the plugin. 78 tests passing.
- **2026-11-18**: **Space after lists** (`listSpaceAfter`, same-style spacing 0 keeps items tight). 76 tests passing.
- **2026-11-18**: **QR-Code object style** (4 × 4 units, text wrap 1 unit right, fit proportionally) and table styles spaced by the row gutter; the preview puts each course table on grid rows. 75 tests passing.
- **2026-11-18**: **Imported style library** from SPREAD-REV-181126.indd (7 paragraph, 2 character, 1 table, 1 cell style), scaled to the grid; course-table sample content in the document preview; DOMVersion 18.0. 73 tests passing.
- **2026-11-18**: **IDML fixes from opening the files in InDesign:** guides inside each page with page-relative positions, PagesPerDocument=1 (4 pages, page 1 on the right), GridAlignment=AlignBaseline. 68 tests passing.
- **2026-11-17**: **Space after** is now None / ½ line / 1 line, for Body and each heading, plus an **Align first line only** switch for each (web app and plugin). 67 tests passing.
- **2026-11-17**: The downloaded IDML no longer has dummy copy or the image placeholder (`emptyDocument`); the preview keeps both. 65 tests passing.
- **2026-11-16**: Header: Download IDML plus Font Awesome icon buttons (tour, reset). Text styles is now step 4 (Image-lines is 5) and ends with the script download. The paragraph style table is a tab in Under the hood.
- **2026-11-16**: The Grids, Margins and Columns, and Create Guides cards are merged into one tabbed **Under the hood** card at the end of the right column. The baseline increment control moved to Page & type. The IDML card mentions the swatches.
- **2026-11-16**: Per-heading **Space after** switch (web app and plugin). 64 tests passing.
- **2026-11-16**: Character styles Medium and White (one attribute each) in the IDML, `.jsx` and plugin; SCU CMYK and RGB swatches in the IDML. 63 tests passing.
- **2026-11-16**: House defaults (`presets.js`), taken from the user's browser session. Optional **folios** in the IDML (title + auto page number on the parent pages, aligned to the baseline grid), with a preview and a title field. H2 and H3 are now based on Heading 1. 61 tests passing.

- **2026-11-13**: **Plugin v1** (`plugin-v1` branch): UXP panel with Preview, Apply (one undo step) and New document (via IDML, trimmed in InDesign). First hands-on test: the panel needed scrolling (fixed top bar added) and Create hit an object-reference error (made robust, with named steps). Optional rows in the panel and web app. 55 tests passing.
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

- [ ] Folios in the plugin panel (the core supports them; the panel doesn't offer the option yet).

- [ ] Check the web app by hand in a browser (mobile width too) and against a real InDesign document.
- [ ] **Run the generated .jsx in InDesign.** Not run yet. Check bullet characters, numbering levels and restarts, and missing-font behaviour.
- [ ] Possible style additions: character styles (bold, italic), caption, pull quote, space before/after lists.
- [ ] Unit toggle (mm / in / pt) for page size and outputs.
- [ ] Option to allow off-grid layouts (any margin total, with a warning).
- [ ] Export or share settings (URL hash or JSON).
- [ ] **Phase 2: UXP plugin** (`plugin/`): `manifest.json` (InDesign ≥ 18.5), panel UI that reuses `src/core/grid.js`. Apply settings with the InDesign DOM: `document.gridPreferences` (baselineStart, baselineDivision, horizontal/verticalGridlineDivision, subdivisions), `documentPreferences` (page size, facing pages), parent spread `marginPreferences` (top, bottom, left=inside, right=outside, columnCount, columnGutter), `createGuides` for rows, and image-line guides on their own layer. Set `viewPreferences` units to mm while applying, then restore them. Load with the UXP Developer Tool.
