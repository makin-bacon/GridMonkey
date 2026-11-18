import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeGrid } from './grid.js';
import { computeStyles } from './styles.js';
import { computeDocument, emptyDocument, FORMATS, textColumns } from './document.js';
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
  for (const a of ['GuidesShown="true"', 'DocumentGridShown="false"', 'BaselineGridShown="false"', 'SmartTextReflow="true"', 'HorizontalMeasurementUnits="Millimeters"']) {
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

test('utf8 fallback matches TextEncoder', async () => {
  const { utf8 } = await import('./zip.js');
  const saved = globalThis.TextEncoder;
  const s = 'Grid ÷ 2 – “quotes” 𝄞';
  const native = Array.from(new saved().encode(s));
  try { globalThis.TextEncoder = undefined; assert.deepEqual(Array.from(utf8(s)), native); }
  finally { globalThis.TextEncoder = saved; }
});

test('smart text reflow can be switched off for the plugin', () => {
  const { grid, styles, doc } = setup('single');
  const prefs = (o) => buildIdmlFiles(grid, styles, doc, o).find((f) => f.path === 'Resources/Preferences.xml').data;
  assert.ok(prefs().includes('SmartTextReflow="true"'));
  assert.ok(prefs({ smartTextReflow: false }).includes('SmartTextReflow="false"'));
});

// ---------- folios + house defaults ----------
import { folioGeometry, folioText, EM_SPACE } from './document.js';
import { HOUSE_GRID, HOUSE_STYLES } from './presets.js';

const house = (format = 'facing4', extra = {}) => {
  const grid = computeGrid(HOUSE_GRID);
  const styles = computeStyles(grid, HOUSE_STYLES);
  const doc = computeDocument(grid, styles, format, { folios: true, title: 'Field Notes & Co', ...extra });
  return { grid, styles, doc };
};

test('the reference document (SPREAD-REV-181126) rebuilds exactly (house defaults with 8 inside, ÷4)', () => {
  const grid = computeGrid({ ...HOUSE_GRID, horizontal: { ...HOUSE_GRID.horizontal, inside: 8 }, baselineDivisor: 4 });
  assert.ok(grid.ok);
  assert.deepEqual([grid.allocation.horizontal.total, grid.allocation.horizontal.inside, grid.allocation.horizontal.gutter], [13, 8, 2]);
  assert.deepEqual([grid.allocation.vertical.total, grid.allocation.vertical.top, grid.allocation.vertical.gutter], [13, 6, 1]);
  assert.equal(grid.baseline.divisor, 4);
  // Values from the reference IDML (points).
  const pt = (mm) => (mm * 72) / 25.4;
  const near = (a, b) => Math.abs(a - b) < 1e-3;
  assert.ok(near(grid.type.correctedLeadingPt, 10.02249719));
  assert.ok(near(pt(grid.margins.top), 60.13498313) && near(pt(grid.margins.bottom), 70.15748031));
  assert.ok(near(pt(grid.margins.inside), 80.71533431) && near(pt(grid.margins.outside), 50.44708395));
  assert.ok(near(pt(grid.columns.gutter), 20.17883358));
  assert.equal(grid.rows.number, 3);
  assert.ok(near(pt(grid.margins.top + grid.rows.height), 290.65241845)); // first row guide
});

test('folio: on the baseline grid, inside the bottom margin, as close to centred as the grid allows', () => {
  for (const input of [HOUSE_GRID, {}, { ...HOUSE_GRID, baselineDivisor: 1 }, { ...HOUSE_GRID, baselineDivisor: 4 }]) {
    const grid = computeGrid(input);
    const styles = computeStyles(grid);
    const g = folioGeometry(grid, styles);
    const H = grid.input.pageHeight;
    const inc = grid.baseline.increment;
    const steps = g.baseline / inc;
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9, 'baseline on the grid');
    assert.ok(g.baseline - g.capMm >= H - grid.margins.bottom - 1e-9, 'cap height below the text area');
    assert.ok(g.y + g.h <= H + 1e-9, 'frame on the page');
    assert.ok(Math.abs(g.centreError) <= inc / 2 + 1e-9, 'within half a grid step of centred');
  }
});

test('folio frames match the parent text frames; text order flips by side', () => {
  const { doc } = house();
  doc.folios.frames.forEach((f, i) => {
    assert.equal(f.x, doc.master.frames[i].x);
    assert.equal(f.w, doc.master.frames[i].w);
  });
  assert.equal(folioText('verso', 'T', 4), `4${EM_SPACE}T`);
  assert.equal(folioText('recto', 'T', 5), `T${EM_SPACE}5`);
});

