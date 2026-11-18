// GridMonkey core — pure grid maths. No DOM, no InDesign APIs.
// Runs in the browser, Node (tests) and InDesign UXP.
//
// Method: the leading drives everything. The page height is divided into a whole
// number of baseline lines (the "corrected" leading), and the document grid uses
// that same step vertically. Horizontally, the page width is divided into a whole
// number of near-square units. Margins, gutters, columns and rows are then
// allocated in whole grid units, so every edge lands on a gridline.

export const MM_PER_PT = 25.4 / 72;

export const ptToMm = (pt) => pt * MM_PER_PT;
export const mmToPt = (mm) => mm / MM_PER_PT;

/** Round for display / InDesign entry (InDesign accepts 3 decimals). */
export const round = (n, dp = 3) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** Allowed baseline divisors: the increment can only be halved, at most twice. */
export const BASELINE_DIVISORS = Object.freeze([1, 2, 4]);

export const DEFAULTS = Object.freeze({
  pageWidth: 210, // mm
  pageHeight: 297, // mm
  fontSize: 10, // pt
  leading: 13, // pt
  columns: 12,
  rows: 8,
  // Facing pages: the horizontal margins are inside + outside and pages mirror.
  // Single-sided (facing: false): the same two numbers are left + right, no mirroring.
  facing: true,
  // `inside` is the first side (inside, or left when single-sided). equal: true splits
  // the total evenly (only even totals are offered then).
  horizontal: { margins: null, inside: null, gutter: 1, equal: false }, // in units
  vertical: { margins: null, top: null, gutter: 1 }, // top + bottom, in lines
  capHeight: null, // mm, optional (step 5)
  baselineDivisor: 1, // baseline increment = leading ÷ this (1, 2 or 4 — halving only)
});

/** Fraction of the page given to margins when the user hasn't chosen yet. */
const DEFAULT_MARGIN_SHARE = 0.2;

/**
 * Margin totals (in grid units) that leave space for `count` equal tracks of a
 * whole number of units each, separated by `gutter` units. Each side gets ≥ 1.
 */
export function validMarginTotals(units, count, gutter) {
  const out = [];
  const fixed = (count - 1) * gutter;
  for (let m = 2; m <= units - fixed - count; m++) {
    if ((units - m - fixed) % count === 0) out.push(m);
  }
  return out;
}

function nearest(list, target) {
  if (!list.length) return null;
  return list.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best));
}

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(n)));

/**
 * Allocate one axis. `units` = gridlines across the axis, `count` = tracks
 * (columns or rows), `requested` = { margins, first, gutter } where `first` is the
 * inside (horizontal) or top (vertical) margin.
 */
function allocateAxis(units, count, requested) {
  const gutter = clampInt(requested.gutter ?? 1, 0, units);
  const all = validMarginTotals(units, count, gutter);
  if (!all.length) {
    return { ok: false, gutter, options: all, error: 'Too many tracks or too wide a gutter for this page.' };
  }
  // Equal sides need an even total; if the grid offers none, fall back to any split.
  const even = all.filter((m) => m % 2 === 0);
  const equal = !!requested.equal && even.length > 0;
  const options = equal ? even : all;
  const target = requested.margins ?? Math.round(units * DEFAULT_MARGIN_SHARE);
  const margins = options.includes(requested.margins) ? requested.margins : nearest(options, target);
  const first = equal ? margins / 2 : clampInt(requested.first ?? Math.floor(margins / 2), 1, margins - 1);
  const second = margins - first;
  const track = (units - margins - (count - 1) * gutter) / count;
  return { ok: true, units, count, gutter, options, margins, first, second, track, equal, equalAvailable: even.length > 0 };
}

/**
 * Compute the full grid spec.
 * @returns a result object; `ok:false` with `errors` if inputs are unusable.
 */
