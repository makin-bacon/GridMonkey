import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeGrid } from './grid.js';
import { computeStyles } from './styles.js';
import { computeDocument, FORMATS, textColumns } from './document.js';
import { buildIdml, buildIdmlFiles, paragraphStyleId } from './idml.js';
import { zipStore, crc32 } from './zip.js';

const have = (cmd) => { try { execFileSync('which', [cmd]); return true; } catch { return false; } };
const setup = (format, gridInput = {}) => {
  const grid = computeGrid(gridInput);
  const styles = computeStyles(grid);
  const doc = computeDocument(grid, styles, format);
  return { grid, styles, doc };
};

test('crc32 known value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('zip: mimetype first, stored, readable by unzip', { skip: !have('unzip') }, () => {
  const { grid, styles, doc } = setup('facing4');
  const bytes = buildIdml(grid, styles, doc);
  assert.equal(new TextDecoder().decode(bytes.slice(30, 38)), 'mimetype');
  assert.equal(new TextDecoder().decode(bytes.slice(38, 38 + 43)), 'application/vnd.adobe.indesign-idml-package');
  const dir = mkdtempSync(join(tmpdir(), 'gm-'));
  try {
    const file = join(dir, 'a.idml');
    writeFileSync(file, bytes);
    const out = execFileSync('unzip', ['-t', file]).toString();
    assert.match(out, /No errors detected/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('zipStore round-trips a simple archive', { skip: !have('unzip') }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'gm-'));
  try {
    const file = join(dir, 'b.zip');
    writeFileSync(file, zipStore([{ path: 'a.txt', data: 'hello' }, { path: 'dir/b.txt', data: 'wörld' }]));
    assert.equal(execFileSync('unzip', ['-p', file, 'dir/b.txt']).toString(), 'wörld');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const { id, pages, facing } of FORMATS) {
  test(`${id}: every XML part is well-formed`, { skip: !have('xmllint') }, () => {
    const { grid, styles, doc } = setup(id, { capHeight: 2.5, baselineDivisor: 2 });
    const files = buildIdmlFiles(grid, styles, doc);
    for (const f of files.filter((x) => x.path.endsWith('.xml'))) {
      execFileSync('xmllint', ['--noout', '-'], { input: f.data }); // throws on malformed XML
    }
  });

  test(`${id}: pages, spreads and threading`, () => {
    const { doc, grid } = setup(id);
    assert.equal(doc.pages.length, pages);
    assert.equal(doc.format.facing, facing);
    assert.equal(doc.spreads.flat().length, pages);
    // frames stay inside the margins of their page
    for (const f of doc.frames) {
      const side = doc.pages[f.page].side;
      const left = side === 'verso' ? grid.margins.outside : grid.margins.inside;
      assert.ok(Math.abs(f.x - left) < 1e-9);
      assert.ok(f.y >= grid.margins.top - 1e-9);
      assert.ok(Math.abs(f.y + f.h - (doc.pageHeight - grid.margins.bottom)) < 1e-9);
    }
    const files = buildIdmlFiles(...Object.values(setup(id)));
    const spreads = files.filter((f) => f.path.startsWith('Spreads/')).map((f) => f.data).join('\n');
    for (let i = 0; i < pages; i++) {
      assert.match(spreads, new RegExp(`Self="uFrame${i}" ParentStory="uStory" PreviousTextFrame="${i ? `uFrame${i - 1}` : 'n'}" NextTextFrame="${i < pages - 1 ? `uFrame${i + 1}` : 'n'}"`));
    }
    const master = files.find((f) => f.path.startsWith('MasterSpreads/')).data;
    assert.equal((master.match(/<Page /g) || []).length, facing ? 2 : 1);
    if (facing) assert.match(master, /Self="uMasterFrame0" ParentStory="uMasterStory" PreviousTextFrame="n" NextTextFrame="uMasterFrame1"/);
  });
}

test('facing spreads: page 1 alone on the right, then pairs', () => {
  const { doc } = setup('facing4');
  assert.deepEqual(doc.spreads, [[0], [1, 2], [3]]);
  assert.deepEqual(doc.pages.map((p) => p.side), ['recto', 'verso', 'recto', 'verso']);
});

test('grids and guides are switched on; units and baseline match the grid', () => {
  const { grid, styles, doc } = setup('single', { baselineDivisor: 2 });
  const prefs = buildIdmlFiles(grid, styles, doc).find((f) => f.path === 'Resources/Preferences.xml').data;
  for (const a of ['GuidesShown="true"', 'DocumentGridShown="true"', 'BaselineGridShown="true"', 'SmartTextReflow="true"', 'HorizontalMeasurementUnits="Millimeters"']) {
    assert.ok(prefs.includes(a), a);
  }
  assert.ok(prefs.includes(`BaselineDivision="${Math.round(grid.baseline.incrementPt * 1e8) / 1e8}"`));
  assert.ok(prefs.includes('VerticalGridSubdivision="2"') && prefs.includes('HorizontalGridSubdivision="1"'));
  // Horizontal = spacing across (grid unit); Vertical = spacing down (leading)
  const ptOf = (mm) => String(Math.round((mm / (25.4 / 72)) * 1e8) / 1e8);
  assert.ok(prefs.includes(`HorizontalGridlineDivision="${ptOf(grid.grid.unitMm)}"`));
  assert.ok(prefs.includes(`VerticalGridlineDivision="${ptOf(grid.grid.leadingMm)}"`));
});

test('every style used in the story is defined', () => {
  const { grid, styles, doc } = setup('facing4');
  const files = buildIdmlFiles(grid, styles, doc);
  const defined = files.find((f) => f.path === 'Resources/Styles.xml').data;
  const used = new Set(doc.story.map(([s]) => s));
  for (const s of used) assert.ok(defined.includes(`Self="${paragraphStyleId(styles.group, s)}"`), s);
  assert.ok(used.has('Heading 1') && used.has('Bullet 2') && used.has('Number 2'));
});

test('text frame columns divide the grid and stay readable', () => {
  const g = computeGrid();
  const d = textColumns(g);
  assert.equal(g.columns.number % d, 0);
  assert.equal(d, 2); // A4 12-col default → 2 text columns of 6 grid columns
});

test('image placeholder sits on the first image-line and ends on a row edge', () => {
  const { doc, grid } = setup('single', { capHeight: 2.5 });
  close(doc.image.y, grid.imageLines.firstY);
  close(doc.image.y + doc.image.h, grid.margins.top + 2 * grid.rows.height + grid.rows.gutter);
  close(doc.frames[0].y, doc.image.y + doc.image.h + grid.rows.gutter);
});

test('dummy copy grows with the document', () => {
  const chars = (id) => setup(id).doc.story.reduce((n, [, t]) => n + t.length, 0);
  assert.ok(chars('facing4') > chars('double') && chars('double') > chars('single'));
});

function close(a, b, eps = 1e-6) { assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`); }

test('fitStory trims to whole paragraphs and drops stranded headings', async () => {
  const { fitStory } = await import('./document.js');
  const { doc } = setup('single');
  const headingAt = doc.story.findIndex(([s], i) => i > 0 && s.startsWith('Heading'));
  const trimmed = fitStory(doc, headingAt + 1); // would end on a heading
  assert.equal(trimmed.story.length, headingAt);
  assert.ok(!trimmed.story.at(-1)[0].startsWith('Heading'));
  assert.equal(fitStory(doc, 0).story.length, 1);
});