test('IDML folios: page-number marker, Folio style, well-formed', () => {
  const { grid, styles, doc } = house();
  const files = buildIdmlFiles(grid, styles, doc);
  const get = (p) => files.find((f) => f.path === p)?.data;
  assert.match(get('Stories/Story_uFolioStory0.xml'), new RegExp(`<Content><\\?ACE 18\\?>${EM_SPACE}Field Notes &amp; Co</Content>`));
  assert.match(get('Stories/Story_uFolioStory1.xml'), new RegExp(`<Content>Field Notes &amp; Co${EM_SPACE}<\\?ACE 18\\?></Content>`));
  assert.match(get('Resources/Styles.xml'), /Name="GridMonkey:Folio"[^>]*Justification="AwayFromBindingSide"/);
  assert.match(get('designmap.xml'), /StoryList="uStory uMasterStory uFolioStory0 uFolioStory1"/);
  assert.match(get('MasterSpreads/MasterSpread_uMaster.xml'), /FirstBaselineOffset="LeadingOffset"/);
  if (have('xmllint')) for (const f of files) if (f.path !== 'mimetype') execFileSync('xmllint', ['--noout', '-'], { input: f.data });
  // Off by default: no folio parts.
  const plain = buildIdmlFiles(grid, styles, computeDocument(grid, styles, 'facing4'));
  assert.ok(!plain.some((f) => f.path.includes('Folio')));
});

test('single-sided folios use the right-hand format', () => {
  const { doc } = house('single');
  assert.deepEqual(doc.folios.frames.map((f) => f.side), ['single']);
});

// ---------- character styles + swatches ----------
import { SWATCHES } from './swatches.js';

test('character styles: Medium sets only the weight, White only the colour', () => {
  const { grid, styles, doc } = setup('single');
  const xml = buildIdmlFiles(grid, styles, doc).find((f) => f.path === 'Resources/Styles.xml').data;
  const medium = xml.match(/<CharacterStyle [^>]*Name="GridMonkey:Medium"[^>]*>/)[0];
  const white = xml.match(/<CharacterStyle [^>]*Name="GridMonkey:White"[^>]*>/)[0];
  assert.match(medium, /FontStyle="Medium"/);
  assert.doesNotMatch(medium, /FillColor|PointSize|AppliedFont/);
  assert.match(white, /FillColor="Color\/Paper"/);
  assert.doesNotMatch(white, /FontStyle|PointSize|AppliedFont/);
});

test('SCU swatches: 7 CMYK + 7 RGB, prefixed names, exact values', () => {
  const { grid, styles, doc } = setup('single');
  const xml = buildIdmlFiles(grid, styles, doc).find((f) => f.path === 'Resources/Graphic.xml').data;
  assert.equal(SWATCHES.filter((s) => s.space === 'CMYK').length, 7);
  assert.equal(SWATCHES.filter((s) => s.space === 'RGB').length, 7);
  assert.match(xml, /Self="Color\/CMYK-SCU Blue"[^>]*Space="CMYK" ColorValue="95 61 30 8"[^>]*Name="CMYK-SCU Blue"/);
  assert.match(xml, /Self="Color\/RGB-SCU Dark"[^>]*Space="RGB" ColorValue="20 0 64"[^>]*Name="RGB-SCU Dark"/);
  for (const s of SWATCHES) assert.ok(xml.includes(`Name="${s.name}"`), s.name);
});

