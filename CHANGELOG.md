# Changelog

## 0.2.0-alpha — 2026-11-18

### Added
- **Facing pages / Single-sided** switch at the start of Page & type. Single-sided documents use left and right margins, preview as one page, and export without facing pages (1, 2 or 4 pages). An **Equal** option splits the margins evenly on either kind of document. In the web app and the plugin.
- **After lists** space control (None, ½ line, 1 line) for bullet and numbered lists, in the web app and the plugin. Items within a list stay tight; the space appears after the list.
- **QR-Code** object style in the downloaded IDML: a box 4 grid units square, with text wrap that keeps text 1 grid unit clear on the right and fits a pasted QR graphic proportionally. It scales with the grid.
- Table styles now have no space before and the row gutter as space after, so tables that fill a grid row step down the page row by row. The preview places each course table on the grid rows.
- **Imported style library:** every custom paragraph, character, table and cell style from the reference document SPREAD-REV-181126 (COURSE-BLOCK, BOTTOM-ROW, COURSE-TABLE-HEAD, Pathway-lozenge, QR-Block-Style and the rest) is packaged into the downloaded IDML. Sizes, spacing and indents are stored relative to the type size, leading and grid unit, so they scale with any settings. Re-import with `npm run library:import -- file.idml`.
- The InDesign document preview shows the reference document's course tables, flowed one after another through the frames, instead of lorem copy.
- **Space after** for Body and each heading level: None, ½ line or 1 line (½ line needs a ÷2 or ÷4 baseline grid). On a ÷2 or ÷4 grid the next body line after a heading still lands on a full baseline.
- **Align first line only** switch for Body and each heading level (InDesign's Align to Grid: First Line Only).
- Character styles **Medium** (weight only) and **White** (Paper colour only), in the IDML, the `.jsx` script and the plugin.
- SCU brand swatches in the IDML: 7 CMYK and 7 RGB, named `CMYK-…` and `RGB-…`.
- Folios option for the IDML export: the document title and an automatic page number on the parent pages, set in a new Folio style and aligned to the baseline grid. A Document title field also names the download.

### Fixed
- IDML: declared DOM version raised from 8.0 to 18.0 (InDesign 2023), because InDesign ignored newer style features such as paragraph shading. InDesign 2022 and older can no longer open the download.
- IDML: the 4-page document opened in InDesign with 7 pages and page 1 on the left. It now opens as [1] [2–3] [4].
- IDML: the row and image-line guides all landed on one parent page at the wrong heights. Each parent page now has its own guides, so every page shows them.
- IDML: paragraph styles weren't aligned to the baseline grid in InDesign (wrong attribute value). Every style now aligns, and folios sit on their baseline.

### Changed
- New defaults, based on the reference document SPREAD-REV-181126 and fine-tuned in the app: A4 facing pages, 7.8/10 pt on a ÷2 baseline grid, 12 columns × 3 rows, margins 7/6 units and 6/7 lines, ½ line after Body and after Headings 1–2, and a 4-page export with folios. Reset to defaults loads them.
- Hyphenation is now off in every style (Body, Body First and the lists too), in the IDML, the `.jsx` script and the plugin.
- The downloaded IDML opens with the baseline and document grids hidden (they're still set up; View › Grids & Guides shows them). Guides stay visible.
- The previews draw a 1 px dark grey outline around each page, on top of the grid, so the page edges are easy to see.
- The downloaded IDML has no dummy copy or image placeholder. The preview still shows them. The file keeps the pages, empty threaded frames, styles, swatches, guides and folios.
- **Download IDML** moved to the top bar (hover for what's inside), and Take the tour and Reset to defaults are now icon buttons.
- Text styles is now step 4, above Image-lines, and ends with the **Download InDesign script** button. The paragraph style table moved into a **Paragraph styles** tab in Under the hood.
- The Preferences › Grids, Layout › Margins and Columns and Layout › Create Guides cards are merged into one tabbed **Under the hood** card, kept at the end of the right column. The baseline increment control moved to the Page & type card.
- Heading 2 and Heading 3 are now based on Heading 1 (other styles stay based on Body).

## 0.1.0-alpha — 2026-11-13

First alpha of the GridMonkey web app.

### Added
- Leading-driven grid calculator. The leading is corrected so the page holds whole baselines, and margins, gutters, columns and rows are allocated in whole gridlines.
- Live preview with Spread and Single page views, labelled margins, and switchable layers.
- Values to copy for Preferences › Grids, Layout › Margins and Columns, Layout › Create Guides and image-lines.
- Baseline increment divisor: full leading, ÷ 2 or ÷ 4.
- Paragraph styles that sit on the grid: Body, Body First, Headings 1–3, and bullet and numbered lists two levels deep. Body styles use Graphik (Regular or Medium) and headings use Montserrat (Regular to SemiBold), with a live specimen.
- InDesign script (`.jsx`) that sets the baseline grid and creates the styles.
- IDML export in three formats (single page, double-sided, 4-page facing). Each has the grid, styles, guides, threaded text frames, a parent spread with linked frames, smart text reflow, an image placeholder and dummy copy. Grids and guides are shown when the file opens.
- Masonry layout on an 8 px rhythm, collapsible cards (chevron at the right of each header), a guided walkthrough, and settings saved in the browser.
- Vite + Tailwind CSS v4 build, matching the other projects, with a guard that stops licensed fonts being bundled.

### Fixed
- The document grid's Horizontal and Vertical "Gridline Every" values were swapped against InDesign's meaning (Horizontal = spacing across the page), which put the grid about 0.02 mm off the margins. The UI and IDML both now land exactly on the margins.
- Copy buttons now copy full-precision values (6 dp), and IDML and the script write 8 dp, so tiny rounding errors don't build up across the page.

### Known limitations
- The IDML files and the `.jsx` script haven't been tested in InDesign yet.
- The specimen and export preview break lines using browser fonts, so line breaks can differ slightly from InDesign.
