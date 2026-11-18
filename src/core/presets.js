// House defaults: the settings a fresh session (and "Reset to defaults") starts from.
// Based on the reference document SPREAD-REV-181126.indd: A4, 7.8/10 pt (corrected
// 10.022 pt) on a ÷2 baseline grid, 12 columns × 3 rows of 23 lines, margins 7/6 units
// and 6/7 lines, 4-page facing export with folios. Shared by the web app and the
// plugin. Pure data.
//
// computeGrid() keeps its own neutral DEFAULTS (tests rely on them); these sit on top.

export const HOUSE_GRID = Object.freeze({
  facing: true,
  pageWidth: 210,
  pageHeight: 297,
  fontSize: 7.8,
  leading: 10,
  columns: 12,
  rows: 3,
  horizontal: Object.freeze({ margins: 13, inside: 7, gutter: 2 }), // grid units
  vertical: Object.freeze({ margins: 13, top: 6, gutter: 1 }), // lines
  capHeight: null,
  baselineDivisor: 2,
});

export const HOUSE_STYLES = Object.freeze({
  enabled: true,
  bodyFontStyle: 'Regular',
  headingFontStyles: Object.freeze({ 1: 'SemiBold', 2: 'SemiBold', 3: 'SemiBold' }),
  headingSpaceAfter: Object.freeze({ 1: 0.5, 2: 0.5, 3: 0 }), // lines: 0, 0.5 or 1 (padded to whole lines on ÷2/÷4)
  bodySpaceAfter: 0.5, // lines; null = from separation (space → 1, indent → 0)
  listSpaceAfter: 0, // lines, after the end of a list (items stay tight)
  firstLineOnly: Object.freeze({ body: false, 1: null, 2: null, 3: null }), // null = automatic
  scale: 1.2,
  separation: 'space',
});

export const HOUSE_EXPORT = Object.freeze({
  format: 'facing4',
  showMaster: true,
  showThreads: true,
  folios: true,
  title: 'Untitled',
});