test('download document: 4 pages, styles and swatches, guides, but no dummy copy or placeholder', () => {
  const grid = computeGrid(HOUSE_GRID);
  const styles = computeStyles(grid, HOUSE_STYLES);
  const full = computeDocument(grid, styles, 'facing4');
  const doc = emptyDocument(full);
  assert.equal(doc.pages.length, 4);
  assert.equal(doc.image, null);
  assert.deepEqual(doc.story, [['Body', '']]);
  // Page 1's frame is back to the full text area, like every other page.
  for (const f of doc.frames) {
    const mf = doc.master.frames[doc.master.pages.indexOf(doc.pages[f.page].side)];
    assert.deepEqual([f.x, f.y, f.w, f.h], [mf.x, mf.y, mf.w, mf.h]);
  }
  assert.equal(doc.frames[0].y, grid.margins.top);

  const files = buildIdmlFiles(grid, styles, doc);
  const get = (p) => files.find((f) => f.path === p).data;
  const spreads = files.filter((f) => f.path.startsWith('Spreads/'));
  assert.equal(spreads.reduce((n, f) => n + (f.data.match(/<Page /g) ?? []).length, 0), 4);
  for (const f of spreads) {
    assert.doesNotMatch(f.data, /<Rectangle/);
    for (const mp of f.data.match(/<MarginPreference [^>]*>/g)) assert.match(mp, /ColumnCount="12"/);
  }
  assert.doesNotMatch(get('Stories/Story_uStory.xml'), /<Content>[^<]+<\/Content>/);
  assert.match(get('Resources/Styles.xml'), /GridMonkey%3aHeading 1/);
  assert.match(get('Resources/Graphic.xml'), /Name="RGB-SCU Sky"/);
  // Row guides on both parent pages: 2 per row boundary.
  const master = get('MasterSpreads/MasterSpread_uMaster.xml');
  // Guides live inside each <Page>, Location measured from the page top (as InDesign writes it).
  const masterPages = master.match(/<Page [\s\S]*?<\/Page>/g);
  assert.equal(masterPages.length, 2);
  for (const pg of masterPages) {
    const locs = [...pg.matchAll(/<Guide [^>]*Location="([^"]+)"/g)].map((m) => Number(m[1]));
    assert.equal(locs.length, doc.guides.rows.length);
    assert.equal(locs.length, 2 * (grid.rows.number - 1));
    for (const [k, y] of doc.guides.rows.entries()) assert.ok(Math.abs(locs[k] - (y * 72) / 25.4) < 1e-6);
  }
  assert.doesNotMatch(master.replace(/<Page [\s\S]*?<\/Page>/g, ''), /<Guide /);
  assert.match(get('Resources/Preferences.xml'), /PagesPerDocument="1"/);
  assert.match(get('Stories/Story_uStory.xml'), /<Content><\/Content>/);
  assert.ok(full.story.length > 1, 'the preview keeps its dummy copy');
});

test('styles use the GridAlignment enum InDesign reads (AlignBaseline)', () => {
  const { grid, styles, doc } = setup('single');
  const xml = buildIdmlFiles(grid, styles, doc).find((f) => f.path === 'Resources/Styles.xml').data;
  assert.match(xml, /GridAlignment="AlignBaseline"/);
  assert.doesNotMatch(xml, /AlignToBaseline/);
});

test('single-sided: left/right margins, no mirroring, non-facing IDML for any page count', () => {
  const grid = computeGrid({ ...HOUSE_GRID, facing: false });
  assert.ok(grid.ok);
  assert.equal(grid.facing, false);
  assert.deepEqual(grid.marginNames, { first: 'Left', second: 'Right' });
  assert.equal(grid.margins.left, grid.margins.inside);
  assert.equal(grid.margins.right, grid.margins.outside);
  const styles = computeStyles(grid, HOUSE_STYLES);
  const doc = computeDocument(grid, styles, 'facing4');
  assert.equal(doc.format.facing, false);
  assert.equal(doc.spreads.length, 4);
  assert.ok(doc.pages.every((p) => p.side === 'single'));
  assert.deepEqual(doc.master.pages, ['single']);
  // Every page's text frame starts at the left margin.
  for (const f of doc.frames) assert.ok(Math.abs(f.x - grid.margins.left) < 1e-9);
  const files = buildIdmlFiles(grid, styles, emptyDocument(doc));
  assert.match(files.find((f) => f.path === 'Resources/Preferences.xml').data, /FacingPages="false"/);
  assert.equal(files.filter((f) => f.path.startsWith('Spreads/')).length, 4);
  // Facing stays the default.
  assert.equal(computeDocument(computeGrid(HOUSE_GRID), styles, 'facing4').format.facing, true);
});

test('equal margins: only even totals, both sides the same', () => {
  for (const facing of [true, false]) {
    // 1-unit gutters: totals 12, 24, 36 (all even).
    const grid = computeGrid({ ...HOUSE_GRID, facing, horizontal: { margins: 12, inside: 8, gutter: 1, equal: true } });
    assert.ok(grid.ok);
    const al = grid.allocation.horizontal;
    assert.equal(al.equal, true);
    assert.ok(al.options.every((m) => m % 2 === 0));
    assert.equal(al.inside, al.outside);
    assert.ok(Math.abs(grid.margins.inside - grid.margins.outside) < 1e-9);
  }
  // The house grid (2-unit gutters) only allows 13 or 25: no even total, so equal
  // isn't available and the requested split stands (the app shows a hint).
  const odd = computeGrid({ ...HOUSE_GRID, horizontal: { ...HOUSE_GRID.horizontal, equal: true } }).allocation.horizontal;
  assert.deepEqual([odd.equal, odd.equalAvailable, odd.inside, odd.outside], [false, false, 7, 6]);
  // Off: the requested split stands.
  const off = computeGrid(HOUSE_GRID).allocation.horizontal;
  assert.deepEqual([off.inside, off.outside, off.equal], [7, 6, false]);
});
