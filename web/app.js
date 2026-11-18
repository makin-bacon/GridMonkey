import { computeGrid, DEFAULTS, round } from '../src/core/grid.js';
import { STYLE_DEFAULTS } from '../src/core/styles.js';
import { HOUSE_GRID, HOUSE_STYLES, HOUSE_EXPORT } from '../src/core/presets.js';
import { createStylesPanel } from './styles-panel.js';
import { createMasonry } from './masonry.js';
import { createExportPanel } from './export-panel.js';
import { initCollapsible } from './collapse.js';
import { createTour } from './tour.js';
import { VERSION } from '../src/core/version.js';
import { renderIcons } from './icons.js';

const STORAGE_KEY = 'gridmonkey:v1';
const $ = (id) => document.getElementById(id);

// ---------- state ----------
// House defaults (src/core/presets.js) on top of the neutral core defaults.
const freshState = () => structuredClone({
  ...DEFAULTS, ...HOUSE_GRID, previewView: 'spread', hoodTab: 'grids', rowsEnabled: true, collapsed: [],
  styles: { ...STYLE_DEFAULTS, ...HOUSE_STYLES }, export: { ...HOUSE_EXPORT },
});
let state = load() ?? freshState();
let layers = { labels: true, docgrid: true, baseline: false, columns: true, rows: true, imagelines: true };
let result = null;
let masonry = null; // created at boot, after the first render

const stylesPanel = createStylesPanel({
  options: state.styles,
  onChange: (opts) => { state.styles = opts; save(); exportPanel.render(result, stylesPanel.compute(result)); },
});
const exportPanel = createExportPanel({
  options: state.export,
  onChange: (opts) => { state.export = opts; save(); },
});

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    const fresh = freshState();
    // Drop settings from before the fixed project fonts (Graphik / Montserrat).
    if (saved.styles) for (const k of ['bodyFont', 'headingFont', 'headingFontStyle']) delete saved.styles[k];
    return {
      ...fresh, ...saved,
      styles: { ...fresh.styles, ...(saved.styles || {}), headingSpaceAfter: { ...fresh.styles.headingSpaceAfter, ...(saved.styles?.headingSpaceAfter || {}) }, firstLineOnly: { ...fresh.styles.firstLineOnly, ...(saved.styles?.firstLineOnly || {}) } },
      export: { ...fresh.export, ...(saved.export || {}) },
    };
  } catch { return null; }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

// ---------- inputs ----------
const num = (el) => (el.value.trim() === '' ? null : Number(el.value));
const int = (el) => { const n = num(el); return n === null ? null : Math.round(n); };

const fields = {
  pageWidth: { el: $('pageWidth'), get: num },
  pageHeight: { el: $('pageHeight'), get: num },
  fontSize: { el: $('fontSize'), get: num },
  leading: { el: $('leading'), get: num },
  columns: { el: $('columns'), get: int },
  rows: { el: $('rows'), get: int },
  capHeight: { el: $('capHeight'), get: num },
};

for (const [key, { el, get }] of Object.entries(fields)) {
  el.addEventListener('input', () => {
    state[key] = get(el);
    if (key === 'pageWidth' || key === 'pageHeight') syncPreset();
    // changing page/type/track count invalidates the chosen margin totals' meaning, but
    // computeGrid snaps them to the nearest valid option, so we keep them as targets.
    update();
  });
}

$('preset').addEventListener('change', (e) => {
  if (!e.target.value) return;
  const [w, h] = e.target.value.split('x').map(Number);
  state.pageWidth = w; state.pageHeight = h;
  fields.pageWidth.el.value = w; fields.pageHeight.el.value = h;
  update();
});
function syncPreset() {
  const v = `${state.pageWidth}x${state.pageHeight}`;
  const opt = [...$('preset').options].find((o) => o.value === v);
  $('preset').value = opt ? v : '';
}

// margin axes: h = horizontal (inside/outside), v = vertical (top/bottom)
const axis = {
  h: { key: 'horizontal', firstKey: 'inside', range: $('hTotalRange'), total: $('hTotal'), first: $('hInside'), second: $('hOutside'), gutter: $('hGutter') },
  v: { key: 'vertical', firstKey: 'top', range: $('vTotalRange'), total: $('vTotal'), first: $('vTop'), second: $('vBottom'), gutter: $('vGutter') },
};

