// GridMonkey InDesign panel (UXP). UI wiring only: maths lives in src/core, document
// changes in ./apply.js, live preview in ./preview.js.
import { computeGrid, DEFAULTS, round, BASELINE_DIVISORS } from '../../src/core/grid.js';
import { computeStyles, STYLE_DEFAULTS, FONTS, SCALES, SPACE_AFTER } from '../../src/core/styles.js';
import { HOUSE_GRID, HOUSE_STYLES, HOUSE_EXPORT } from '../../src/core/presets.js';
import { FORMATS } from '../../src/core/document.js';
import { VERSION } from '../../src/core/version.js';
import { applyToDocument, createDocument, documentPageSize } from './apply.js';
import { createPreview } from './preview.js';

// Surface any error in the status line rather than failing silently.
function showError(prefix, e) {
  const el = document.getElementById('status');
  if (el) { el.textContent = `${prefix}: ${e?.message ?? e}`; el.className = 'status error'; }
  console.error(prefix, e);
}
window.addEventListener('error', (e) => showError('Error', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => showError('Error', e.reason));

const host = require('indesign');
const uxp = require('uxp');
const deps = { app: host.app, id: host, storage: uxp.storage };

const STORAGE_KEY = 'gridmonkey-plugin:v1';
const $ = (id) => document.getElementById(id);

// ---------- state ----------
const fresh = () => JSON.parse(JSON.stringify({
  ...DEFAULTS, ...HOUSE_GRID,
  styles: { ...STYLE_DEFAULTS, ...HOUSE_STYLES, headingFontStyles: { ...HOUSE_STYLES.headingFontStyles }, headingSpaceAfter: { ...HOUSE_STYLES.headingSpaceAfter }, firstLineOnly: { ...HOUSE_STYLES.firstLineOnly } },
  format: HOUSE_EXPORT.format, matchSize: false, rowsEnabled: true,
}));
let state = load() ?? fresh();
let grid = null;
let styles = null;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    const f = fresh();
    return { ...f, ...s, horizontal: { ...f.horizontal, ...s.horizontal }, vertical: { ...f.vertical, ...s.vertical },
      styles: { ...f.styles, ...s.styles, headingFontStyles: { ...f.styles.headingFontStyles, ...(s.styles?.headingFontStyles || {}) },
        headingSpaceAfter: { ...f.styles.headingSpaceAfter, ...(s.styles?.headingSpaceAfter || {}) },
        firstLineOnly: { ...f.styles.firstLineOnly, ...(s.styles?.firstLineOnly || {}) } } };
  } catch { return null; }
}
function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* unavailable */ } }

// ---------- helpers ----------
const activeDoc = () => { try { return deps.app.documents.length ? deps.app.activeDocument : null; } catch { return null; } };
const num = (el) => { const v = String(el.value ?? '').trim(); return v === '' ? null : Number(v); };

function status(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = `status ${kind}`;
}

/** Fill an sp-picker with options; read back via picker.selectedIndex. */
function picker(el, items, selected) {
  el._items = items;
  el._selected = String(selected);
  el.innerHTML = `<sp-menu slot="options">${items.map((it) =>
    `<sp-menu-item value="${it.value}"${String(it.value) === String(selected) ? ' selected' : ''}>${it.label}</sp-menu-item>`).join('')}</sp-menu>`;
}
const pickerValue = (el) => el._items?.[el.selectedIndex]?.value;
/** Select a value, rebuilding the menu only when it changed. */
function pickValue(el, value) { if (el._selected !== String(value)) picker(el, el._items, value); }
function onPick(el, fn) { el.addEventListener('change', () => { const v = pickerValue(el); if (v !== undefined) { el._selected = String(v); fn(v); } }); }

// ---------- inputs ----------
const fields = ['pageWidth', 'pageHeight', 'fontSize', 'leading', 'columns', 'rows', 'capHeight'];
const ints = new Set(['columns', 'rows']);
for (const key of fields) {
  $(key).addEventListener('input', () => {
    const v = num($(key));
    state[key] = v === null ? null : ints.has(key) ? Math.round(v) : v;
    update();
  });
}

