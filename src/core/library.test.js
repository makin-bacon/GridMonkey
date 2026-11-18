import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGrid } from './grid.js';
import { computeStyles } from './styles.js';
import { computeDocument, emptyDocument } from './document.js';
import { buildIdmlFiles } from './idml.js';
import { LIBRARY, resolveLibrary, findLibraryStyle } from './library.js';
import { SWATCHES } from './swatches.js';
import { HOUSE_GRID, HOUSE_STYLES } from './presets.js';

// The reference document's grid: 7.8 / 10 pt (corrected 10.022 pt), ÷4, A4, 12 columns.
const SOURCE_GRID = { ...HOUSE_GRID, fontSize: 7.8, leading: 10, baselineDivisor: 4 };
const close = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;

test('library has every custom style from the reference document', () => {
  const names = (k) => LIBRARY[k].map((s) => s.name);
  assert.deepEqual(names('paragraph').sort(), ['BODY-8pt/10.524pt', 'COURSE-TABLE-HEAD', 'GridMonkey:Body-qtr-space',
    'GridMonkey:Pathway-lozenge', 'GridMonkey:QR-Block-Style', 'GridMonkey:Table-vertical-rhythm', 'TABLE-8pt/12.027pt NO-BASELINE'].sort());
  assert.deepEqual(names('character').sort(), ['Course-QR-Text', 'Pathway-Glyp-Baseline']);
  assert.deepEqual(names('table'), ['COURSE-BLOCK']);
  assert.deepEqual(names('cell'), ['BOTTOM-ROW']);
  // GridMonkey's own styles are generated, never imported twice.
  for (const k of ['paragraph', 'character']) for (const n of ['GridMonkey:Body', 'GridMonkey:Heading 1', 'GridMonkey:Medium']) assert.ok(!names(k).includes(n));
});

test('on the source grid the styles come back at their original values', () => {
  const lib = resolveLibrary(computeGrid(SOURCE_GRID));
  const p = (n) => findLibraryStyle(lib, 'paragraph', n).attrs;
  assert.equal(findLibraryStyle(lib, 'paragraph', 'COURSE-TABLE-HEAD').attrs.PointSize, 7.5);
  assert.equal(findLibraryStyle(lib, 'character', 'Course-QR-Text').attrs.PointSize, 6.5);
  assert.ok(close(p('QR-Block-Style').SpaceBefore, 12.5281)); // 1.25 lines
  assert.ok(close(p('QR-Block-Style').LeftIndent, 36.3685));
  assert.ok(close(p('Pathway-lozenge').LeftIndent, 56.6929)); // 20 mm
  assert.ok(close(p('Pathway-lozenge').BaselineShift, -2.5));
  assert.ok(close(findLibraryStyle(lib, 'cell', 'BOTTOM-ROW').attrs.BottomInset, 15.0236));
  // Legacy styles from older grids snap onto this one: ¼-line spacing, body size.
  assert.equal(p('BODY-8pt/10.524pt').PointSize, 7.8);
  assert.ok(close(p('GridMonkey:Body-qtr-space').SpaceAfter, 10.0225 / 4));
});

test('styles scale with the type and the grid', () => {
  const a = computeGrid(SOURCE_GRID);
  const b = computeGrid({ ...SOURCE_GRID, fontSize: 10, leading: 13, baselineDivisor: 2, horizontal: { margins: 12, inside: 7, gutter: 1 } });
  assert.ok(b.ok, b.errors?.join(' '));
  const [la, lb] = [resolveLibrary(a), resolveLibrary(b)];
  const ratio = (kind, name, key) => findLibraryStyle(lb, kind, name).attrs[key] / findLibraryStyle(la, kind, name).attrs[key];
  const lead = b.type.correctedLeadingPt / a.type.correctedLeadingPt;
  const unit = b.grid.unitMm / a.grid.unitMm;
  assert.ok(close(ratio('paragraph', 'QR-Block-Style', 'SpaceBefore'), lead, 1e-6)); // lines
  assert.ok(close(ratio('paragraph', 'Pathway-lozenge', 'LeftIndent'), unit, 1e-6)); // units
  assert.ok(close(ratio('paragraph', 'Pathway-lozenge', 'BaselineShift'), 10 / 7.8, 1e-6)); // size
  assert.ok(close(ratio('cell', 'BOTTOM-ROW', 'TopInset'), lead, 1e-6));
  assert.equal(findLibraryStyle(lb, 'paragraph', 'COURSE-TABLE-HEAD').attrs.PointSize, 9.6); // 7.5 × 10/7.8, 0.1 pt
  assert.equal(findLibraryStyle(lb, 'table', 'COURSE-BLOCK').attrs.TopBorderStrokeWeight, '0.5'); // strokes fixed
});

