// Course-block sample content for the InDesign document preview (display only).
// Lays out the COURSE-BLOCK table from src/core/sample-content.js with the current
// styles: GridMonkey's own (Body, Medium) and the imported library (COURSE-TABLE-HEAD,
// Body-qtr-space, Pathway-lozenge, QR-Block-Style, Course-QR-Text), so the blocks
// grow and shrink with the type and the grid. Line breaks use browser fonts.

import { mmToPt } from '../src/core/grid.js';
import { resolveValue, findLibraryStyle } from '../src/core/library.js';
import { COURSE, COURSE_TABLE } from '../src/core/sample-content.js';
import { SWATCHES } from '../src/core/swatches.js';
import { fontFor, requestFonts } from './flow.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const CAP = 0.7; // cap height estimate (em), for centring text in rows
// Cell text is sized like InDesign does it: from the font's ascent on the first line
// (FirstBaselineOffset = AscentOffset) to its descent on the last, not whole lines.
const FALLBACK_ASC = 0.73;
const FALLBACK_DESC = 0.19;
const rgb = (name) => { const s = SWATCHES.find((c) => c.name === name); return s ? `rgb(${s.value.join(' ')})` : '#a0cfca'; };

let ctx;
const measure = (text, css) => { ctx ??= document.createElement('canvas').getContext('2d'); ctx.font = css; return ctx.measureText(text).width; };
/** Font ascent and descent in pt (canvas px = pt here), from the font's own metrics. */
function vmetrics(font) {
  ctx ??= document.createElement('canvas').getContext('2d');
  ctx.font = font.css;
  const t = ctx.measureText('Hg');
  const size = Number(font.css.match(/ ([\d.]+)px /)[1]);
  const asc = t.fontBoundingBoxAscent, desc = t.fontBoundingBoxDescent;
  return Number.isFinite(asc) && asc > 0 ? { asc, desc } : { asc: FALLBACK_ASC * size, desc: FALLBACK_DESC * size };
}
/** Height of `n` lines of text set in `font` with leading `L`, ascent to descent. */
const textHeight = (n, font, L) => { const v = vmetrics(font); return n ? v.asc + (n - 1) * L + v.desc : 0; };

/** Greedy line breaking over styled runs: [[font, text]] → [[{ text, font }]] per line. */
function wrapRuns(runs, width) {
  const words = runs.flatMap(([font, text]) => text.split(/(\s+)/).filter((w) => w && !/^\s+$/.test(w)).map((w, i, a) => ({ text: w, font, lead: i > 0 || /^\s/.test(text) })));
  const lines = [];
  let line = [];
  let w = 0;
  for (const word of words) {
    const space = line.length ? measure(' ', word.font.css) : 0;
    const ww = measure(word.text, word.font.css);
    if (line.length && w + space + ww > width) { lines.push(line); line = []; w = 0; }
    line.push({ text: (line.length ? ' ' : '') + word.text, font: word.font });
    w += (line.length > 1 ? space : 0) + ww;
  }
  if (line.length) lines.push(line);
  return lines;
}

