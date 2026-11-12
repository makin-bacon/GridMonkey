import { computeGrid, DEFAULTS, round } from '../src/core/grid.js';
import { STYLE_DEFAULTS } from '../src/core/styles.js';
import { createStylesPanel } from './styles-panel.js';
import { createMasonry } from './masonry.js';
import { createExportPanel } from './export-panel.js';
import { initCollapsible } from './collapse.js';
import { createTour } from './tour.js';
import { VERSION } from '../src/core/version.js';

const STORAGE_KEY = 'gridmonkey:v1';
const $ = (id) => document.getElementById(id);

// ---------- state ----------
const EXPORT_DEFAULTS = { format: 'single', showMaster: false, showThreads: true };
const freshState = () => structuredClone({ ...DEFAULTS, previewView: 'spread', collapsed: [], styles: { ...STYLE_DEFAULTS }, export: { ...EXPORT_DEFAULTS } });
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
      styles: { ...fresh.styles, ...(saved.styles || {}) },
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

$('reset').addEventListener('click', () => { state = freshState(); fillInputs(); update(); toast('Reset to A4 defaults'); });

function fillInputs() {
  for (const [key, { el }] of Object.entries(fields)) el.value = state[key] ?? '';
  syncPreset();
  const radio = document.querySelector(`input[name="bdiv"][value="${state.baselineDivisor}"]`);
  if (radio) radio.checked = true;
  const view = document.querySelector(`input[name="pview"][value="${state.previewView}"]`);
  if (view) view.checked = true;
  stylesPanel.fill(state.styles);
  exportPanel.fill(state.export);
}

// ---------- compute & render ----------
function update() {
  result = computeGrid(state);
  // Write back snapped allocation so the request matches what's shown.
  if (result.allocation) {
    for (const a of Object.values(axis)) {
      const al = result.allocation[a.key];
      Object.assign(state[a.key], { margins: al.total, [a.firstKey]: al[a.firstKey], gutter: al.gutter });
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
      if (document.activeElement !== a.gutter) a.gutter.value = al.gutter;
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
    ['Inside', mmv(r.margins.inside)],
    ['Outside', mmv(r.margins.outside)],
    ['Columns', String(r.columns.number)],
    ['Column gutter', mmv(r.columns.gutter)],
  ]);
  values('valGuides', [
    ['Rows', String(r.rows.number)],
    ['Row gutter', mmv(r.rows.gutter)],
    ['Columns', String(r.columns.number)],
    ['Column gutter', mmv(r.columns.gutter)],
  ]);

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
    `Columns ${n(mm(r.columns.width))} (${n(r.columns.widthUnits)} units), rows ${n(mm(r.rows.height))} (${n(r.rows.heightLines)} lines).`;

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
  if (state.previewView === 'single') {
    // One right-hand page: inside margin on the left, as on a single-sided sheet.
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('aria-label', 'Single page showing the grid, inside margin on the left');
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
  const left = verso ? ['OUTSIDE', m.outside] : ['INSIDE', m.inside];
  const right = verso ? ['INSIDE', m.inside] : ['OUTSIDE', m.outside];
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
  if (layers.labels) marginLabels(g, r, verso, W, H);
}

// ---------- walkthrough ----------
const TOUR_KEY = 'gridmonkey:tour-seen';
const card = (h2) => ({ target: `#${h2}`, closest: '[data-track]' });
const TOUR_STEPS = [
  { title: 'Welcome to GridMonkey',
    body: 'GridMonkey builds an InDesign grid from your type. The leading sets the baseline grid, and every margin, column and row lands on a gridline. This tour takes about a minute.' },
  { ...card('s1'), title: 'Start with page and type',
    body: 'Enter the page size, font size and leading. The leading is adjusted slightly so the page height holds a whole number of lines. Then choose your columns and rows.' },
  { ...card('s2'), title: 'Margins in gridlines',
    body: 'Margins are counted in gridlines, not millimetres. The slider only offers totals that keep every column a whole number of units. Split the total between inside and outside. Top and bottom work the same way.' },
  { ...card('h-preview'), title: 'See it as you go',
    body: 'The preview updates live. Switch between <strong>Spread</strong> and <strong>Single page</strong> to judge inside and outside margins, and turn layers on and off.' },
  { ...card('h-grids'), title: 'Values for InDesign',
    body: 'These cards list exactly what to type into each InDesign dialog. Click any value to copy it. You can halve the baseline increment here for finer vertical steps.' },
  { ...card('s5'), title: 'Text styles that fit',
    body: 'GridMonkey builds body, heading and list styles in Graphik and Montserrat that sit on your grid. Choose weights, a heading scale and how paragraphs are separated.' },
  { ...card('h-styles'), title: 'Styles script',
    body: 'Download a script that sets the baseline grid and creates these styles in an open InDesign document.' },
  { ...card('h-export'), title: 'Download a ready-made document',
    body: 'Or download an IDML file with everything in place: the grid, styles, guides, linked text frames and dummy copy. Pick a single page, a double-sided sheet or four facing pages.' },
  { title: 'You’re set',
    body: 'Click any card title to collapse it. Your settings are saved in this browser. Replay this tour any time from <strong>Take the tour</strong>.' },
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
