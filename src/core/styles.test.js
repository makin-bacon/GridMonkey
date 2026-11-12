import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGrid } from './grid.js';
import { computeStyles, SCALES } from './styles.js';
import { buildStylesScript } from './indesign-script.js';

const isMultiple = (v, step) => Math.abs(v / step - Math.round(v / step)) < 1e-6;
const byName = (r, n) => r.styles.find((s) => s.name === n);

test('requires a valid grid', () => {
  assert.equal(computeStyles(computeGrid({ pageWidth: -1 })).ok, false);
});

test('body sits exactly on the baseline grid', () => {
  const g = computeGrid();
  const r = computeStyles(g);
  const body = byName(r, 'Body');
  assert.equal(body.leading, g.type.correctedLeadingPt);
  assert.equal(body.pointSize, 10);
  assert.equal(body.alignFirstLineOnly, false);
});

for (const { value } of SCALES) {
  test(`scale ${value}: headings grow, stay ≥ solid, use half-baseline leading`, () => {
    const g = computeGrid();
    const r = computeStyles(g, { scale: value });
    const [h1, h2, h3] = [1, 2, 3].map((l) => byName(r, `Heading ${l}`));
    assert.ok(h1.pointSize > h2.pointSize && h2.pointSize > h3.pointSize && h3.pointSize > 10);
    for (const h of [h1, h2, h3]) {
      assert.ok(h.leading >= h.pointSize, `${h.name} leading ≥ size`);
      assert.ok(isMultiple(h.leading, g.type.correctedLeadingPt / 2), `${h.name} leading on half grid`);
      assert.ok(isMultiple(h.spaceBefore, g.grid.leadingMm));
      assert.ok(isMultiple(h.spaceAfter, g.grid.leadingMm));
      assert.equal(h.alignFirstLineOnly, true);
    }
  });
}

test('lists hang on whole grid units, two levels each', () => {
  const g = computeGrid();
  const r = computeStyles(g);
  for (const n of ['Bullet 1', 'Bullet 2', 'Number 1', 'Number 2']) {
    const s = byName(r, n);
    assert.ok(isMultiple(s.leftIndent, g.grid.unitMm), `${n} left indent`);
    assert.ok(isMultiple(-s.firstLineIndent, g.grid.unitMm), `${n} first-line indent`);
    assert.ok(s.list);
  }
  assert.equal(byName(r, 'Bullet 2').leftIndent, 2 * byName(r, 'Bullet 1').leftIndent);
  assert.equal(byName(r, 'Number 2').list.level, 2);
});

test('paragraph separation modes', () => {
  const g = computeGrid();
  const indent = computeStyles(g, { separation: 'indent' });
  assert.ok(byName(indent, 'Body First'));
  assert.equal(byName(indent, 'Body').firstLineIndent, g.grid.unitMm);
  const space = computeStyles(g, { separation: 'space' });
  assert.equal(byName(space, 'Body First'), undefined);
  assert.equal(byName(space, 'Body').spaceAfter, g.grid.leadingMm);
});

test('InDesign script compiles and names every style', () => {
  const g = computeGrid();
  const r = computeStyles(g);
  const jsx = buildStylesScript(g, r);
  const body = jsx.replace(/^#target.*$/m, '');
  assert.doesNotThrow(() => new Function(body)); // syntax check only
  for (const s of r.styles) assert.ok(jsx.includes(`"name": "${s.name}"`));
});

for (const d of [2, 4]) {
  test(`baseline ÷${d}: body keeps full leading, headings align all lines on the finer grid`, () => {
    const g = computeGrid({ baselineDivisor: d });
    const r = computeStyles(g);
    const L = g.type.correctedLeadingPt;
    assert.equal(byName(r, 'Body').leading, L);
    assert.equal(r.divisor, d);
    for (const l of [1, 2, 3]) {
      const h = byName(r, `Heading ${l}`);
      assert.equal(h.alignFirstLineOnly, false);
      assert.ok(isMultiple(h.leading, L / d), `${h.name} leading on ÷${d} grid`);
      assert.ok(h.leading >= h.pointSize);
      // one-line heading block keeps the following body on the full-leading grid
      const blockPt = h.spaceBefore / (25.4 / 72) + h.leading + h.spaceAfter / (25.4 / 72);
      assert.ok(isMultiple(blockPt, L), `${h.name} block = whole lines`);
      assert.ok(isMultiple(h.spaceAfter, g.baseline.increment), `${h.name} space after on fine grid`);
    }
  });
}

test('÷1 grid keeps half-line headings with first-line-only alignment', () => {
  const r = computeStyles(computeGrid());
  assert.equal(byName(r, 'Heading 2').alignFirstLineOnly, true);
});

test('script uses the divided baseline increment', () => {
  const g = computeGrid({ baselineDivisor: 2 });
  const jsx = buildStylesScript(g, computeStyles(g));
  assert.ok(jsx.includes(`"baselineIncrement": "${Math.round(g.baseline.incrementPt * 1e8) / 1e8}pt"`));
});

test('project fonts: Graphik body (Regular/Medium), Montserrat headings (Regular–SemiBold)', () => {
  const g = computeGrid();
  const r = computeStyles(g);
  for (const s of r.styles) {
    if (s.headingLevel) assert.equal(s.appliedFont, 'Montserrat');
    else assert.deepEqual([s.appliedFont, s.fontStyle], ['Graphik', 'Regular']);
  }
  assert.equal(byName(r, 'Heading 1').fontStyle, 'SemiBold');
  assert.equal(byName(r, 'Heading 3').fontStyle, 'Medium');

  const m = computeStyles(g, { bodyFontStyle: 'Medium', headingFontStyles: { 2: 'Regular' } });
  assert.ok(m.styles.filter((s) => !s.headingLevel).every((s) => s.fontStyle === 'Medium'));
  assert.equal(byName(m, 'Heading 2').fontStyle, 'Regular');
  assert.equal(byName(m, 'Heading 1').fontStyle, 'SemiBold'); // untouched levels keep defaults
});

test('disallowed weights fall back to defaults', () => {
  const r = computeStyles(computeGrid(), { bodyFontStyle: 'Bold', headingFontStyles: { 1: 'Bold', 2: 'Black', 3: 'Semibold' } });
  assert.ok(r.styles.filter((s) => !s.headingLevel).every((s) => s.fontStyle === 'Regular'));
  assert.deepEqual([1, 2, 3].map((l) => byName(r, `Heading ${l}`).fontStyle), ['SemiBold', 'SemiBold', 'Medium']);
});
