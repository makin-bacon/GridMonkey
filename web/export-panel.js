// Export panel: pick a document format, preview it in context (pages, parent spread,
// threaded frames, flowed dummy copy, guides) and download it as IDML.
import { mmToPt } from '../src/core/grid.js';
import { computeDocument, fitStory, FORMATS } from '../src/core/document.js';
import { buildIdml } from '../src/core/idml.js';
import { flowText, requestFonts, svgText } from './flow.js';

const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const ROW_GAP = 14; // mm between spreads in the preview
const LABEL = 7; // mm reserved under each spread for page labels

export function createExportPanel({ options, onChange }) {
  let opts = { format: 'single', showMaster: false, showThreads: true, ...options };
  let last = null; // { grid, styles, doc }

  $('exportFormat').innerHTML = FORMATS.map((f) => `<option value="${f.id}">${f.label}</option>`).join('');
  const bind = (id, key, prop) => $(id).addEventListener('change', (e) => {
    opts = { ...opts, [key]: e.target[prop] };
    onChange({ ...opts });
    if (last) render(last.grid, last.styles);
  });
  bind('exportFormat', 'format', 'value');
  bind('exportMaster', 'showMaster', 'checked');
  bind('exportThreads', 'showThreads', 'checked');

  $('downloadIdml').addEventListener('click', () => {
    if (!last?.doc?.ok) return;
    const bytes = buildIdml(last.grid, last.styles, last.doc);
    const blob = new Blob([bytes], { type: 'application/vnd.adobe.indesign-idml-package' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `gridmonkey-${last.doc.format.id}.idml`,
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  document.fonts.addEventListener('loadingdone', () => last && render(last.grid, last.styles));

  function fill(next) {
    opts = { ...opts, ...next };
    $('exportFormat').value = opts.format;
    $('exportMaster').checked = opts.showMaster;
    $('exportThreads').checked = opts.showThreads;
  }

  function render(grid, styles) {
    const doc = computeDocument(grid, styles, opts.format);
    last = { grid, styles, doc };
    $('downloadIdml').disabled = !doc.ok;
    const svg = $('exportPreview');
    svg.replaceChildren();
    if (!doc.ok) { $('exportSummary').textContent = doc.errors.join(' '); return; }
    draw(svg, grid, styles, doc, opts, last);
  }

  fill(opts);
  return { fill, render };
}

// ---------- drawing (SVG units = mm) ----------
function el(tag, a, parent) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(a)) n.setAttribute(k, v);
  if (tag !== 'text' && tag !== 'g') n.setAttribute('vector-effect', 'non-scaling-stroke');
  parent?.appendChild(n);
  return n;
}

function draw(svg, grid, styles, doc, opts, last) {
  const W = doc.pageWidth;
  const H = doc.pageHeight;
  const facing = doc.format.facing;
  const spreadW = facing ? 2 * W : W;
  const xOf = (side) => (side === 'verso' ? 0 : facing ? W : 0); // page x within its spread row

  // Rows: optional parent spread, then each document spread.
  const rows = [];
  if (opts.showMaster) rows.push({ master: true, pages: doc.master.pages.map((side, i) => ({ side, i })) });
  doc.spreads.forEach((idxs) => rows.push({ master: false, pages: idxs.map((i) => ({ side: doc.pages[i].side, i })) }));
  const rowH = H + LABEL;
  svg.setAttribute('viewBox', `-2 -2 ${spreadW + 4} ${rows.length * rowH + (rows.length - 1) * ROW_GAP + 4}`);

  // Absolute placement (mm) of every page, for frames, threads and flow.
  const place = { doc: [], master: [] };
  rows.forEach((row, r) => {
    const y0 = r * (rowH + ROW_GAP);
    const g = el('g', {}, svg);
    for (const p of row.pages) {
      const x0 = xOf(p.side);
      (row.master ? place.master : place.doc)[p.i] = { x0, y0 };
      drawPage(g, grid, doc, x0, y0, p.side);
      const label = row.master ? `${doc.master.prefix} · ${p.side === 'verso' ? 'left' : p.side === 'recto' ? 'right' : 'page'}` : `Page ${doc.pages[p.i].name}`;
      el('text', { x: x0 + W / 2, y: y0 + H + 5, 'text-anchor': 'middle', class: 'ex-label' }, g).textContent = label;
    }
    if (facing && row.pages.length === 2) el('line', { x1: W, y1: y0, x2: W, y2: y0 + H, class: 'ex-spine' }, g);
    if (row.master) el('text', { x: 0, y: y0 - 3, class: 'ex-label ex-label-strong' }, g).textContent = `${doc.master.name} (parent spread)`;
  });

  // Image placeholder on page 1.
  if (doc.image) {
    const p = place.doc[doc.image.page];
    const r = { x: p.x0 + doc.image.x, y: p.y0 + doc.image.y, w: doc.image.w, h: doc.image.h };
    el('rect', { x: r.x, y: r.y, width: r.w, height: r.h, class: 'ex-image' }, svg);
    el('line', { x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y + r.h, class: 'ex-image-x' }, svg);
    el('line', { x1: r.x + r.w, y1: r.y, x2: r.x, y2: r.y + r.h, class: 'ex-image-x' }, svg);
  }

  // Frames (document + parent) and their column slots.
  const absFrames = (frames, placement) => frames.map((f) => ({ ...f, ax: placement[f.page].x0 + f.x, ay: placement[f.page].y0 + f.y }));
  const docFrames = absFrames(doc.frames, place.doc);
  const masterFrames = opts.showMaster ? absFrames(doc.master.frames, place.master) : [];
  for (const f of [...masterFrames, ...docFrames]) drawFrame(svg, f);

  // Flow the dummy story through the document frames (pt for flow, mm for drawing).
  const k = mmToPt(1);
  const slots = docFrames.flatMap((f) => {
    const colW = (f.w - (f.columns - 1) * f.gutter) / f.columns;
    return Array.from({ length: f.columns }, (_, c) => ({
      x: (f.ax + c * (colW + f.gutter)) * k, top: f.ay * k, bottom: (f.ay + f.h) * k, width: colW * k,
    }));
  });
  // Flow the generous dummy copy, then keep only whole paragraphs that fit, so the
  // document opens without overset text. The trimmed story is what gets downloaded.
  const full = flowText(doc.story, styles, slots);
  requestFonts(full.fonts);
  const fitted = fitStory(doc, full.placed);
  last.doc = fitted;
  const flow = { ...full, items: full.items.filter((it) => it.para < fitted.story.length), overset: false };
  const textLayer = el('g', { class: 'ex-text' }, svg);
  for (const it of flow.items) svgText(textLayer, it, 'ex-line', 1 / k);

  // Text threads, like InDesign's View › Extras › Show Text Threads.
  if (opts.showThreads) {
    drawThreads(svg, docFrames, flow.overset);
    if (masterFrames.length) drawThreads(svg, masterFrames, false);
  }

  const n = doc.pages.length;
  const cols = doc.frames[0].columns;
  const num = (v) => `<span class="num">${v}</span>`;
  $('exportSummary').innerHTML = [
    `${num(n)} page${n > 1 ? 's' : ''}${facing ? ', facing pages' : ''}.`,
    `Text frames have ${num(cols)} column${cols > 1 ? 's' : ''}${n > 1 ? ' and are threaded page to page' : ''}.`,
    `The parent spread has ${doc.master.frames.length > 1 ? 'two linked text frames' : 'one text frame'}.`,
    flow.overset ? 'The dummy copy runs past the last frame (overset).' : '',
  ].filter(Boolean).join(' ');
}

function drawPage(g, grid, doc, x0, y0, side) {
  const W = doc.pageWidth;
  const H = doc.pageHeight;
  const m = grid.margins;
  el('rect', { x: x0, y: y0, width: W, height: H, class: 'ex-page' }, g);
  const left = x0 + (side === 'verso' ? m.outside : m.inside);
  const top = y0 + m.top;
  const areaH = H - m.top - m.bottom;
  // Column guides (violet), margin box (magenta) — InDesign's default guide colours.
  for (let c = 0; c < grid.columns.number; c++) {
    const x = left + c * (grid.columns.width + grid.columns.gutter);
    if (c > 0) el('line', { x1: x, y1: top, x2: x, y2: top + areaH, class: 'ex-colguide' }, g);
    if (c < grid.columns.number - 1) el('line', { x1: x + grid.columns.width, y1: top, x2: x + grid.columns.width, y2: top + areaH, class: 'ex-colguide' }, g);
  }
  for (const y of doc.guides.rows) el('line', { x1: x0, y1: y0 + y, x2: x0 + W, y2: y0 + y, class: 'ex-rowguide' }, g);
  for (const y of doc.guides.imageLines) el('line', { x1: x0, y1: y0 + y, x2: x0 + W, y2: y0 + y, class: 'ex-imgguide' }, g);
  el('rect', { x: left, y: top, width: W - m.inside - m.outside, height: areaH, class: 'ex-margin' }, g);
}

function drawFrame(svg, f) {
  el('rect', { x: f.ax, y: f.ay, width: f.w, height: f.h, class: 'ex-frame' }, svg);
  const colW = (f.w - (f.columns - 1) * f.gutter) / f.columns;
  for (let c = 1; c < f.columns; c++) {
    const x = f.ax + c * (colW + f.gutter);
    el('line', { x1: x - f.gutter, y1: f.ay, x2: x - f.gutter, y2: f.ay + f.h, class: 'ex-frame-col' }, svg);
    el('line', { x1: x, y1: f.ay, x2: x, y2: f.ay + f.h, class: 'ex-frame-col' }, svg);
  }
}

function drawThreads(svg, frames, overset) {
  const PORT = 2.4; // mm
  frames.forEach((f, i) => {
    const inPort = { x: f.ax + 4, y: f.ay };
    const outPort = { x: f.ax + f.w - 4, y: f.ay + f.h };
    el('rect', { x: inPort.x - PORT / 2, y: inPort.y - PORT / 2, width: PORT, height: PORT, class: 'ex-port' }, svg);
    el('rect', { x: outPort.x - PORT / 2, y: outPort.y - PORT / 2, width: PORT, height: PORT, class: i === frames.length - 1 && overset ? 'ex-port ex-overset' : 'ex-port' }, svg);
    if (i === frames.length - 1 && overset) {
      el('line', { x1: outPort.x - 0.8, y1: outPort.y, x2: outPort.x + 0.8, y2: outPort.y, class: 'ex-overset-mark' }, svg);
      el('line', { x1: outPort.x, y1: outPort.y - 0.8, x2: outPort.x, y2: outPort.y + 0.8, class: 'ex-overset-mark' }, svg);
    }
    const next = frames[i + 1];
    if (next) {
      const to = { x: next.ax + 4, y: next.ay };
      const midY = (outPort.y + to.y) / 2;
      el('path', { d: `M${outPort.x} ${outPort.y} C${outPort.x} ${midY} ${to.x} ${midY} ${to.x} ${to.y}`, class: 'ex-thread' }, svg);
    }
  });
}