/** Everything the block needs from the styles, in pt. */
function metrics(grid, styles, lib) {
  const scale = lib.scale;
  const v = (m, key = '') => resolveValue(m, key, scale);
  const body = styles.styles.find((s) => s.role === 'body');
  const font = (over) => fontFor({ ...body, ...over });
  const attr = (kind, name, key, fallback) => findLibraryStyle(lib, kind, name)?.attrs[key] ?? fallback;
  const head = findLibraryStyle(lib, 'paragraph', 'COURSE-TABLE-HEAD');
  const headFamily = head?.properties.find((p) => p.raw?.startsWith('<AppliedFont'))?.raw.match(/>([^<]+)</)?.[1] ?? 'Montserrat';
  const qrSize = Number(attr('character', 'Course-QR-Text', 'PointSize', body.pointSize * 0.83));
  const qrStyle = styles.objectStyles?.find((o) => o.name === 'QR-Code');
  return {
    L: body.leading,
    size: body.pointSize,
    bodyAfter: mmToPt(body.spaceAfter),
    qtrAfter: Number(attr('paragraph', 'Body-qtr-space', 'SpaceAfter', 0)),
    fonts: {
      body: font({}),
      medium: font({ fontStyle: 'Medium' }),
      head: fontFor({ appliedFont: headFamily, fontStyle: head?.attrs.FontStyle ?? 'SemiBold', pointSize: Number(head?.attrs.PointSize ?? body.pointSize) }),
      qr: font({ pointSize: qrSize }),
    },
    headSize: Number(head?.attrs.PointSize ?? body.pointSize),
    qrSize,
    pathway: {
      indent: Number(attr('paragraph', 'Pathway-lozenge', 'LeftIndent', 0)),
      shift: -Number(attr('paragraph', 'Pathway-lozenge', 'BaselineShift', 0)), // negative = down
      top: Number(attr('paragraph', 'Pathway-lozenge', 'ParagraphShadingTopOffset', body.pointSize)),
      bottom: Number(attr('paragraph', 'Pathway-lozenge', 'ParagraphShadingBottomOffset', body.pointSize)),
      right: Number(attr('paragraph', 'Pathway-lozenge', 'ParagraphShadingRightOffset', 0)),
      radius: Number(attr('paragraph', 'Pathway-lozenge', 'ParagraphShadingTopLeftCornerRadius', body.pointSize)),
    },
    qr: {
      indent: Number(attr('paragraph', 'QR-Block-Style', 'LeftIndent', 0)),
      before: Number(attr('paragraph', 'QR-Block-Style', 'SpaceBefore', body.leading)),
      // The QR-Code object style (styles.js): box size and text wrap offset.
      box: qrStyle ? mmToPt(qrStyle.width) : v(COURSE_TABLE.qrSize),
      wrap: qrStyle ? mmToPt(qrStyle.textWrap.offset.right) : v(COURSE_TABLE.qrWrap),
    },
    icon: v(COURSE_TABLE.pathwayIcon),
    inset: {
      head: [v(COURSE_TABLE.insets.header.top), v(COURSE_TABLE.insets.header.bottom)],
      values: [v(COURSE_TABLE.insets.values.top), v(COURSE_TABLE.insets.values.bottom)],
      bottom: [Number(attr('cell', 'BOTTOM-ROW', 'TextTopInset', v(COURSE_TABLE.insets.values.top))), Number(attr('cell', 'BOTTOM-ROW', 'TextBottomInset', body.leading * 1.5))],
      side: v(COURSE_TABLE.insets.side),
    },
    gap: v(COURSE_TABLE.gapAfter),
  };
}

/**
 * Lay out one block `W` pt wide. Returns { rows: [{ h, ops }] } with each row's ops in
 * pt from that row's top-left. Rows are what flow between frames: InDesign breaks a
 * table between rows, never inside one.
 */
