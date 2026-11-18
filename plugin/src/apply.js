// Applies GridMonkey results to InDesign documents. The InDesign DOM is injected
// ({ app, id, storage }) so this runs against the real host or a test double.
// All lengths are written in points (script measurement unit forced to POINTS).

import { mmToPt } from '../../src/core/grid.js';
import { computeDocument } from '../../src/core/document.js';
import { buildIdml } from '../../src/core/idml.js';

export const GUIDE_LABEL = 'gridmonkey';
export const PREVIEW_UNDO = 'GridMonkey preview';
export const APPLY_UNDO = 'GridMonkey';
const IMAGE_LAYER = 'Image-lines';
const pt = mmToPt;

/** Run fn with the script measurement unit set to points, restoring it afterwards. */
export function withPoints({ app, id }, fn) {
  const prefs = app.scriptPreferences;
  const prev = prefs.measurementUnit;
  prefs.measurementUnit = id.MeasurementUnits.POINTS;
  try { return fn(); } finally { prefs.measurementUnit = prev; }
}

/**
 * Run fn as ONE undo step named `name`. Falls back to running it directly if this
 * host's doScript can't take a function (then `grouped` is false).
 */
export function runUndoable({ app, id }, name, fn) {
  let result;
  let error;
  let ran = false;
  const body = () => { ran = true; try { result = fn(); } catch (e) { error = e; } };
  let grouped = true;
  try {
    app.doScript(body, id.ScriptLanguage.UXPSCRIPT, [], id.UndoModes.ENTIRE_SCRIPT, name);
  } catch (e) {
    if (ran) throw e;
    grouped = false;
    body();
  }
  if (!ran) { grouped = false; body(); }
  if (error) throw error;
  return { ...result, grouped };
}

function collection(c) {
  const out = [];
  for (let i = 0; i < c.length; i++) out.push(c.item(i));
  return out;
}

function setter(warnings) {
  return (obj, prop, value, label) => {
    try { obj[prop] = value; } catch (e) { warnings.push(`${label}: couldn't set ${prop} (${e.message})`); }
  };
}

/** Page size of a document, in mm. */
export function documentPageSize(deps, doc) {
  return withPoints(deps, () => {
    const dp = doc.documentPreferences;
    return { width: dp.pageWidth / pt(1), height: dp.pageHeight / pt(1), facing: !!dp.facingPages };
  });
}

/**
 * Apply grid, margins, guides and (optionally) styles to `doc`.
 * @param opts.styles      apply paragraph styles too (needs `styles`)
 * @param opts.pageSize    resize the document to the grid's page size if it differs
 * @returns { warnings: string[], resized: boolean }
 */