export function computeGrid(input = {}) {
  const i = {
    ...DEFAULTS,
    ...input,
    horizontal: { ...DEFAULTS.horizontal, ...(input.horizontal || {}) },
    vertical: { ...DEFAULTS.vertical, ...(input.vertical || {}) },
  };
  const errors = [];
  const pos = (v, name) => {
    if (!(Number.isFinite(v) && v > 0)) errors.push(`${name} must be a positive number.`);
  };
  pos(i.pageWidth, 'Page width');
  pos(i.pageHeight, 'Page height');
  pos(i.fontSize, 'Font size');
  pos(i.leading, 'Leading');
  if (!(Number.isInteger(i.columns) && i.columns >= 1)) errors.push('Columns must be a whole number ≥ 1.');
  if (!(Number.isInteger(i.rows) && i.rows >= 1)) errors.push('Rows must be a whole number ≥ 1.');
  if (!BASELINE_DIVISORS.includes(i.baselineDivisor)) errors.push('Baseline divisor must be 1, 2 or 4.');
  if (errors.length) return { ok: false, errors };

  // Step 1 — type & corrected leading
  const proportion = i.leading / i.fontSize;
  const lines = Math.max(1, Math.round(i.pageHeight / ptToMm(i.leading)));
  const leadingMm = i.pageHeight / lines;
  const hUnits = Math.max(1, Math.round(i.pageWidth / leadingMm));
  const unitMm = i.pageWidth / hUnits;

  // Step 3 — allocate margins in gridlines
  const h = allocateAxis(hUnits, i.columns, {
    margins: i.horizontal.margins,
    first: i.horizontal.inside,
    gutter: i.horizontal.gutter,
    equal: i.horizontal.equal,
  });
  const v = allocateAxis(lines, i.rows, {
    margins: i.vertical.margins,
    first: i.vertical.top,
    gutter: i.vertical.gutter,
  });
  if (!h.ok) errors.push(`Columns: ${h.error}`);
  if (!v.ok) errors.push(`Rows: ${v.error}`);

  const type = {
    fontSize: i.fontSize,
    leading: i.leading,
    correctedLeadingPt: mmToPt(leadingMm),
    correctedLeadingMm: leadingMm,
    proportion,
    proportionOk: proportion >= 1.2 && proportion <= 1.45,
  };
  const grid = { lines, hUnits, unitMm, leadingMm };

  if (errors.length) return { ok: false, errors, input: i, type, grid, h, v };

  // Step 2 — Preferences > Grids
  // Optionally halve the baseline increment (÷2, ÷4) for finer vertical control.
  // Start stays at one full leading, which is also on the finer grid.
  const divisor = i.baselineDivisor;
  const baseline = {
    start: leadingMm, // relative to top of page: first baseline sits on gridline 1
    increment: leadingMm / divisor,
    incrementPt: mmToPt(leadingMm / divisor),
    divisor,
  };
  // InDesign's Document Grid fields are named for the DIRECTION OF SPACING:
  //   "Horizontal: Gridline Every" = spacing across the page → the vertical lines
  //   "Vertical: Gridline Every"   = spacing down the page   → the horizontal lines
  // (Confirmed against a 4000% zoom of InDesign: with these swapped, the grid sat
  // ~0.02 mm off the margins in both directions.) IDML uses the same names.
  const documentGrid = {
    horizontalEvery: unitMm, // vertical gridlines, one per grid unit across the page
    verticalEvery: leadingMm, // horizontal gridlines, one per leading down the page
    horizontalSubdivisions: 1,
    verticalSubdivisions: divisor, // shows the finer baseline steps (÷2, ÷4)
  };

  // Step 4 — Layout > Margins and Columns, Layout > Create Guides
  // inside/outside are the two horizontal margins either way (InDesign's Left/Right
  // fields hold inside/outside on facing pages); left/right name them for single-sided.
  const facing = i.facing !== false;
  const margins = {
    top: v.first * leadingMm,
    bottom: v.second * leadingMm,
    inside: h.first * unitMm,
    outside: h.second * unitMm,
    left: h.first * unitMm,
    right: h.second * unitMm,
  };
  const marginNames = facing ? { first: 'Inside', second: 'Outside' } : { first: 'Left', second: 'Right' };
  const columns = {
    number: i.columns,
    gutter: h.gutter * unitMm,
    width: h.track * unitMm,
    widthUnits: h.track,
  };
  const rows = {
    number: i.rows,
    gutter: v.gutter * leadingMm,
    height: v.track * leadingMm,
    heightLines: v.track,
  };

  // Step 5 — image-lines (optional). The first baseline of a frame placed at the
  // top margin lands one leading below it; the image-line sits a cap/x-height above.
  let imageLines = null;
  if (Number.isFinite(i.capHeight) && i.capHeight > 0) {
    imageLines = {
      firstY: margins.top + leadingMm - i.capHeight,
      repeatCount: i.rows - 1,
      offsetVertical: rows.height + rows.gutter,
      offsetHorizontal: 0,
    };
  }

  return {
    ok: true,
    input: i,
    facing,
    marginNames,
    type,
    grid,
    allocation: {
      horizontal: { options: h.options, total: h.margins, inside: h.first, outside: h.second, gutter: h.gutter, equal: h.equal, equalAvailable: h.equalAvailable },
      vertical: { options: v.options, total: v.margins, top: v.first, bottom: v.second, gutter: v.gutter },
    },
    baseline,
    documentGrid,
    margins,
    columns,
    rows,
    imageLines,
  };
}