function layoutBlock(W, m) {
  const all = [];
  let rowIndex = 0;
  const ops = { push: (o) => all.push({ ...o, r: rowIndex }) };
  const xs = [0];
  for (const f of COURSE_TABLE.columns) xs.push(xs[xs.length - 1] + f * W);
  const cells = (list) => { let c = 0; return list.map(([content, span]) => { const cell = { x: xs[c], w: xs[c + span] - xs[c], content }; c += span; return cell; }); };
  const runFont = (cs) => (cs === 'Medium' ? m.fonts.medium : m.fonts.body);
  const text = (x, y, line) => ops.push({ t: 'text', x, y, segs: line });

  // A row of single-paragraph cells, text centred vertically (CenterAlign).
  const row = (y, list, toRuns, [top, bottom], fill) => {
    const laid = cells(list).map((c) => ({ ...c, lines: wrapRuns(toRuns(c.content), c.w - 2 * m.inset.side) }));
    const cellFont = (c) => c.lines[0]?.[0]?.font ?? m.fonts.body;
    const h = top + Math.max(...laid.map((c) => textHeight(c.lines.length, cellFont(c), m.L))) + bottom;
    if (fill) {
      ops.push({ t: 'rect', x: 0, y, w: W, h, cls: 'ex-cell-head' });
      for (const c of laid.slice(1)) ops.push({ t: 'line', x1: c.x, y1: y, x2: c.x, y2: y + h, cls: 'ex-cell-sep' });
    }
    for (const c of laid) {
      // CenterAlign: the text block (ascent to descent) sits in the middle of the cell.
      const f = cellFont(c);
      const first = y + (h - textHeight(c.lines.length, f, m.L)) / 2 + vmetrics(f).asc;
      c.lines.forEach((line, i) => text(c.x + m.inset.side, first + i * m.L, line));
    }
    return h;
  };

  const heights = [];
  let y = 0;
  heights.push(row(y, COURSE.header, (t) => [[m.fonts.head, t]], m.inset.head, true));
  y += heights[0];
  rowIndex = 1;
  heights.push(row(y, COURSE.values, (runs) => runs.map(([cs, t]) => [runFont(cs), t]), m.inset.values, false));
  y += heights[1];
  rowIndex = 2;
  ops.push({ t: 'line', x1: 0, y1: y, x2: W, y2: y, cls: 'ex-cell-rule' }); // BOTTOM-ROW top edge (10% black)

  // Bottom row: description (columns 1–3) and pathway + QR (columns 4–7).
  const [left, right] = [{ x: xs[0], w: xs[3] - xs[0] }, { x: xs[3], w: xs[7] - xs[3] }];
  const top = y + m.inset.bottom[0];
  let ly = top + vmetrics(m.fonts.body).asc; // first baseline (AscentOffset)
  let lastBase = ly;
  COURSE.description.forEach(([style, runs], p) => {
    const lines = wrapRuns(runs.map(([cs, t]) => [runFont(cs), t]), left.w - 2 * m.inset.side);
    lines.forEach((line, i) => text(left.x + m.inset.side, ly + i * m.L, line));
    lastBase = ly + (lines.length - 1) * m.L;
    ly = lastBase + m.L + (style === 'Body-qtr-space' ? m.qtrAfter : m.bodyAfter);
  });

  const cx = right.x + m.inset.side;
  const pw = m.pathway;
  const b1 = top + pw.top; // first baseline: the shading's top offset sits above it
  const bN = b1 + (COURSE.pathway.lines.length - 1) * m.L;
  const pillX = cx + m.qr.indent; // aligned with the QR block, as in the source
  const pillR = right.x + right.w - m.inset.side + pw.right;
  const pillH = pw.top + (bN - b1) + pw.bottom;
  ops.push({ t: 'rect', x: pillX, y: b1 - pw.top, w: pillR - pillX, h: pillH, rx: Math.min(pw.radius, pillH / 2), fill: rgb('RGB-SCU Teal') });
  ops.push({ t: 'icon', x: cx + pw.indent, y: b1 + pw.shift - CAP * m.size, s: m.icon * 0.75 });
  const tx = cx + pw.indent + m.icon + measure('  ', m.fonts.medium.css);
  COURSE.pathway.lines.forEach((l, i) => text(tx, b1 + pw.shift + i * m.L, [{ text: l, font: m.fonts.medium }]));

  const qy = b1 - pw.top + pillH + m.qr.before;
  const qx = cx + m.qr.indent;
  ops.push({ t: 'qr', x: qx, y: qy, s: m.qr.box });
  // The QR has text wrap on (offset 1 grid unit), so the caption starts 1 unit past
  // its right edge; the caption's lines are centred on the QR's midpoint.
  const qrLine = m.qrSize * 1.2; // Auto leading
  const n = COURSE.qr.lines.length;
  const firstBase = qy + m.qr.box / 2 - ((n - 1) * qrLine) / 2 + (CAP * m.qrSize) / 2;
  COURSE.qr.lines.forEach((l, i) => text(qx + m.qr.box + m.qr.wrap, firstBase + i * qrLine, [{ text: l, font: m.fonts.qr }]));

  const leftH = lastBase + vmetrics(m.fonts.body).desc - top;
  heights.push(Math.max(leftH, qy + m.qr.box - top) + m.inset.bottom[0] + m.inset.bottom[1]);
  // Re-base each row's ops on its own top.
  const tops = [0, heights[0], heights[0] + heights[1]];
  const shift = (o, dy) => ({ ...o, y: o.y - dy, y1: o.y1 - dy, y2: o.y2 - dy });
  return { rows: heights.map((h, r) => ({ h, ops: all.filter((o) => o.r === r).map((o) => shift(o, tops[r])) })) };
}

/**
 * With grid rows: each table starts on a row's top edge and fills whole grid rows
 * (its bottom row stretches, as a minimum row height would in InDesign); the table
 * style's space after (= the row gutter) brings the next table to the next row top.
 * A table that doesn't fit the rows left in a frame moves to the next frame.
 */
function intoGridRows(g, grid, frames, layoutFor, k) {
  const rowH = grid.rows.height * k;
  const gut = grid.rows.gutter * k;
  const n = grid.rows.number;
  let blocks = 0;
  let r = 0;
  for (let fi = 0; fi < frames.length;) {
    const f = frames[fi];
    const { rows } = layoutFor(f);
    const natural = rows.reduce((h, row) => h + row.h, 0);
    const span = Math.max(1, Math.ceil((natural + gut) / (rowH + gut) - 1e-9)); // grid rows this table needs
    if (span > n) break; // taller than a whole frame
    if (r + span > n) { fi++; r = 0; continue; }
    let y = f.ay * k + r * (rowH + gut);
    for (const row of rows) { drawOps(g, row.ops, f.ax * k, y, k); y += row.h; }
    blocks++;
    r += span;
  }
  return { blocks };
}

function el(tag, a, parent) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, val] of Object.entries(a)) n.setAttribute(k, val);
  parent.appendChild(n);
  return n;
}