for (const [id, a] of Object.entries(axis)) {
  const alloc = () => result?.allocation?.[a.key];
  a.range.addEventListener('input', () => {
    const opts = alloc()?.options ?? [];
    setTotal(a, opts[Number(a.range.value)]);
  });
  a.first.addEventListener('input', () => { state[a.key][a.firstKey] = int(a.first); update(); });
  a.gutter.addEventListener('input', () => { state[a.key].gutter = int(a.gutter); update(); });
  document.querySelectorAll(`[data-step="${id}"]`).forEach((btn) =>
    btn.addEventListener('click', () => {
      const al = alloc(); if (!al) return;
      const idx = al.options.indexOf(al.total) + Number(btn.dataset.dir);
      if (idx >= 0 && idx < al.options.length) setTotal(a, al.options[idx]);
    }));
}

function setTotal(a, total) {
  if (total == null) return;
  const prev = result?.allocation?.[a.key];
  const s = state[a.key];
  // keep the inside/top share proportional when the total changes
  if (prev && prev.total) s[a.firstKey] = Math.max(1, Math.round((prev[a.firstKey] / prev.total) * total));
  s.margins = total;
  update();
}

// Document layout, chosen first: facing pages (inside/outside, mirrored spreads) or
// single-sided (left/right). Labels, the preview and the export follow it.
document.querySelectorAll('input[name="layout"]').forEach((radio) =>
  radio.addEventListener('change', () => { state.facing = radio.value === 'facing'; update(); }));
$('hEqual').addEventListener('change', (e) => { state.horizontal.equal = e.target.checked; update(); });

document.querySelectorAll('input[name="bdiv"]').forEach((radio) =>
  radio.addEventListener('change', () => { state.baselineDivisor = Number(radio.value); update(); }));

// Spread vs single page: the single view shows one right-hand page (inside margin on
// the left), which makes unequal inside/outside margins easy to judge.
document.querySelectorAll('input[name="pview"]').forEach((radio) =>
  radio.addEventListener('change', () => { state.previewView = radio.value; save(); drawPreview(); }));

document.querySelectorAll('[data-layer]').forEach((cb) => {
  cb.checked = layers[cb.dataset.layer];
  cb.addEventListener('change', () => { layers[cb.dataset.layer] = cb.checked; drawPreview(); });
});

$('reset').addEventListener('click', () => { state = freshState(); fillInputs(); update(); toast('Reset to defaults'); });

function fillInputs() {
  for (const [key, { el }] of Object.entries(fields)) el.value = state[key] ?? '';
  $('rowsEnabled').checked = state.rowsEnabled !== false;
  syncPreset();
  const radio = document.querySelector(`input[name="bdiv"][value="${state.baselineDivisor}"]`);
  if (radio) radio.checked = true;
  const view = document.querySelector(`input[name="pview"][value="${state.previewView}"]`);
  if (view) view.checked = true;
  const layout = document.querySelector(`input[name="layout"][value="${state.facing === false ? 'single' : 'facing'}"]`);
  if (layout) layout.checked = true;
  stylesPanel.fill(state.styles);
  exportPanel.fill(state.export);
}

// ---------- compute & render ----------
// Rows are optional: without them the grid is one full-height row (no row guides).
const rowsOn = () => state.rowsEnabled !== false;
const gridInput = () => (rowsOn() ? state : { ...state, rows: 1, vertical: { ...state.vertical, gutter: 0 } });

$('rowsEnabled').addEventListener('change', (e) => { state.rowsEnabled = e.target.checked; update(); });

function update() {
  result = computeGrid(gridInput());
  // Write back snapped allocation so the request matches what's shown.
  if (result.allocation) {
    for (const a of Object.values(axis)) {
      const al = result.allocation[a.key];
      const keepGutter = a.key === 'vertical' && !rowsOn(); // remember the row gutter for when rows return
      Object.assign(state[a.key], { margins: al.total, [a.firstKey]: al[a.firstKey], ...(keepGutter ? {} : { gutter: al.gutter }) });
    }
  }
  save();
  render();
  stylesPanel.render(result);
  exportPanel.render(result, stylesPanel.compute(result));
  masonry?.schedule(); // cards may have changed height or visibility
}

