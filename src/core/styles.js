// GridMonkey core — paragraph styles derived from a computed grid.
// Pure: takes the result of computeGrid() and returns style specs whose property
// names mirror the InDesign DOM so the plugin can apply them directly.
//
// Rules that keep text on the grid:
//  - Body leading = the corrected baseline increment; every body line aligns to it.
//  - Heading sizes follow a modular scale from the body size. Heading leading is the
//    smallest multiple of the baseline increment (÷2/÷4 grids), or of half a line
//    with "align first line only" on a ÷1 grid, that is ≥ the point size.
//  - Space after is 0, ½ or 1 line, per heading level and for Body. ½ only takes
//    effect on a ÷2/÷4 grid. Headings are padded so the next body line returns to a
//    full baseline.
//  - "Align first line only" can be set for Body and each heading (null = automatic).
//  - All horizontal indents are whole vertical-grid units.

import { ptToMm } from './grid.js';

export const SCALES = Object.freeze([
  { value: 1.2, label: 'Minor third (1.2)' },
  { value: 1.25, label: 'Major third (1.25)' },
  { value: 1.333, label: 'Perfect fourth (1.333)' },
  { value: 1.5, label: 'Perfect fifth (1.5)' },
  { value: 1.618, label: 'Golden ratio (1.618)' },
]);

// Project fonts (licensed; local copies in docs/<Family>/, git-ignored).
// Names match the fonts' typographic family/subfamily exactly, as InDesign shows
// them (note Graphik "Semibold" vs Montserrat "SemiBold"). Only these weights are allowed.
export const FONTS = Object.freeze({
  body: Object.freeze({ family: 'Graphik', styles: Object.freeze(['Regular', 'Medium']) }),
  heading: Object.freeze({ family: 'Montserrat', styles: Object.freeze(['Regular', 'Medium', 'SemiBold']) }),
});

/** Return `style` if the font allows it, otherwise `fallback`. */
const allowed = (font, style, fallback) => (font.styles.includes(style) ? style : fallback);

export const STYLE_DEFAULTS = Object.freeze({
  enabled: true,
  bodyFontStyle: 'Regular', // applies to Body, Body First and all list styles
  headingFontStyles: Object.freeze({ 1: 'SemiBold', 2: 'SemiBold', 3: 'Medium' }),
  // Space after in lines (0, 0.5 or 1). Per heading level; Body's null = from separation.
  headingSpaceAfter: Object.freeze({ 1: 1, 2: 1, 3: 0 }),
  bodySpaceAfter: null,
  // Space after a list (lines). Items of the same list style stay tight (InDesign's
  // "space between paragraphs using the same style" = 0), so it shows after the list.
  listSpaceAfter: 0,
  // InDesign "Align to grid: First line only". null = automatic (headings: on for a
  // ÷1 grid, off for ÷2/÷4; Body: off).
  firstLineOnly: Object.freeze({ body: null, 1: null, 2: null, 3: null }),
  scale: 1.25,
  separation: 'indent', // 'indent' | 'space'
});

export const STYLE_GROUP = 'GridMonkey';

export const SPACE_AFTER = Object.freeze([
  { value: 0, label: 'None' },
  { value: 0.5, label: '½ line' },
  { value: 1, label: '1 line' },
]);

/** Space after in lines: true → 1, false → 0, 0 / 0.5 / 1 kept, anything else → fallback. */
const spaceLines = (v, fallback) => {
  if (v === true) return 1;
  if (v === false) return 0;
  const n = Number(v);
  return v !== null && v !== '' && SPACE_AFTER.some((o) => o.value === n) ? n : fallback;
};

const roundHalf = (n) => Math.round(n * 2) / 2;
const EPS = 1e-9;

/** Smallest multiple of `step` that is ≥ `min`. */
const ceilTo = (min, step) => Math.max(1, Math.ceil(min / step - EPS)) * step;

