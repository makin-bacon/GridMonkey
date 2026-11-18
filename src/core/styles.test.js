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

test('Based On: H1 on Body, H2/H3 on Heading 1, everything else on Body', () => {
  const s = computeStyles(computeGrid({}), { separation: 'indent' });
  const based = Object.fromEntries(s.styles.map((x) => [x.name, x.basedOn]));
  assert.equal(based.Body, null);
  assert.equal(based['Heading 1'], 'Body');
  assert.equal(based['Heading 2'], 'Heading 1');
  assert.equal(based['Heading 3'], 'Heading 1');
  for (const n of ['Body First', 'Bullet 1', 'Bullet 2', 'Number 1', 'Number 2']) assert.equal(based[n], 'Body');
  // Parents come before children so the script and plugin can link them.
  s.styles.forEach((x, i) => x.basedOn && assert.ok(s.styles.findIndex((y) => y.name === x.basedOn) < i));
});

test('heading space after can be switched per level', () => {
  for (const divisor of [1, 2, 4]) {
    const grid = computeGrid({ baselineDivisor: divisor });
    const lead = grid.grid.leadingMm;
    const on = computeStyles(grid, { headingSpaceAfter: { 1: true, 2: true, 3: true } });
    const off = computeStyles(grid, { headingSpaceAfter: { 1: false, 2: false, 3: false } });
    for (const n of ['Heading 1', 'Heading 2', 'Heading 3']) {
      const a = byName(on, n).spaceAfter;
      const b = byName(off, n).spaceAfter;
      assert.ok(a > b, `${n} ÷${divisor}: on > off`);
      assert.ok(b < lead - 1e-9, `${n} ÷${divisor}: off adds less than a line`);
      if (divisor === 1) { assert.equal(b, 0); assert.ok(Math.abs(a - lead) < 1e-9); }
      // Before + leading + after stays whole lines on a fine grid.
      if (divisor > 1) {
        const s = byName(off, n);
        const block = s.spaceBefore + mmToPtInv(s.leading) + s.spaceAfter;
        assert.ok(isMultiple(block, lead), `${n} ÷${divisor}: whole lines`);
      }
    }
  }
  // Default: H1 and H2 on, H3 off.
  const d = computeStyles(computeGrid({}));
  assert.equal(byName(d, 'Heading 3').spaceAfter, 0);
  assert.ok(byName(d, 'Heading 2').spaceAfter > 0);
});
const mmToPtInv = (p) => (p * 25.4) / 72;

test('half-line space after: Body exact, headings padded to whole lines, warning on ÷1', () => {
  for (const divisor of [2, 4]) {
    const grid = computeGrid({ baselineDivisor: divisor });
    const lead = grid.grid.leadingMm;
    const r = computeStyles(grid, { separation: 'space', bodySpaceAfter: 0.5, headingSpaceAfter: { 1: 0.5, 2: 0.5, 3: 0.5 } });
    assert.ok(Math.abs(byName(r, 'Body').spaceAfter - lead / 2) < 1e-9, `÷${divisor}: Body ½ line`);
    assert.equal(r.warnings.some((w) => w.includes('½-line')), false);
    for (const n of ['Heading 1', 'Heading 2', 'Heading 3']) {
      const s = byName(r, n);
      assert.ok(s.spaceAfter >= lead / 2 - 1e-9, `${n} ÷${divisor}: at least ½ line`);
      assert.ok(isMultiple(s.spaceBefore + mmToPtInv(s.leading) + s.spaceAfter, lead), `${n} ÷${divisor}: whole lines`);
    }
  }
  const one = computeStyles(computeGrid({ baselineDivisor: 1 }), { bodySpaceAfter: 0.5 });
  assert.ok(one.warnings.some((w) => w.includes('½-line') && w.includes('Body')));
  // Legacy booleans still work; Body's space after follows separation when unset.
  const legacy = computeStyles(computeGrid({}), { headingSpaceAfter: { 1: true, 2: false, 3: false }, separation: 'indent' });
  assert.deepEqual([legacy.options.headingSpaceAfter[1], legacy.options.headingSpaceAfter[2]], [1, 0]);
  assert.equal(byName(legacy, 'Body').spaceAfter, 0);
  assert.equal(computeStyles(computeGrid({}), { separation: 'space' }).options.bodySpaceAfter, 1);
});

test('align first line only: automatic by divisor, overridable per style', () => {
  const auto1 = computeStyles(computeGrid({ baselineDivisor: 1 }));
  const auto2 = computeStyles(computeGrid({ baselineDivisor: 2 }));
  assert.equal(byName(auto1, 'Body').alignFirstLineOnly, false);
  assert.equal(byName(auto1, 'Heading 1').alignFirstLineOnly, true);
  assert.equal(byName(auto2, 'Heading 1').alignFirstLineOnly, false);

  const grid = computeGrid({ baselineDivisor: 2 });
  const r = computeStyles(grid, { separation: 'indent', firstLineOnly: { body: true, 2: true } });
  for (const n of ['Body', 'Body First', 'Bullet 1', 'Number 2', 'Heading 2']) assert.equal(byName(r, n).alignFirstLineOnly, true, n);
  assert.equal(byName(r, 'Heading 1').alignFirstLineOnly, false);
  assert.deepEqual(r.options.firstLineOnly, { body: true, 1: false, 2: true, 3: false });

  // On ÷1, all-lines headings use whole-line leading; first-line-only allows half lines.
  const g1 = computeGrid({ baselineDivisor: 1 });
  const lead = g1.type.correctedLeadingPt;
  const all = computeStyles(g1, { firstLineOnly: { 1: false, 2: false, 3: false } });
  for (const n of ['Heading 1', 'Heading 2', 'Heading 3']) assert.ok(isMultiple(byName(all, n).leading, lead), n);
});

test('hyphenation is off in every style', () => {
  for (const separation of ['indent', 'space']) {
    const r = computeStyles(computeGrid({}), { separation });
    for (const s of r.styles) assert.equal(s.hyphenation, false, s.name);
  }
});

test('space after lists: on the list styles, items of one style stay tight', () => {
  const grid = computeGrid({ baselineDivisor: 2 });
  const lead = grid.grid.leadingMm;
  const none = computeStyles(grid);
  for (const n of ['Bullet 1', 'Bullet 2', 'Number 1', 'Number 2']) {
    assert.equal(byName(none, n).spaceAfter, 0);
    assert.equal(byName(none, n).sameParaStyleSpacing, null);
  }
  for (const v of [0.5, 1]) {
    const r = computeStyles(grid, { listSpaceAfter: v });
    assert.equal(r.options.listSpaceAfter, v);
    for (const n of ['Bullet 1', 'Bullet 2', 'Number 1', 'Number 2']) {
      assert.ok(Math.abs(byName(r, n).spaceAfter - v * lead) < 1e-9, n);
      assert.equal(byName(r, n).sameParaStyleSpacing, 0, n);
    }
    assert.equal(byName(r, 'Body').sameParaStyleSpacing, undefined);
  }
  const one = computeStyles(computeGrid({ baselineDivisor: 1 }), { listSpaceAfter: 0.5 });
  assert.ok(one.warnings.some((w) => w.includes('Lists')));
  // Written to the .jsx too.
  assert.match(buildStylesScript(grid, computeStyles(grid, { listSpaceAfter: 1 })), /sameParaStyleSpacing/);
});