const mm = (n) => `${round(n, 3)} mm`;
// Copyable values: shown to 3 dp, copied to 6 dp. Grid steps are irrational in mm/pt,
// so the extra precision stops tiny errors adding up over many gridlines.
const mmv = (n) => ({ show: `${round(n, 3)} mm`, copy: String(round(n, 6)) });
const ptv = (n) => ({ show: `${round(n, 3)} pt`, copy: String(round(n, 6)) });

function render() {
  const r = result;
  const errBox = $('errors');
  errBox.hidden = r.ok;
  errBox.innerHTML = r.ok ? '' : `<strong>Can't build this grid yet</strong><ul>${r.errors.map((e) => `<li>${e}</li>`).join('')}</ul>`;

  if (r.type) {
    $('outCorrected').textContent = `${round(r.type.correctedLeadingPt, 3)} pt`;
    $('outProportion').textContent = `${Math.round(r.type.proportion * 100)}%`;
    const hint = $('proportionHint');
    hint.classList.toggle('warn', !r.type.proportionOk);
    hint.innerHTML = r.type.proportionOk
      ? 'Comfortable body text usually sits between <span class="num">120%</span> and <span class="num">145%</span> of the point size.'
      : `At <span class="num">${Math.round(r.type.proportion * 100)}%</span> this leading is outside the usual <span class="num">120–145%</span> range for body text.`;
  }

  // Document layout: names for the horizontal margins and the Equal switch.
  const facing = state.facing !== false;
  const names = facing ? { first: 'Inside', second: 'Outside' } : { first: 'Left', second: 'Right' };
  $('layoutHint').textContent = facing
    ? 'Pages mirror across the spine: margins are inside and outside.'
    : 'Every page is the same: margins are left and right.';
  $('s2Title').textContent = `${names.first} & ${names.second.toLowerCase()} margins`;
  $('hFirstLabel').textContent = names.first;
  $('hSecondLabel').textContent = names.second;
  $('hEqualLabel').textContent = `Equal ${names.first.toLowerCase()} and ${names.second.toLowerCase()}`;
  const hal = r.allocation?.horizontal;
  $('hEqual').checked = !!state.horizontal.equal;
  $('hEqualHint').hidden = !(state.horizontal.equal && hal && !hal.equalAvailable);
  $('hInside').disabled = !!hal?.equal;
  document.querySelector('.seg[aria-label="Preview view"]').hidden = !facing; // single-sided: one page

  for (const a of Object.values(axis)) {
    const al = r.allocation?.[a.key];
    const local = r[a.key === 'horizontal' ? 'h' : 'v'];
    const opts = al?.options ?? local?.options ?? [];
    a.range.max = Math.max(0, opts.length - 1);
    a.range.disabled = opts.length < 2;
    if (al) {
      a.range.value = opts.indexOf(al.total);
      a.total.textContent = al.total;
      if (document.activeElement !== a.first) a.first.value = al[a.firstKey];
      if (document.activeElement !== a.gutter) a.gutter.value = state[a.key].gutter ?? al.gutter;
      a.first.max = al.total - 1;
      a.second.textContent = al.total - al[a.firstKey];
    } else {
      a.total.textContent = '–'; a.second.textContent = '–';
      if (document.activeElement !== a.gutter) a.gutter.value = state[a.key].gutter ?? '';
    }
  }

  if (!r.ok) {
    ['valBaseline', 'valGrids', 'valMargins', 'valGuides', 'valImage'].forEach((id) => ($(id).innerHTML = ''));
    $('summary').textContent = '';
    drawPreview();
    return;
  }

  const d = r.baseline.divisor;
  const n = (v) => `<span class="num">${v}</span>`;
  $('bdivHint').innerHTML = d === 1
    ? `Baselines sit one full leading apart. Pick ${n('÷ 2')} or ${n('÷ 4')} for a finer grid; body text keeps its leading.`
    : `Baselines every ${n(`${round(r.baseline.incrementPt, 3)} pt`)} (leading ${n(`÷ ${d}`)}). Body text still spaces at full leading; headings and spacing can use the finer steps. The document grid's vertical subdivisions are set to ${n(d)} to match.`;
  // Same order as InDesign's Grids preferences.
  values('valBaseline', [
    ['Start', mmv(r.baseline.start)],
    ['Relative to', { show: 'Top of Page', copy: null }],
    ['Increment every', ptv(r.baseline.incrementPt)],
  ]);
  const dg = r.documentGrid;
  values('valGrids', [
    ['Horizontal: gridline every', mmv(dg.horizontalEvery)],
    ['Horizontal: subdivisions', String(dg.horizontalSubdivisions)],
    ['Vertical: gridline every', mmv(dg.verticalEvery)],
    ['Vertical: subdivisions', String(dg.verticalSubdivisions)],
  ]);
  values('valMargins', [
    ['Top', mmv(r.margins.top)],
    ['Bottom', mmv(r.margins.bottom)],
    [r.marginNames.first, mmv(r.margins.inside)], // InDesign shows Inside/Outside or Left/Right to match Facing Pages
    [r.marginNames.second, mmv(r.margins.outside)],
    ['Columns', String(r.columns.number)],
    ['Column gutter', mmv(r.columns.gutter)],
  ]);
  values('valGuides', [
    ...(rowsOn() ? [['Rows', String(r.rows.number)], ['Row gutter', mmv(r.rows.gutter)]] : [['Rows', 'None']]),
    ['Columns', String(r.columns.number)],
    ['Column gutter', mmv(r.columns.gutter)],
  ]);

  $('rows').disabled = !rowsOn();
  $('vGutterField').hidden = !rowsOn();
  document.querySelector('[data-layer="rows"]').closest('label').hidden = !rowsOn();

  const il = r.imageLines;
  $('cardImage').hidden = !il;
  if (il) {
    values('valImage', [
      ['First guide Y', mmv(il.firstY)],
      ['Repeat count', String(il.repeatCount)],
      ['Vertical offset', mmv(il.offsetVertical)],
      ['Horizontal offset', mmv(il.offsetHorizontal)],
    ]);
  }

  $('summary').innerHTML =
    `${n(r.grid.lines)} baseline lines × ${n(r.grid.hUnits)} vertical units. ` +
    `Columns ${n(mm(r.columns.width))} (${n(r.columns.widthUnits)} units), ` +
    (rowsOn() ? `rows ${n(mm(r.rows.height))} (${n(r.rows.heightLines)} lines).` : 'no rows.');

  drawPreview();
}

