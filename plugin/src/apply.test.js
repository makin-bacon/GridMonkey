// Runs the plugin's InDesign code against a small fake DOM that records what it sets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGrid } from '../../src/core/grid.js';
import { computeStyles } from '../../src/core/styles.js';
import { applyToDocument, runUndoable, GUIDE_LABEL, PREVIEW_UNDO, APPLY_UNDO } from './apply.js';
import { createPreview } from './preview.js';

const enumProxy = (prefix) => new Proxy({}, { get: (_, k) => `${prefix}.${String(k)}` });
const id = new Proxy({}, { get: (_, k) => enumProxy(String(k)) });

function coll(items = [], make = () => ({})) {
  return {
    items,
    get length() { return items.length; },
    item: (i) => items[i],
    itemByName: (n) => items.find((x) => x.name === n) ?? { isValid: false },
    add(arg1, arg2) {
      const props = (arg2 ?? (arg1 && !arg1.isLayer ? arg1 : {})) || {};
      const x = { isValid: true, ...make(), ...props, layer: arg1?.isLayer ? arg1 : undefined };
      x.remove = () => items.splice(items.indexOf(x), 1);
      items.push(x);
      return x;
    },
  };
}
const styleItem = () => ({ bulletChar: {}, paragraphStyles: coll([], styleItem), characterStyles: coll() });
const page = () => ({ marginPreferences: {}, guides: coll() });

function fakeDoc({ widthPt = 595.2756, heightPt = 841.8898, facing = true, parentPages = 2, pages = 3 } = {}) {
  const undo = [];
  return {
    id: 7,
    zeroPoint: [10, 10],
    documentPreferences: { pageWidth: widthPt, pageHeight: heightPt, facingPages: facing },
    gridPreferences: {},
    guidePreferences: {},
    marginPreferences: {},
    pages: coll(Array.from({ length: pages }, page)),
    masterSpreads: coll([{ pages: coll(Array.from({ length: parentPages }, page)) }]),
    layers: coll([], () => ({ isLayer: true })),
    activeLayer: { isLayer: true, name: 'Layer 1' },
    paragraphStyleGroups: coll([], styleItem),
    paragraphStyles: coll([{ name: '[No Paragraph Style]' }]),
    numberingLists: coll(),
    characterStyleGroups: coll([], styleItem),
    swatches: coll([{ name: 'Paper' }]),
    undoStack: undo,
    get undoName() { return undo.at(-1) ?? ''; },
    undo() { undo.pop(); },
  };
}
function fakeApp(doc) {
  return {
    scriptPreferences: { measurementUnit: 'AUTO' },
    fonts: { itemByName: (n) => ({ isValid: /^(Graphik|Montserrat)\t/.test(n) }) },
    doScript(fn, lang, args, mode, name) { fn(); doc.undoStack.push(name); },
  };
}

const setup = (gridInput = {}, docOpts = {}) => {
  const doc = fakeDoc(docOpts);
  const deps = { app: fakeApp(doc), id };
  const grid = computeGrid(gridInput);
  return { doc, deps, grid, styles: computeStyles(grid) };
};
const pt = (mm) => mm / (25.4 / 72);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

test('grid preferences use InDesign semantics, in points', () => {
  const { doc, deps, grid, styles } = setup({ baselineDivisor: 2 });
  const r = applyToDocument(deps, doc, grid, styles);
  const gp = doc.gridPreferences;
  close(gp.horizontalGridlineDivision, pt(grid.grid.unitMm)); // spacing across
  close(gp.verticalGridlineDivision, pt(grid.grid.leadingMm)); // spacing down
  close(gp.baselineDivision, grid.baseline.incrementPt);
  assert.equal(gp.verticalGridSubdivision, 2);
  assert.equal(gp.horizontalGridSubdivision, 1);
  assert.equal(gp.baselineGridShown, true);
  assert.equal(doc.guidePreferences.guidesShown, true);
  assert.deepEqual(doc.zeroPoint, [10, 10], 'zero point restored');
  assert.equal(deps.app.scriptPreferences.measurementUnit, 'AUTO', 'units restored');
  assert.deepEqual(r.warnings, []);
});

test('margins go on defaults, every parent page and every page', () => {
  const { doc, deps, grid, styles } = setup();
  applyToDocument(deps, doc, grid, styles);
  const all = [doc.marginPreferences, ...doc.masterSpreads.item(0).pages.items.map((p) => p.marginPreferences), ...doc.pages.items.map((p) => p.marginPreferences)];
  for (const mp of all) {
    close(mp.top, pt(grid.margins.top));
    close(mp.left, pt(grid.margins.inside));
    close(mp.right, pt(grid.margins.outside));
    assert.equal(mp.columnCount, 12);
  }
});

test('guides are replaced, not duplicated, when applied again', () => {
  const { doc, deps, grid, styles } = setup({ capHeight: 2.5 });
  applyToDocument(deps, doc, grid, styles);
  applyToDocument(deps, doc, grid, styles);
  const p = doc.masterSpreads.item(0).pages.item(0);
  const expectedRows = 2 * (grid.rows.number - 1);
  const ours = p.guides.items.filter((g) => g.label === GUIDE_LABEL);
  assert.equal(ours.length, expectedRows + grid.imageLines.repeatCount + 1);
  assert.equal(doc.layers.items.length, 1, 'one Image-lines layer');
  assert.equal(doc.layers.items[0].printable, false);
});