const axes = {
  h: { key: 'horizontal', first: 'inside', total: 'hTotal', firstEl: 'hInside', second: 'hOutside', gutter: 'hGutter' },
  v: { key: 'vertical', first: 'top', total: 'vTotal', firstEl: 'vTop', second: 'vBottom', gutter: 'vGutter' },
};
for (const [k, a] of Object.entries(axes)) {
  const step = (dir) => {
    const al = grid?.allocation?.[a.key];
    if (!al) return;
    const i = al.options.indexOf(al.total) + dir;
    if (i < 0 || i >= al.options.length) return;
    const total = al.options[i];
    state[a.key][a.first] = Math.max(1, Math.round((al[a.first] / al.total) * total));
    state[a.key].margins = total;
    update();
  };
  $(`${k}Dec`).addEventListener('click', () => step(-1));
  $(`${k}Inc`).addEventListener('click', () => step(1));
  $(a.firstEl).addEventListener('input', () => { state[a.key][a.first] = num($(a.firstEl)); update(); });
  $(a.gutter).addEventListener('input', () => { state[a.key].gutter = num($(a.gutter)); update(); });
}

picker($('bdiv'), BASELINE_DIVISORS.map((d) => ({ value: d, label: d === 1 ? 'Full leading' : `Leading ÷ ${d}` })), state.baselineDivisor);
onPick($('bdiv'), (v) => { state.baselineDivisor = Number(v); update(); });

const spaceChoices = SPACE_AFTER.map((o) => ({ value: o.value, label: o.label }));
const firstLineId = (k) => (k === 'body' ? 'stBodyFirstLine' : `stH${k}FirstLine`);
const weights = (font) => font.styles.map((s) => ({ value: s, label: s }));
picker($('stBody'), weights(FONTS.body), state.styles.bodyFontStyle);
onPick($('stBody'), (v) => { state.styles.bodyFontStyle = v; update(); });
for (const l of [1, 2, 3]) {
  picker($(`stH${l}`), weights(FONTS.heading), state.styles.headingFontStyles[l]);
  onPick($(`stH${l}`), (v) => { state.styles.headingFontStyles[l] = v; update(); });
  picker($(`stH${l}After`), spaceChoices, '');
  onPick($(`stH${l}After`), (v) => { state.styles.headingSpaceAfter[l] = Number(v); update(); });
}
picker($('stBodyAfter'), spaceChoices, '');
onPick($('stBodyAfter'), (v) => { state.styles.bodySpaceAfter = Number(v); update(); });
picker($('stListAfter'), spaceChoices, '');
onPick($('stListAfter'), (v) => { state.styles.listSpaceAfter = Number(v); update(); });
for (const k of ['body', 1, 2, 3]) {
  $(firstLineId(k)).addEventListener('change', (e) => { state.styles.firstLineOnly[k] = !!e.target.checked; update(); });
}
picker($('stScale'), SCALES.map((s) => ({ value: s.value, label: s.label })), state.styles.scale);
onPick($('stScale'), (v) => { state.styles.scale = Number(v); update(); });
picker($('stSeparation'), [
  { value: 'indent', label: 'First-line indent (+ Body First)' },
  { value: 'space', label: 'Space after' },
], state.styles.separation);
// Changing separation resets Body's space after to match it (space → 1 line, indent → none).
onPick($('stSeparation'), (v) => { state.styles.separation = v; state.styles.bodySpaceAfter = null; update(); });
$('stEnabled').addEventListener('change', (e) => { state.styles.enabled = !!e.target.checked; update(); });

picker($('format'), FORMATS.map((f) => ({ value: f.id, label: f.label })), state.format);
onPick($('format'), (v) => { state.format = v; save(); });
$('matchSize').addEventListener('change', (e) => { state.matchSize = !!e.target.checked; save(); schedulePreview(); });
$('rowsEnabled').addEventListener('change', (e) => { state.rowsEnabled = !!e.target.checked; update(); });

// Document layout: facing pages (inside/outside) or single-sided (left/right).
$('facing').addEventListener('change', (e) => { state.facing = !!e.target.checked; update(); });
$('hEqual').addEventListener('change', (e) => { state.horizontal.equal = !!e.target.checked; update(); });

$('fromDoc').addEventListener('click', () => {
  const doc = activeDoc();
  if (!doc) return status('Open a document first.', 'warn');
  try {
    const size = documentPageSize(deps, doc);
    state.pageWidth = round(size.width, 3);
    state.pageHeight = round(size.height, 3);
    state.facing = size.facing;
    fill();
    update();
    status(`Using the document's page size: ${state.pageWidth} × ${state.pageHeight} mm${size.facing ? ', facing pages' : ''}.`);
  } catch (e) { status(`Couldn't read the page size: ${e.message}`, 'error'); }
});