/** Render label/value pairs. A value is a string (copied as shown) or { show, copy }. */
function values(id, pairs) {
  $(id).innerHTML = pairs
    .map(([k, v]) => {
      const { show, copy } = typeof v === 'string' ? { show: v, copy: v } : v;
      const dd = copy === null
        ? `<span class="copy static">${show}</span>`
        : `<button type="button" class="copy" data-copy="${copy}" title="Copy ${k} (${copy})">${show}</button>`;
      return `<div><dt>${k}</dt><dd>${dd}</dd></div>`;
    })
    .join('');
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset.copy);
    toast(`Copied ${btn.dataset.copy}`);
  } catch {
    toast("Couldn't copy — select the value and copy it manually");
  }
});

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
}

// ---------- preview ----------
const SVGNS = 'http://www.w3.org/2000/svg';
function el(tag, attrs, parent) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.setAttribute('vector-effect', 'non-scaling-stroke');
  parent?.appendChild(n);
  return n;
}

function drawPreview() {
  const svg = $('preview');
  svg.replaceChildren();
  const r = result;
  if (!r?.ok) { svg.setAttribute('viewBox', '0 0 100 70'); return; }
  const W = r.input.pageWidth, H = r.input.pageHeight;
  if (state.previewView === 'single' || !r.facing) {
    // One page. Facing: a right-hand page (inside margin on the left). Single-sided:
    // every page looks like this (left margin on the left).
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('aria-label', r.facing ? 'Single page showing the grid, inside margin on the left' : 'Page showing the grid, left margin on the left');
    drawPage(svg, r, 0, false);
    return;
  }
  svg.setAttribute('viewBox', `0 0 ${W * 2} ${H}`);
  svg.setAttribute('aria-label', 'Facing-pages spread showing the grid');
  // left = verso (inside margin on the right), right = recto (inside on the left)
  drawPage(svg, r, 0, true);
  drawPage(svg, r, W, false);
  el('line', { x1: W, y1: 0, x2: W, y2: H, class: 'spine' }, svg);
}