test('styles are created once, with fonts, Next Style and lists', () => {
  const { doc, deps, grid, styles } = setup();
  applyToDocument(deps, doc, grid, styles, { styles: true });
  applyToDocument(deps, doc, grid, styles, { styles: true });
  assert.equal(doc.paragraphStyleGroups.items.length, 1);
  const group = doc.paragraphStyleGroups.items[0];
  assert.equal(group.paragraphStyles.items.length, styles.styles.length);
  const by = (n) => group.paragraphStyles.itemByName(n);
  assert.equal(by('Heading 1').appliedFont, 'Montserrat');
  assert.equal(by('Heading 1').nextStyle, by('Body First'));
  assert.equal(by('Bullet 1').bulletChar.characterValue, 0x2022);
  assert.equal(by('Number 2').numberingLevel, 2);
  close(by('Body').leading, grid.type.correctedLeadingPt);
  const cg = doc.characterStyleGroups.items;
  assert.equal(cg.length, 1);
  assert.deepEqual(cg[0].characterStyles.items.map((c) => c.name), ['Medium', 'White']);
  assert.equal(cg[0].characterStyles.itemByName('Medium').fontStyle, 'Medium');
  assert.equal(cg[0].characterStyles.itemByName('White').fillColor.name, 'Paper');
});

test('page size mismatch warns unless matching is on', () => {
  const { doc, deps, grid, styles } = setup({}, { widthPt: 600 });
  assert.equal(applyToDocument(deps, doc, grid, styles).warnings.length, 1);
  const r = applyToDocument(deps, doc, grid, styles, { pageSize: true });
  assert.equal(r.resized, true);
  close(doc.documentPreferences.pageWidth, pt(210));
});

test('runUndoable groups into one named step, or falls back', () => {
  const { doc, deps } = setup();
  assert.equal(runUndoable(deps, 'X', () => ({ a: 1 })).grouped, true);
  assert.equal(doc.undoName, 'X');
  const noGroup = { app: { doScript() { throw new Error('unsupported'); } }, id };
  const r = runUndoable(noGroup, 'Y', () => ({ a: 2 }));
  assert.deepEqual([r.a, r.grouped], [2, false]);
});

test('preview replaces itself, reverts, and never undoes the user’s own steps', () => {
  const { doc, deps, grid, styles } = setup();
  const p = createPreview(deps, { getDoc: () => doc, apply: (d) => applyToDocument(deps, d, grid, styles) });
  p.update();
  p.update();
  assert.deepEqual(doc.undoStack, [PREVIEW_UNDO], 'second preview replaced the first');
  p.revert();
  assert.deepEqual(doc.undoStack, []);
  p.update();
  doc.undoStack.push('Typing'); // user edits after previewing
  p.revert();
  assert.deepEqual(doc.undoStack, [PREVIEW_UNDO, 'Typing'], 'user step untouched');
  doc.undoStack.length = 0;
  p.update();
  p.commit();
  assert.deepEqual(doc.undoStack, [APPLY_UNDO], 'apply swaps the preview for a permanent step');
});

test('trimOverset finds the main story and trims whole paragraphs, not ending on a heading', async () => {
  const { trimOverset } = await import('./apply.js');
  const fits = 4; // fits [H1, B, B, H2] — the trailing H2 must then be dropped
  const paras = ['Heading 1', 'Body', 'Body', 'Heading 2', 'Body', 'Body', 'Heading 3', 'Body'].map((style, i) => {
    const p = { appliedParagraphStyle: { name: style }, contents: `para ${i}` };
    p.remove = () => paras.splice(paras.indexOf(p), 1);
    return p;
  });
  const story = {
    characters: { length: 900 },
    paragraphs: { get length() { return paras.length; }, lastItem: () => paras.at(-1) },
    get overflows() { return paras.length > fits; },
  };
  const tiny = { characters: { length: 1 }, paragraphs: { length: 1 }, overflows: false };
  const doc = { stories: { length: 2, item: (i) => [tiny, story][i] } };
  const r = trimOverset(doc);
  assert.equal(r.overset, false);
  assert.equal(paras.length, 3, 'para 3 (a heading) dropped after trimming to fit');
  assert.ok(!paras.at(-1).appliedParagraphStyle.name.startsWith('Heading'));
});

test('openFile falls back from a native path to the file entry', async () => {
  const { openFile } = await import('./apply.js');
  const doc = { pages: {} };
  const app = { open: (arg) => { if (typeof arg === 'string') throw new Error('Invalid parameter'); return doc; } };
  assert.equal(openFile(app, { nativePath: '/tmp/x.idml' }), doc);
  assert.throws(() => openFile({ open: () => { throw new Error('nope'); } }, { nativePath: '/x' }), /nope/);
});

test('rows can be switched off: one full-height row and no row guides', () => {
  const { doc, deps } = setup();
  const grid = computeGrid({ rows: 1, vertical: { gutter: 0 } });
  assert.equal(grid.ok, true);
  applyToDocument(deps, doc, grid, computeStyles(grid));
  const ours = doc.masterSpreads.item(0).pages.item(0).guides.items.filter((g) => g.label === GUIDE_LABEL);
  assert.equal(ours.length, 0);
  close(grid.rows.height, grid.input.pageHeight - grid.margins.top - grid.margins.bottom);
});
