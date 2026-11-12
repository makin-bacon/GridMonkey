# Changelog

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