export function applyToDocument(deps, doc, grid, styles, opts = {}) {
  const { id } = deps;
  const warnings = [];
  const set = setter(warnings);
  let resized = false;

  return withPoints(deps, () => {
    // Guides are placed relative to the ruler zero point; use the page corner.
    const zero = doc.zeroPoint;
    set(doc, 'zeroPoint', [0, 0], 'Rulers');

    // Page size
    const dp = doc.documentPreferences;
    const W = pt(grid.input.pageWidth);
    const H = pt(grid.input.pageHeight);
    if (Math.abs(dp.pageWidth - W) > 0.01 || Math.abs(dp.pageHeight - H) > 0.01) {
      if (opts.pageSize) {
        set(dp, 'pageWidth', W, 'Page size');
        set(dp, 'pageHeight', H, 'Page size');
        resized = true;
      } else {
        warnings.push('The document page size differs from the grid. Turn on "Match page size" or use the document size.');
      }
    }

    // Preferences › Grids (InDesign: Horizontal = spacing across, Vertical = spacing down)
    const gp = doc.gridPreferences;
    set(gp, 'baselineGridRelativeOption', id.BaselineGridRelativeOption.TOP_OF_PAGE_OF_BASELINE_GRID_RELATIVE_OPTION, 'Baseline grid');
    set(gp, 'baselineStart', pt(grid.baseline.start), 'Baseline grid');
    set(gp, 'baselineDivision', grid.baseline.incrementPt, 'Baseline grid');
    set(gp, 'horizontalGridlineDivision', pt(grid.documentGrid.horizontalEvery), 'Document grid');
    set(gp, 'verticalGridlineDivision', pt(grid.documentGrid.verticalEvery), 'Document grid');
    set(gp, 'horizontalGridSubdivision', grid.documentGrid.horizontalSubdivisions, 'Document grid');
    set(gp, 'verticalGridSubdivision', grid.documentGrid.verticalSubdivisions, 'Document grid');
    set(gp, 'baselineGridShown', true, 'Baseline grid');
    set(gp, 'documentGridShown', true, 'Document grid');
    set(doc.guidePreferences, 'guidesShown', true, 'Guides');

    // Margins and columns: document defaults, every parent page and every page.
    const m = grid.margins;
    const margins = (mp, label) => {
      set(mp, 'top', pt(m.top), label);
      set(mp, 'bottom', pt(m.bottom), label);
      set(mp, 'left', pt(m.inside), label); // "left" = inside on facing pages
      set(mp, 'right', pt(m.outside), label);
      set(mp, 'columnCount', grid.columns.number, label);
      set(mp, 'columnGutter', pt(grid.columns.gutter), label);
    };
    margins(doc.marginPreferences, 'Default margins');
    const parentPages = collection(doc.masterSpreads).flatMap((s) => collection(s.pages));
    for (const p of parentPages) margins(p.marginPreferences, 'Parent page margins');
    for (const p of collection(doc.pages)) margins(p.marginPreferences, 'Page margins');

    // Guides on parent pages: remove our previous ones, then rows + image-lines.
    for (const p of parentPages) {
      for (const g of collection(p.guides).reverse()) {
        try { if (g.label === GUIDE_LABEL) g.remove(); } catch { /* locked guide */ }
      }
    }
    let imageLayer = null;
    if (grid.imageLines) {
      imageLayer = doc.layers.itemByName(IMAGE_LAYER);
      if (!imageLayer.isValid) imageLayer = doc.layers.add({ name: IMAGE_LAYER });
      set(imageLayer, 'printable', false, 'Image-lines layer');
      set(imageLayer, 'layerColor', id.UIColors.MAGENTA, 'Image-lines layer');
    }
    const rowYs = [];
    for (let r = 0; r < grid.rows.number; r++) {
      const top = m.top + r * (grid.rows.height + grid.rows.gutter);
      if (r > 0) rowYs.push(top);
      if (r < grid.rows.number - 1) rowYs.push(top + grid.rows.height);
    }
    const imageYs = grid.imageLines
      ? Array.from({ length: grid.imageLines.repeatCount + 1 }, (_, k) => grid.imageLines.firstY + k * grid.imageLines.offsetVertical)
      : [];
    const addGuide = (page, y, layer, color) => {
      try {
        const props = { orientation: id.HorizontalOrVertical.HORIZONTAL, location: pt(y), fitToPage: true, label: GUIDE_LABEL };
        if (color) props.guideColor = color;
        page.guides.add(layer, props);
      } catch (e) { warnings.push(`Guides: ${e.message}`); }
    };
    for (const p of parentPages) {
      for (const y of rowYs) addGuide(p, y, doc.activeLayer);
      for (const y of imageYs) addGuide(p, y, imageLayer, id.UIColors.MAGENTA);
    }

    if (opts.styles && styles?.ok) applyStyles(deps, doc, styles, warnings);

    set(doc, 'zeroPoint', zero, 'Rulers');
    return { warnings, resized };
  });
}

/** Create or update the GridMonkey paragraph styles (expects points as the unit). */
export function applyStyles({ app, id }, doc, styles, warnings = []) {
  const set = setter(warnings);
  // Warn (once) about fonts that aren't installed.
  const fonts = new Set(styles.styles.map((s) => `${s.appliedFont}\t${s.fontStyle}`));
  for (const f of fonts) {
    try { if (!app.fonts.itemByName(f).isValid) warnings.push(`Font not installed: ${f.replace('\t', ' ')}`); } catch { /* ignore */ }
  }

  let group = doc.paragraphStyleGroups.itemByName(styles.group);
  if (!group.isValid) group = doc.paragraphStyleGroups.add({ name: styles.group });
  let list = doc.numberingLists.itemByName(styles.group);
  if (!list.isValid) list = doc.numberingLists.add({ name: styles.group });

  const made = {};
  for (const s of styles.styles) {
    let st = group.paragraphStyles.itemByName(s.name);
    if (!st.isValid) st = group.paragraphStyles.add({ name: s.name });
    made[s.name] = st;
    set(st, 'basedOn', s.basedOn ? made[s.basedOn] : doc.paragraphStyles.item(0), s.name);
    set(st, 'appliedFont', s.appliedFont, s.name);
    set(st, 'fontStyle', s.fontStyle, s.name);
    set(st, 'pointSize', s.pointSize, s.name);
    set(st, 'leading', s.leading, s.name);
    set(st, 'spaceBefore', pt(s.spaceBefore), s.name);
    set(st, 'spaceAfter', pt(s.spaceAfter), s.name);
    if (s.sameParaStyleSpacing != null) set(st, 'sameParaStyleSpacing', pt(s.sameParaStyleSpacing), s.name);
    set(st, 'leftIndent', pt(s.leftIndent), s.name);
    set(st, 'firstLineIndent', pt(s.firstLineIndent), s.name);
    set(st, 'alignToBaseline', true, s.name); // GridAlignment.ALIGN_TO_BASELINE doesn't exist in InDesign 2026
    set(st, 'gridAlignFirstLineOnly', s.alignFirstLineOnly, s.name);
    set(st, 'hyphenation', s.hyphenation, s.name);
    set(st, 'keepWithNext', s.keepWithNext, s.name);
    if (!s.list) {
      set(st, 'bulletsAndNumberingListType', id.ListType.NO_LIST, s.name);
    } else if (s.list.type === 'bullet') {
      set(st, 'bulletsAndNumberingListType', id.ListType.BULLET_LIST, s.name);
      set(st.bulletChar, 'characterType', id.BulletCharacterType.UNICODE_ONLY, s.name);
      set(st.bulletChar, 'characterValue', s.list.charCode, s.name);
    } else {
      set(st, 'bulletsAndNumberingListType', id.ListType.NUMBERED_LIST, s.name);
      set(st, 'appliedNumberingList', list, s.name);
      set(st, 'numberingLevel', s.list.level, s.name);
      set(st, 'numberingFormat', s.list.format, s.name);
      set(st, 'numberingExpression', s.list.expression, s.name);
      set(st, 'numberingContinue', true, s.name);
    }
  }
  // Character styles: only the one attribute each, so they stay versatile.
  try {
    let cgroup = doc.characterStyleGroups.itemByName(styles.group);
    if (!cgroup.isValid) cgroup = doc.characterStyleGroups.add({ name: styles.group });
    for (const c of styles.characterStyles ?? []) {
      let cs = cgroup.characterStyles.itemByName(c.name);
      if (!cs.isValid) cs = cgroup.characterStyles.add({ name: c.name });
      if (c.fontStyle) set(cs, 'fontStyle', c.fontStyle, c.name);
      if (c.fillColor) set(cs, 'fillColor', doc.swatches.itemByName(c.fillColor), c.name);
    }
  } catch (e) { warnings.push(`Character styles: ${e.message}`); }

  // Next Style: heading → Body First (or Body) → Body; lists repeat themselves.
  const first = made['Body First'] ? 'Body First' : 'Body';
  for (const s of styles.styles) {
    const next = s.headingLevel ? first : s.name === 'Body First' ? 'Body' : s.name;
    set(made[s.name], 'nextStyle', made[next], s.name);
  }
  return warnings;
}