// ---------- preview & actions ----------
const applyCurrent = (doc) => applyToDocument(deps, doc, grid, styles, { styles: state.styles.enabled, pageSize: state.matchSize });
const preview = createPreview(deps, { getDoc: activeDoc, apply: applyCurrent });

let previewTimer = 0;
function schedulePreview() {
  if (!$('preview').checked) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(runPreview, 350);
}
function report(result, done) {
  const w = result.warnings ?? [];
  if (result.grouped === false) w.unshift("This InDesign can't group the changes into one undo step.");
  status(w.length ? `${done} ${w.length} warning${w.length > 1 ? 's' : ''}: ${w.slice(0, 3).join(' · ')}` : done, w.length ? 'warn' : '');
}
function runPreview() {
  if (!grid?.ok) return status('Fix the settings to preview.', 'warn');
  try {
    const r = preview.update();
    if (!r.ok) return status(r.message, 'warn');
    report(r, 'Previewing in the document.');
  } catch (e) { status(`Preview failed: ${e.message}`, 'error'); }
}
$('preview').addEventListener('change', (e) => {
  if (e.target.checked) runPreview();
  else {
    clearTimeout(previewTimer);
    try { preview.revert(); status('Preview removed.'); } catch (err) { status(`Couldn't remove the preview: ${err.message}`, 'error'); }
  }
});

$('apply').addEventListener('click', () => {
  if (!grid?.ok) return status('Fix the settings first.', 'warn');
  clearTimeout(previewTimer);
  try {
    const r = preview.commit();
    if (!r.ok) return status(r.message, 'warn');
    $('preview').checked = false;
    report(r, `Applied${r.resized ? ' (page size changed)' : ''}. Undo with Edit › Undo GridMonkey.`);
  } catch (e) { status(`Apply failed: ${e.message}`, 'error'); }
});

$('create').addEventListener('click', async () => {
  if (!grid?.ok || !styles?.ok) return status('Fix the settings first.', 'warn');
  status('Creating document…');
  try {
    const r = await createDocument(deps, grid, styles, state.format);
    status(`New document created${r.overset ? ' (some copy is still overset)' : ''}.`, r.overset ? 'warn' : '');
  } catch (e) { status(`Couldn't create the document: ${e.message}`, 'error'); }
});

// ---------- render ----------
function fill() {
  for (const key of fields) $(key).value = state[key] ?? '';
  $('stEnabled').checked = !!state.styles.enabled;
  $('matchSize').checked = !!state.matchSize;
  $('rowsEnabled').checked = state.rowsEnabled !== false;
  $('facing').checked = state.facing !== false;
  $('hEqual').checked = !!state.horizontal.equal;
}

// Rows are optional: without them the grid is one full-height row (no row guides).
const gridInput = () => (state.rowsEnabled === false ? { ...state, rows: 1, vertical: { ...state.vertical, gutter: 0 } } : state);

function update() {
  grid = computeGrid(gridInput());
  if (grid.allocation) {
    for (const a of Object.values(axes)) {
      const al = grid.allocation[a.key];
      const keepGutter = a.key === 'vertical' && state.rowsEnabled === false; // remember it for when rows return
      Object.assign(state[a.key], { margins: al.total, [a.first]: al[a.first], ...(keepGutter ? {} : { gutter: al.gutter }) });
    }
  }
  styles = grid.ok ? computeStyles(grid, state.styles) : null;
  save();
  render();
  schedulePreview();
}