/** Name and size of each margin, centred in its band. */
function marginLabels(g, r, verso, W, H) {
  const m = r.margins;
  const fs = Math.max(2.6, Math.min(W, H) * 0.019); // mm, scales with the page
  const [first, second] = [r.marginNames.first.toUpperCase(), r.marginNames.second.toUpperCase()];
  const left = verso ? [second, m.outside] : [first, m.inside];
  const right = verso ? [first, m.inside] : [second, m.outside];
  const label = (x, y, [name, value]) => {
    const t = el('text', { x, y: y - fs * 0.15, 'text-anchor': 'middle', 'font-size': fs * 0.8, class: 'g-label-name' }, g);
    t.textContent = name;
    const v = el('text', { x, y: y + fs * 1.05, 'text-anchor': 'middle', 'font-size': fs, class: 'g-label' }, g);
    v.textContent = round(value, 2);
  };
  label(left[1] / 2, H / 2, left);
  label(W - right[1] / 2, H / 2, right);
  label(W / 2, m.top / 2, ['TOP', m.top]);
  label(W / 2, H - m.bottom / 2, ['BOTTOM', m.bottom]);
}

function drawPage(svg, r, ox, verso) {
  const W = r.input.pageWidth, H = r.input.pageHeight;
  const g = el('g', { transform: `translate(${ox} 0)` }, svg);
  el('rect', { x: 0, y: 0, width: W, height: H, class: 'pg' }, g);

  if (layers.docgrid) {
    for (let i = 1; i < r.grid.hUnits; i++) { const x = i * r.grid.unitMm; el('line', { x1: x, y1: 0, x2: x, y2: H, class: 'g-doc' }, g); }
    for (let j = 1; j < r.grid.lines; j++) { const y = j * r.grid.leadingMm; el('line', { x1: 0, y1: y, x2: W, y2: y, class: 'g-doc' }, g); }
  }

  const left = verso ? r.margins.outside : r.margins.inside;
  const top = r.margins.top;
  const cw = r.columns.width, cg = r.columns.gutter, rh = r.rows.height, rg = r.rows.gutter;
  const areaW = W - r.margins.inside - r.margins.outside;
  const areaH = H - r.margins.top - r.margins.bottom;

  if (layers.baseline) {
    for (let y = r.baseline.start; y < H; y += r.baseline.increment) {
      if (y > top && y <= top + areaH + 1e-6) el('line', { x1: left, y1: y, x2: left + areaW, y2: y, class: 'g-base' }, g);
    }
  }

  const colXs = Array.from({ length: r.columns.number }, (_, c) => left + c * (cw + cg));
  const rowYs = Array.from({ length: r.rows.number }, (_, k) => top + k * (rh + rg));
  if (layers.columns && layers.rows) {
    for (const x of colXs) for (const y of rowYs) el('rect', { x, y, width: cw, height: rh, class: 'g-col' }, g);
  } else if (layers.columns) {
    for (const x of colXs) el('rect', { x, y: top, width: cw, height: areaH, class: 'g-col' }, g);
  } else if (layers.rows) {
    for (const y of rowYs) el('rect', { x: left, y, width: areaW, height: rh, class: 'g-col' }, g);
  }

  if (layers.imagelines && r.imageLines) {
    for (let k = 0; k <= r.imageLines.repeatCount; k++) {
      const y = r.imageLines.firstY + k * r.imageLines.offsetVertical;
      el('line', { x1: 0, y1: y, x2: W, y2: y, class: 'g-img' }, g);
    }
  }

  el('rect', { x: left, y: top, width: areaW, height: areaH, class: 'g-margin' }, g);
  el('rect', { x: 0, y: 0, width: W, height: H, class: 'pg-edge' }, g); // page outline on top
  if (layers.labels) marginLabels(g, r, verso, W, H);
}