export function computeStyles(grid, options = {}) {
  if (!grid?.ok) return { ok: false, errors: ['Fix the grid settings first.'] };
  const o = {
    ...STYLE_DEFAULTS,
    ...options,
    headingFontStyles: { ...STYLE_DEFAULTS.headingFontStyles, ...(options.headingFontStyles || {}) },
    headingSpaceAfter: { ...STYLE_DEFAULTS.headingSpaceAfter, ...(options.headingSpaceAfter || {}) },
    firstLineOnly: { ...STYLE_DEFAULTS.firstLineOnly, ...(options.firstLineOnly || {}) },
  };
  for (const l of [1, 2, 3]) o.headingSpaceAfter[l] = spaceLines(o.headingSpaceAfter[l], STYLE_DEFAULTS.headingSpaceAfter[l]);
  o.bodyFontStyle = allowed(FONTS.body, o.bodyFontStyle, STYLE_DEFAULTS.bodyFontStyle);
  for (const l of [1, 2, 3]) {
    o.headingFontStyles[l] = allowed(FONTS.heading, o.headingFontStyles[l], STYLE_DEFAULTS.headingFontStyles[l]);
  }
  const scale = Number(o.scale) > 1 ? Number(o.scale) : STYLE_DEFAULTS.scale;

  const leadingPt = grid.type.correctedLeadingPt; // body leading = one full grid line
  const baselineMm = grid.grid.leadingMm;
  const divisor = grid.baseline.divisor ?? 1;
  const gridStepPt = grid.baseline.incrementPt; // the baseline grid InDesign snaps to
  const fine = divisor >= 2;
  o.bodySpaceAfter = spaceLines(o.bodySpaceAfter, o.separation === 'space' ? 1 : 0);
  o.listSpaceAfter = spaceLines(o.listSpaceAfter, 0);
  const flag = (v, auto) => (typeof v === 'boolean' ? v : auto);
  o.firstLineOnly = {
    body: flag(o.firstLineOnly.body, false),
    1: flag(o.firstLineOnly[1], !fine),
    2: flag(o.firstLineOnly[2], !fine),
    3: flag(o.firstLineOnly[3], !fine),
  };
  // Heading leading step: the baseline increment on a ÷2/÷4 grid. On a ÷1 grid, half
  // a line when only the first line aligns (the rest are free), else a whole line.
  const headingStepFor = (level) => (fine ? gridStepPt : o.firstLineOnly[level] ? leadingPt / 2 : leadingPt);
  const unitMm = grid.grid.unitMm;
  const bodySize = grid.input.fontSize;
  const lines = (n) => n * baselineMm; // vertical space in mm

  const body = {
    name: 'Body',
    basedOn: null,
    appliedFont: FONTS.body.family,
    fontStyle: o.bodyFontStyle,
    pointSize: bodySize,
    leading: leadingPt,
    spaceBefore: 0,
    spaceAfter: lines(o.bodySpaceAfter),
    leftIndent: 0,
    firstLineIndent: o.separation === 'indent' ? unitMm : 0,
    alignToBaseline: true,
    alignFirstLineOnly: o.firstLineOnly.body,
    hyphenation: false, // off in every style (Body First and the lists inherit it)
    keepWithNext: 0,
    list: null,
    role: 'body',
  };

  const styles = [body];
  if (o.separation === 'indent') {
    styles.push({ ...body, name: 'Body First', basedOn: 'Body', firstLineIndent: 0, role: 'body-first' });
  }

  // Headings: H3 = body × scale, H2 = × scale², H1 = × scale³
  const spaceBefore = { 1: 2, 2: 1, 3: 1 }; // in baselines; space after is 0, ½ or 1 per level (options)
  for (const level of [1, 2, 3]) {
    const pointSize = roundHalf(bodySize * scale ** (4 - level));
    const leading = ceilTo(pointSize, headingStepFor(level));
    const before = spaceBefore[level];
    const afterTarget = o.headingSpaceAfter[level];
    // On a finer grid, body text after a heading could land between full lines.
    // Pad space after so before + heading leading + after = whole lines, keeping
    // the next body line on the full-leading grid (exact for one-line headings).
    let afterMm = lines(afterTarget);
    if (fine) {
      const blockMm = lines(before) + ptToMm(leading) + afterMm;
      afterMm += ceilTo(blockMm, baselineMm) - blockMm;
    }
    styles.push({
      ...body,
      name: `Heading ${level}`,
      // InDesign "Based On": H1 builds on Body, H2 and H3 on H1.
      basedOn: level === 1 ? 'Body' : 'Heading 1',
      appliedFont: FONTS.heading.family,
      fontStyle: o.headingFontStyles[level],
      pointSize,
      leading,
      spaceBefore: lines(before),
      spaceAfter: afterMm,
      firstLineIndent: 0,
      alignFirstLineOnly: o.firstLineOnly[level],
      hyphenation: false,
      keepWithNext: 2,
      role: `h${level}`,
      headingLevel: level,
    });
  }

  // Lists: hanging indent of whole grid units, wide enough for a bullet or "9."
  const minHangMm = ptToMm(bodySize * 1.2);
  const hang = ceilTo(minHangMm, unitMm);
  // Space after applies at the end of a list; sameParaStyleSpacing 0 keeps items of
  // one list style together (moving between levels, e.g. Bullet 1 → Bullet 2, still
  // gets the space, because they're different styles).
  const listBase = {
    ...body, basedOn: 'Body', firstLineIndent: -hang,
    spaceAfter: lines(o.listSpaceAfter),
    sameParaStyleSpacing: o.listSpaceAfter ? 0 : null, // mm; null = InDesign's default (ignore)
  };
  styles.push(
    { ...listBase, name: 'Bullet 1', leftIndent: hang, role: 'bullet', list: { type: 'bullet', level: 1, char: '•', charCode: 0x2022 } },
    { ...listBase, name: 'Bullet 2', leftIndent: hang * 2, role: 'bullet', list: { type: 'bullet', level: 2, char: '–', charCode: 0x2013 } },
    { ...listBase, name: 'Number 1', leftIndent: hang, role: 'number', list: { type: 'number', level: 1, format: '1, 2, 3, 4...', expression: '^#.^t' } },
    { ...listBase, name: 'Number 2', leftIndent: hang * 2, role: 'number', list: { type: 'number', level: 2, format: 'a, b, c, d...', expression: '^#.^t' } },
  );

  const warnings = [];
  const halves = [['Body', o.bodySpaceAfter], ['Lists', o.listSpaceAfter], ...[1, 2, 3].map((l) => [`H${l}`, o.headingSpaceAfter[l]])]
    .filter(([, v]) => v === 0.5).map(([n]) => n);
  if (!fine && halves.length) {
    warnings.push(`½-line space after (${halves.join(', ')}) needs a ÷2 or ÷4 baseline grid. On full leading the next paragraph snaps to the next whole line.`);
  }
  for (const s of styles) {
    const pct = s.leading / s.pointSize;
    if (s.role === 'body' && (pct < 1.2 || pct > 1.45)) {
      warnings.push(`Body leading is ${Math.round(pct * 100)}% of the point size.`);
    }
    if (s.headingLevel && pct > 1.5) {
      warnings.push(`${s.name} leading is loose (${Math.round(pct * 100)}%). Try a different scale.`);
    }
  }

  // Character styles: one attribute each, so they combine with any paragraph style.
  // White uses InDesign's built-in Paper swatch.
  const characterStyles = [
    { name: 'Medium', fontStyle: 'Medium' },
    { name: 'White', fillColor: 'Paper' },
  ];

  // Object styles (sizes in mm, so they follow the grid unit).
  //  - QR-Code: the QR box, 4 grid units square, with bounding-box text wrap that
  //    pushes text 1 grid unit clear on the right; a pasted QR graphic fits
  //    proportionally, centred. No fill or stroke.
  const objectStyles = [{
    name: 'QR-Code',
    width: 4 * unitMm,
    height: 4 * unitMm,
    textWrap: { mode: 'BoundingBoxTextWrap', offset: { top: 0, left: 0, bottom: 0, right: unitMm } },
    fitting: { emptyFrame: 'Proportionally', alignment: 'CenterAnchor', autoFit: true },
  }];

  return {
    ok: true,
    group: STYLE_GROUP,
    characterStyles,
    objectStyles,
    options: { ...o, scale },
    leadingPt,
    gridStepPt,
    divisor,
    baselineMm,
    unitMm,
    hangMm: hang,
    styles,
    warnings,
  };
}

/**
 * Folio (running foot) style: Body with no paragraph spacing or indent, one line,
 * aligned away from the spine (left on verso pages, right on recto and single pages).
 */
export function folioStyle(styles) {
  const body = styles.styles.find((s) => s.role === 'body');
  return {
    ...body,
    name: 'Folio',
    basedOn: 'Body',
    spaceBefore: 0,
    spaceAfter: 0,
    leftIndent: 0,
    firstLineIndent: 0,
    hyphenation: false,
    justification: 'AwayFromBindingSide',
    role: 'folio',
  };
}