function render() {
  $('styleFields').className = state.styles.enabled ? '' : 'hidden';
  const rowsOn = state.rowsEnabled !== false;
  if (rowsOn) $('rows').removeAttribute('disabled'); else $('rows').setAttribute('disabled', '');
  $('vGutterField').style.display = rowsOn ? '' : 'none';
  if (grid.type) {
    $('typeReadout').textContent = `Corrected leading ${round(grid.type.correctedLeadingPt, 3)} pt · ${Math.round(grid.type.proportion * 100)}% of size${grid.type.proportionOk ? '' : ' (outside 120–145%)'}`;
  }
  for (const a of Object.values(axes)) {
    const al = grid.allocation?.[a.key];
    $(a.total).textContent = al ? String(al.total) : '–';
    $(a.second).textContent = al ? String(al.total - al[a.first]) : '–';
    if (al && document.activeElement !== $(a.firstEl)) $(a.firstEl).value = al[a.first];
    if (al && document.activeElement !== $(a.gutter)) $(a.gutter).value = state[a.key].gutter ?? al.gutter;
  }
  if (!grid.ok) {
    $('summary').textContent = '';
    $('mini').innerHTML = '';
    return status(grid.errors.join(' '), 'error');
  }
  // Margin names follow the document layout.
  const names = grid.marginNames;
  $('hTitle').textContent = `${names.first} & ${names.second} margins`.toUpperCase();
  $('hFirstLabel').textContent = names.first;
  $('hSecondLabel').textContent = names.second;
  if (grid.allocation.horizontal.equal) $('hInside').setAttribute('disabled', ''); else $('hInside').removeAttribute('disabled');
  const rowText = state.rowsEnabled === false ? 'no rows' : `row ${round(grid.rows.height, 2)} mm`;
  if (styles?.ok) { // resolved spacing and alignment, automatic values included
    const r = styles.options;
    pickValue($('stBodyAfter'), r.bodySpaceAfter);
    pickValue($('stListAfter'), r.listSpaceAfter);
    for (const l of [1, 2, 3]) pickValue($(`stH${l}After`), r.headingSpaceAfter[l]);
    for (const k of ['body', 1, 2, 3]) $(firstLineId(k)).checked = r.firstLineOnly[k];
  }
  $('summary').textContent = `${grid.grid.lines} lines × ${grid.grid.hUnits} units · col ${round(grid.columns.width, 2)} mm · ${rowText}`;
  drawMini();
}

function drawMini() {
  const box = $('mini');
  const W = grid.input.pageWidth;
  const H = grid.input.pageHeight;
  const facing = grid.facing;
  const width = Math.max(200, box.clientWidth || box.offsetWidth || 260);
  const s = width / (facing ? 2 * W : W);
  box.style.height = `${Math.round(H * s)}px`;
  const m = grid.margins;
  const px = (v) => `${Math.round(v * s * 10) / 10}px`;
  const parts = [];
  const page = (x0, verso) => {
    const left = verso ? m.outside : m.inside;
    parts.push(`<div class="pg" style="left:${px(x0)};top:0;width:${px(W)};height:${px(H)}"></div>`);
    for (let c = 0; c < grid.columns.number; c++) {
      for (let r = 0; r < grid.rows.number; r++) {
        const x = x0 + left + c * (grid.columns.width + grid.columns.gutter);
        const y = m.top + r * (grid.rows.height + grid.rows.gutter);
        parts.push(`<div class="md" style="left:${px(x)};top:${px(y)};width:${px(grid.columns.width)};height:${px(grid.rows.height)}"></div>`);
      }
    }
    if (grid.imageLines) {
      for (let k = 0; k <= grid.imageLines.repeatCount; k++) {
        parts.push(`<div class="il" style="left:${px(x0)};top:${px(grid.imageLines.firstY + k * grid.imageLines.offsetVertical)};width:${px(W)}"></div>`);
      }
    }
    parts.push(`<div class="mg" style="left:${px(x0 + left)};top:${px(m.top)};width:${px(W - m.inside - m.outside)};height:${px(H - m.top - m.bottom)}"></div>`);
  };
  if (facing) { page(0, true); page(W, false); parts.push(`<div class="spine" style="left:${px(W)};top:0;height:${px(H)}"></div>`); }
  else page(0, false);
  box.innerHTML = parts.join('');
}

// ---------- boot ----------
$('version').textContent = `v${VERSION}`;
// First run: start from the open document's page size, if there is one.
let firstRun = false;
try { firstRun = !localStorage.getItem(STORAGE_KEY); } catch { firstRun = true; }
if (firstRun) {
  const doc = activeDoc();
  if (doc) {
    try {
      const size = documentPageSize(deps, doc);
      state.pageWidth = round(size.width, 3);
      state.pageHeight = round(size.height, 3);
      state.facing = size.facing;
      if (size.facing) state.format = 'double';
    } catch { /* keep defaults */ }
  }
}
try {
  fill();
  update();
  window.addEventListener('resize', () => grid?.ok && drawMini());
  let version = '';
  try { version = ` · InDesign ${deps.app.version}`; } catch { /* ignore */ }
  status(`Ready${version}. ${activeDoc() ? 'Tick Preview to see it in the document.' : 'Open a document to preview or apply.'}`);
} catch (e) { showError('Startup failed', e); }
