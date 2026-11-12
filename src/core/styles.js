// GridMonkey core — paragraph styles derived from a computed grid.
// Pure: takes the result of computeGrid() and returns style specs whose property
// names mirror the InDesign DOM so the plugin can apply them directly.
//
// Rules that keep text on the grid:
//  - Body leading = the corrected baseline increment; every body line aligns to it.
//  - Heading sizes follow a modular scale from the body size. Heading leading is the
//    smallest multiple of HALF a baseline that is ≥ the point size, with
//    "align first line only" — so the heading's first line snaps to the grid and
//    the body after it snaps back on.
//  - All vertical spacing is in whole baselines.
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
  scale: 1.25,
  separation: 'indent', // 'indent' | 'space'
});

export const STYLE_GROUP = 'GridMonkey';

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
  };
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
  // Heading leading step: half a line. On a ÷1 grid that only works with
  // "align first line only"; on a ÷2/÷4 grid every heading line can sit on the grid.
  const headingStepPt = leadingPt / Math.max(divisor, 2);
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
    spaceAfter: o.separation === 'space' ? lines(1) : 0,
    leftIndent: 0,
    firstLineIndent: o.separation === 'indent' ? unitMm : 0,
    alignToBaseline: true,
    alignFirstLineOnly: false,
    hyphenation: true,
    keepWithNext: 0,
    list: null,
    role: 'body',
  };

  const styles = [body];
  if (o.separation === 'indent') {
    styles.push({ ...body, name: 'Body First', basedOn: 'Body', firstLineIndent: 0, role: 'body-first' });
  }

  // Headings: H3 = body × scale, H2 = × scale², H1 = × scale³
  const headingSpacing = { 1: [2, 1], 2: [1, 1], 3: [1, 0] }; // [before, after] in baselines
  for (const level of [1, 2, 3]) {
    const pointSize = roundHalf(bodySize * scale ** (4 - level));
    const leading = ceilTo(pointSize, headingStepPt);
    const [before, afterTarget] = headingSpacing[level];
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
      basedOn: 'Body',
      appliedFont: FONTS.heading.family,
      fontStyle: o.headingFontStyles[level],
      pointSize,
      leading,
      spaceBefore: lines(before),
      spaceAfter: afterMm,
      firstLineIndent: 0,
      alignFirstLineOnly: !fine,
      hyphenation: false,
      keepWithNext: 2,
      role: `h${level}`,
      headingLevel: level,
    });
  }

  // Lists: hanging indent of whole grid units, wide enough for a bullet or "9."
  const minHangMm = ptToMm(bodySize * 1.2);
  const hang = ceilTo(minHangMm, unitMm);
  const listBase = { ...body, basedOn: 'Body', spaceAfter: 0, firstLineIndent: -hang };
  styles.push(
    { ...listBase, name: 'Bullet 1', leftIndent: hang, role: 'bullet', list: { type: 'bullet', level: 1, char: '•', charCode: 0x2022 } },
    { ...listBase, name: 'Bullet 2', leftIndent: hang * 2, role: 'bullet', list: { type: 'bullet', level: 2, char: '–', charCode: 0x2013 } },
    { ...listBase, name: 'Number 1', leftIndent: hang, role: 'number', list: { type: 'number', level: 1, format: '1, 2, 3, 4...', expression: '^#.^t' } },
    { ...listBase, name: 'Number 2', leftIndent: hang * 2, role: 'number', list: { type: 'number', level: 2, format: 'a, b, c, d...', expression: '^#.^t' } },
  );

  const warnings = [];
  for (const s of styles) {
    const pct = s.leading / s.pointSize;
    if (s.role === 'body' && (pct < 1.2 || pct > 1.45)) {
      warnings.push(`Body leading is ${Math.round(pct * 100)}% of the point size.`);
    }
    if (s.headingLevel && pct > 1.5) {
      warnings.push(`${s.name} leading is loose (${Math.round(pct * 100)}%). Try a different scale.`);
    }
  }

  return {
    ok: true,
    group: STYLE_GROUP,
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