/**
 * New document from the shared IDML builder: write to the plugin's temp folder,
 * open it, then let InDesign itself trim the dummy copy so nothing is overset.
 */
export async function createDocument(deps, grid, styles, formatId) {
  const { app, storage } = deps;
  // Each step names itself in any error, so a failure says where it happened.
  const step = async (label, fn) => {
    try { return await fn(); } catch (e) {
      console.error(`GridMonkey: ${label}`, e);
      throw new Error(`${label}: ${e?.message ?? e}`);
    }
  };

  const bytes = await step('Building the IDML', () => {
    const model = computeDocument(grid, styles, formatId);
    if (!model.ok) throw new Error(model.errors.join(' '));
    return buildIdml(grid, styles, model, { smartTextReflow: false });
  });
  const file = await step('Writing the temporary file', async () => {
    const folder = await storage.localFileSystem.getTemporaryFolder();
    const f = await folder.createFile(`GridMonkey-${formatId}.idml`, { overwrite: true });
    await f.write(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { format: storage.formats.binary });
    return f;
  });
  const doc = await step('Opening it in InDesign', () => openFile(app, file));
  const trimmed = await step('Fitting the dummy copy', () => trimOverset(doc));
  try { doc.textPreferences.smartTextReflow = true; } catch { /* leave as is */ }
  return { doc, ...trimmed };
}

/** Open a file, trying a native path first and then the UXP file entry. */
export function openFile(app, file) {
  const errors = [];
  for (const arg of [file.nativePath, file]) {
    if (!arg) continue;
    try {
      let doc = app.open(arg);
      if (doc && !doc.pages && typeof doc.item === 'function') doc = doc.item(0); // some hosts return a collection
      if (doc && doc.pages) return doc;
      errors.push('no document returned');
    } catch (e) { errors.push(e?.message ?? String(e)); }
  }
  throw new Error(errors.join(' / '));
}

/** The story holding the dummy copy: the longest one in the document. */
export function mainStory(doc) {
  let best = null;
  let bestLength = -1;
  for (const s of collection(doc.stories)) {
    let n = 0;
    try { n = s.characters.length; } catch { /* skip unreadable story */ }
    if (n > bestLength) { best = s; bestLength = n; }
  }
  if (!best) throw new Error('the document has no text frames');
  return best;
}

/** Remove whole paragraphs from the end of the main story until it fits. */
export function trimOverset(doc) {
  const story = mainStory(doc);
  let removed = 0;
  for (let guard = 0; story.overflows && story.paragraphs.length > 1 && guard < 2000; guard++) {
    story.paragraphs.lastItem().remove();
    removed++;
  }
  // Don't end on a heading, and don't leave a trailing empty paragraph.
  for (let guard = 0; guard < 10 && story.paragraphs.length > 1; guard++) {
    const last = story.paragraphs.lastItem();
    const name = String(last.appliedParagraphStyle?.name ?? '');
    const empty = !String(last.contents ?? '').trim();
    if (!empty && !/^Heading/.test(name)) break;
    last.remove();
    removed++;
  }
  return { removed, overset: !!story.overflows, paragraphs: story.paragraphs.length };
}
