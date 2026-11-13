import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGrid, validMarginTotals, ptToMm, mmToPt } from './grid.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('pt/mm conversion round-trips', () => {
  close(ptToMm(72), 25.4);
  close(mmToPt(ptToMm(13)), 13);
});

test('validMarginTotals leaves whole-unit tracks', () => {
  const opts = validMarginTotals(46, 12, 1);
  assert.deepEqual(opts, [11, 23]);
  for (const m of opts) assert.equal((46 - m - 11) % 12, 0);
});

test('A4 defaults produce an on-grid layout', () => {
  const r = computeGrid();
  assert.equal(r.ok, true);
  assert.equal(r.grid.lines, 65);
  assert.equal(r.grid.hUnits, 46);
  close(r.grid.leadingMm * 65, 297);
  close(r.grid.unitMm * 46, 210);

  // Horizontal: margins + columns + gutters fill the page width exactly
  const { margins, columns, rows } = r;
  close(margins.inside + margins.outside + columns.number * columns.width + (columns.number - 1) * columns.gutter, 210, 1e-6);
  close(margins.top + margins.bottom + rows.number * rows.height + (rows.number - 1) * rows.gutter, 297, 1e-6);
  assert.ok(Number.isInteger(columns.widthUnits));
  assert.ok(Number.isInteger(rows.heightLines));
});

test('invalid margin request snaps to nearest valid option', () => {
  const r = computeGrid({ horizontal: { margins: 14 } });
  assert.equal(r.allocation.horizontal.total, 11);
});

test('inside/top split is respected and clamped', () => {
  const r = computeGrid({ horizontal: { margins: 11, inside: 4 }, vertical: { margins: 10, top: 99 } });
  assert.equal(r.allocation.horizontal.inside, 4);
  assert.equal(r.allocation.horizontal.outside, 7);
  assert.equal(r.allocation.vertical.top, 9);
  assert.equal(r.allocation.vertical.bottom, 1);
});

test('proportion flag', () => {
  assert.equal(computeGrid({ fontSize: 10, leading: 13 }).type.proportionOk, true);
  assert.equal(computeGrid({ fontSize: 10, leading: 10 }).type.proportionOk, false);
});

test('image lines', () => {
  const r = computeGrid({ capHeight: 2.5 });
  close(r.imageLines.firstY, r.margins.top + r.grid.leadingMm - 2.5);
  assert.equal(r.imageLines.repeatCount, r.rows.number - 1);
  close(r.imageLines.offsetVertical, r.rows.height + r.rows.gutter);
  assert.equal(computeGrid().imageLines, null);
});

test('impossible layouts report errors', () => {
  const r = computeGrid({ columns: 40, horizontal: { gutter: 2 } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.startsWith('Columns')));
  assert.equal(computeGrid({ pageWidth: -1 }).ok, false);
});

test('baseline divisor halves the increment only', () => {
  const g1 = computeGrid();
  for (const d of [2, 4]) {
    const g = computeGrid({ baselineDivisor: d });
    close(g.baseline.increment, g1.baseline.increment / d);
    close(g.baseline.start, g1.baseline.start); // start stays on a full line
    assert.equal(g.documentGrid.verticalSubdivisions, d);
    assert.equal(g.documentGrid.horizontalSubdivisions, 1);
    close(g.margins.top, g1.margins.top); // grid allocation unaffected
  }
  assert.equal(computeGrid({ baselineDivisor: 3 }).ok, false);
});

test('UI version matches package.json and is an alpha', async () => {
  const { VERSION } = await import('./version.js');
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url)));
  assert.equal(VERSION, pkg.version);
  assert.match(VERSION, /-alpha/);
});

test('document grid uses InDesign semantics and every margin lands on a gridline', () => {
  for (const input of [{}, { pageWidth: 230, pageHeight: 300, leading: 12.5 }, { baselineDivisor: 4 }]) {
    const g = computeGrid(input);
    const { horizontalEvery: across, verticalEvery: down } = g.documentGrid;
    close(across, g.grid.unitMm); // "Horizontal" = spacing across the page
    close(down, g.grid.leadingMm); // "Vertical" = spacing down the page
    const whole = (v, step) => Math.abs(v / step - Math.round(v / step)) < 1e-9;
    assert.ok(whole(g.margins.top, down) && whole(g.margins.bottom, down), 'top/bottom on horizontal gridlines');
    assert.ok(whole(g.margins.inside, across) && whole(g.margins.outside, across), 'inside/outside on vertical gridlines');
    assert.ok(whole(g.columns.width, across) && whole(g.columns.gutter, across), 'columns on vertical gridlines');
    assert.ok(whole(g.rows.height, down) && whole(g.rows.gutter, down), 'rows on horizontal gridlines');
    assert.ok(whole(g.baseline.start, down / g.baseline.divisor) && whole(down, g.baseline.increment), 'baselines on the grid');
  }
});