// ---------- Under the hood: tabs ----------
// One tab per InDesign dialog. Arrow keys / Home / End move between tabs (roving tabindex).
const hoodTabs = [...document.querySelectorAll('#cardHood [role="tab"]')];
function selectHoodTab(key, focus = false) {
  if (!hoodTabs.some((t) => t.dataset.tab === key)) key = hoodTabs[0].dataset.tab;
  for (const t of hoodTabs) {
    const on = t.dataset.tab === key;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute('aria-controls')).hidden = !on;
    if (on && focus) t.focus();
  }
  if (state.hoodTab !== key) { state.hoodTab = key; save(); }
  masonry?.schedule();
}
hoodTabs.forEach((t, i) => {
  t.addEventListener('click', () => selectHoodTab(t.dataset.tab));
  t.addEventListener('keydown', (e) => {
    const n = hoodTabs.length;
    const to = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    selectHoodTab(hoodTabs[to].dataset.tab, true);
  });
});
selectHoodTab(state.hoodTab);

// ---------- walkthrough ----------
const TOUR_KEY = 'gridmonkey:tour-seen';
const card = (h2) => ({ target: `#${h2}`, closest: '[data-track]' });
const TOUR_STEPS = [
  { title: 'Welcome to GridMonkey',
    body: 'GridMonkey builds an InDesign grid from your type. The leading sets the baseline grid, and every margin, column and row lands on a gridline. This tour takes about a minute.' },
  { ...card('s1'), title: 'Start with page and type',
    body: 'First choose <strong>Facing pages</strong> or <strong>Single-sided</strong>; the margins, preview and export follow it. Then enter the page size, font size and leading. The leading is adjusted slightly so the page height holds a whole number of lines. Halve the baseline increment for finer vertical steps if you need them. Then choose your columns and rows.' },
  { ...card('s2'), title: 'Margins in gridlines',
    body: 'Margins are counted in gridlines, not millimetres. The slider only offers totals that keep every column a whole number of units. Split the total between inside and outside (or left and right for a single-sided document), or tick Equal. Top and bottom work the same way.' },
  { ...card('h-preview'), title: 'See it as you go',
    body: 'The preview updates live. For facing pages, switch between <strong>Spread</strong> and <strong>Single page</strong> to judge inside and outside margins. Turn layers on and off.' },
  { ...card('s-styles'), title: 'Text styles that fit',
    body: 'GridMonkey builds body, heading and list styles in Graphik and Montserrat that sit on your grid. Choose weights, a heading scale and how paragraphs are separated. The button at the bottom downloads a script that creates these styles in an open InDesign document.' },
  { ...card('h-export'), title: 'A ready-made document',
    body: 'Preview an IDML file with everything in place: the grid, styles, swatches, guides, linked text frames, with dummy copy to show how text flows (the download leaves it out). Pick a single page, a double-sided sheet or four facing pages, then use <strong>Download IDML</strong> at the top of the page.' },
  { ...card('h-hood'), title: 'Under the hood',
    body: 'Setting up an existing document by hand? Each tab lists exactly what to type into one InDesign dialog (click any value to copy it), and the last tab lists every paragraph style.' },
  { title: 'You’re set',
    body: 'Click any card title to collapse it. Your settings are saved in this browser. Replay this tour any time with the <strong>?</strong> button at the top right, next to <strong>Reset to defaults</strong>.' },
];
const tour = createTour(TOUR_STEPS, {
  onClose: () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* storage unavailable */ } },
  // Open a collapsed card before spotlighting it.
  beforeStep: (s) => {
    const el = s.target && document.querySelector(s.target)?.closest('[data-track]');
    if (el?.classList.contains('is-collapsed')) el.querySelector('.collapse-btn')?.click();
  },
});
$('startTour').addEventListener('click', () => tour.start());

// ---------- boot ----------
$('appVersion').textContent = `v${VERSION}`;
renderIcons();
initCollapsible(document.querySelectorAll('.layout [data-track]'), {
  collapsed: state.collapsed,
  onChange: (ids) => { state.collapsed = ids; save(); masonry?.schedule(); },
});
fillInputs();
update();
masonry = createMasonry(document.querySelector('.layout'));

// First visit: run the walkthrough once the layout has settled.
let tourSeen = false;
try { tourSeen = localStorage.getItem(TOUR_KEY) === '1'; } catch { tourSeen = true; }
if (!tourSeen) setTimeout(() => tour.start(), 400);