function drawOps(g, ops, ox, oy, k) {
  const mm = (pt) => pt / k;
  for (const o of ops) {
    if (o.t === 'rect') el('rect', { x: mm(ox + o.x), y: mm(oy + o.y), width: mm(o.w), height: mm(o.h), rx: mm(o.rx ?? 0), ...(o.cls ? { class: o.cls } : { fill: o.fill }) }, g);
    else if (o.t === 'line') el('line', { x1: mm(ox + o.x1), y1: mm(oy + o.y1), x2: mm(ox + o.x2), y2: mm(oy + o.y2), class: o.cls, 'vector-effect': 'non-scaling-stroke' }, g);
    else if (o.t === 'text') {
      const t = el('text', { x: mm(ox + o.x), y: mm(oy + o.y), class: 'ex-line' }, g);
      for (const s of o.segs) {
        const ts = el('tspan', { 'font-size': mm(Number(s.font.css.match(/ ([\d.]+)px /)[1])), 'font-family': s.font.family, 'font-weight': s.font.weight }, t);
        ts.textContent = s.text;
      }
    } else if (o.t === 'icon') {
      // Stand-in for the shuffle glyph: two crossing arrows.
      const x = mm(ox + o.x), y = mm(oy + o.y), s = mm(o.s);
      el('path', { d: `M${x} ${y + s} L${x + s} ${y} M${x} ${y} L${x + s} ${y + s}`, class: 'ex-icon', 'vector-effect': 'non-scaling-stroke' }, g);
    } else if (o.t === 'qr') {
      // Stand-in QR: three finder patterns (ring + centre) and a light dot field.
      const x = mm(ox + o.x), y = mm(oy + o.y), s = mm(o.s), f = s * 0.3, c = f * 0.4;
      for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
        if ((i < 3 && j < 3) || (i > 3 && j < 3) || (i < 3 && j > 3) || (i * 7 + j) % 3 === 1) continue;
        el('rect', { x: x + (i / 7) * s, y: y + (j / 7) * s, width: s / 7, height: s / 7, class: 'ex-qr-dot' }, g);
      }
      for (const [fx, fy] of [[0, 0], [s - f, 0], [0, s - f]]) {
        el('rect', { x: x + fx + f * 0.08, y: y + fy + f * 0.08, width: f * 0.84, height: f * 0.84, class: 'ex-qr-ring', 'vector-effect': 'non-scaling-stroke' }, g);
        el('rect', { x: x + fx + (f - c) / 2, y: y + fy + (f - c) / 2, width: c, height: c, class: 'ex-qr-finder' }, g);
      }
    }
  }
}

/**
 * Flow course blocks through the threaded document frames, one table after another
 * (as when they're pasted into the parent text frame). A row that doesn't fit moves
 * to the next frame; only whole blocks are drawn, so nothing is shown overset.
 * @param frames [{ ax, ay, w, h }] absolute mm, in thread order
 * @returns { blocks } blocks placed
 */
export function drawCourseBlocks(svg, grid, styles, lib, frames) {
  const k = mmToPt(1);
  const m = metrics(grid, styles, lib);
  requestFonts(Object.values(m.fonts).map((f) => f.css));
  const g = el('g', { class: 'ex-text' }, svg);
  const layouts = new Map(); // frame width → block layout
  const layoutFor = (f) => layouts.get(f.w) ?? layouts.set(f.w, layoutBlock(f.w * k, m)).get(f.w);
  if (grid.rows.number > 1) return intoGridRows(g, grid, frames, layoutFor, k);
  let fi = 0;
  let y = frames.length ? frames[0].ay * k : 0;
  let atTop = true;
  let blocks = 0;
  while (fi < frames.length) {
    // Place one block's rows without drawing, then commit if it all fits.
    const placed = [];
    let [cf, cy, top] = [fi, atTop ? y : y + m.gap, atTop];
    for (const row of layoutFor(frames[cf]).rows) {
      while (cf < frames.length && cy + row.h > (frames[cf].ay + frames[cf].h) * k + 1e-6) {
        if (top) { cf = frames.length; break; } // taller than a whole frame
        cf++;
        if (cf < frames.length) { cy = frames[cf].ay * k; top = true; }
      }
      if (cf >= frames.length) break;
      placed.push({ row, f: frames[cf], y: cy });
      cy += row.h;
      top = false;
    }
    if (placed.length < 3) break;
    for (const p of placed) drawOps(g, p.row.ops, p.f.ax * k, p.y, k);
    blocks++;
    [fi, y, atTop] = [cf, cy, false];
  }
  return { blocks };
}