test('the IDML packages the library: groups, ids, unit properties, known colours', () => {
  const grid = computeGrid(HOUSE_GRID);
  const styles = computeStyles(grid, HOUSE_STYLES);
  const xml = buildIdmlFiles(grid, styles, emptyDocument(computeDocument(grid, styles, 'facing4'))).find((f) => f.path === 'Resources/Styles.xml').data;
  // Grouped ones sit in the GridMonkey group, after GridMonkey's own Body.
  const group = xml.match(/<ParagraphStyleGroup [\s\S]*?<\/ParagraphStyleGroup>/)[0];
  assert.ok(group.indexOf('GridMonkey%3aBody"') < group.indexOf('GridMonkey%3aPathway-lozenge"'));
  assert.match(group, /Name="GridMonkey:QR-Block-Style"/);
  assert.match(xml, /<ParagraphStyle Self="ParagraphStyle\/COURSE-TABLE-HEAD"/);
  assert.match(xml, /<CharacterStyle Self="CharacterStyle\/Course-QR-Text"/);
  assert.match(xml, /<RootCellStyleGroup [\s\S]*Name="BOTTOM-ROW"[\s\S]*<\/RootCellStyleGroup>/);
  assert.match(xml, /<RootTableStyleGroup [\s\S]*Name="\$ID\/\[No table style\]"[\s\S]*Name="COURSE-BLOCK"[\s\S]*<\/RootTableStyleGroup>/);
  assert.match(xml, /<SameParaStyleSpacing type="unit">[\d.]+<\/SameParaStyleSpacing>/);
  assert.match(xml, /ParagraphShadingOn="true"/);
  assert.equal((xml.match(/Name="GridMonkey:Body"/g) ?? []).length, 1);
  // Every colour the library uses exists in Graphic.xml.
  const known = new Set(['Black', 'Paper', 'Registration', ...SWATCHES.map((s) => s.name)]);
  for (const c of LIBRARY.colours) assert.ok(known.has(c), c);
  // And it can be left out.
  const without = buildIdmlFiles(grid, styles, emptyDocument(computeDocument(grid, styles, 'single')), { library: false }).find((f) => f.path === 'Resources/Styles.xml').data;
  assert.doesNotMatch(without, /COURSE-TABLE-HEAD|RootTableStyleGroup/);
});

test('QR-Code object style: 4 units square, text wrap 1 unit on the right, scales with the grid', () => {
  for (const input of [SOURCE_GRID, { ...SOURCE_GRID, fontSize: 10, leading: 13, baselineDivisor: 2, horizontal: { margins: 12, inside: 7, gutter: 1 } }]) {
    const grid = computeGrid(input);
    const qr = computeStyles(grid, HOUSE_STYLES).objectStyles.find((o) => o.name === 'QR-Code');
    assert.ok(close(qr.width, 4 * grid.grid.unitMm, 1e-9));
    assert.equal(qr.width, qr.height);
    assert.ok(close(qr.textWrap.offset.right, grid.grid.unitMm, 1e-9));
    assert.equal(qr.textWrap.offset.left + qr.textWrap.offset.top + qr.textWrap.offset.bottom, 0);
  }
  const grid = computeGrid(HOUSE_GRID);
  const styles = computeStyles(grid, HOUSE_STYLES);
  const xml = buildIdmlFiles(grid, styles, emptyDocument(computeDocument(grid, styles, 'single'))).find((f) => f.path === 'Resources/Styles.xml').data;
  const group = xml.match(/<RootObjectStyleGroup [\s\S]*?<\/RootObjectStyleGroup>/)[0];
  assert.match(group, /Name="\$ID\/\[None\]"/);
  const qr = group.match(/<ObjectStyle Self="ObjectStyle\/QR-Code"[\s\S]*?<\/ObjectStyle>/)[0];
  for (const a of ['EnableTransformAttributes="true"', 'EnableTextWrapAndOthers="true"', 'EnableFrameFittingOptions="true"', 'TextWrapMode="BoundingBoxTextWrap"', 'FittingOnEmptyFrame="Proportionally"', 'StrokeColor="Swatch/None"']) assert.ok(qr.includes(a), a);
  const w = Number(qr.match(/TransformAttrWidth="([\d.]+)"/)[1]);
  assert.ok(close(w, (4 * grid.grid.unitMm * 72) / 25.4, 1e-6));
});

test('table styles step down the grid rows: no space before, row gutter after', () => {
  const grid = computeGrid(HOUSE_GRID);
  const t = findLibraryStyle(resolveLibrary(grid), 'table', 'COURSE-BLOCK').attrs;
  assert.equal(t.SpaceBefore, 0);
  assert.ok(close(t.SpaceAfter, (grid.rows.gutter * 72) / 25.4, 1e-6));
});
