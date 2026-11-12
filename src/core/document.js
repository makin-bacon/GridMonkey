// Document model for export: pages, spreads, threaded text frames, guides, an image
// placeholder and dummy copy. Shared by the IDML writer and the in-app preview so
// what you see is what you download. All geometry is in mm, relative to each page's
// top-left corner. Pure.

import { mmToPt } from './grid.js';
import { dummyParagraphs, resolveParagraphs } from './dummy.js';

export const FORMATS = Object.freeze([
  { id: 'single', label: 'Single page (one-sided)', pages: 1, facing: false },
  { id: 'double', label: 'Double-sided (2 pages)', pages: 2, facing: true },
  { id: 'facing4', label: '4 pages, facing spreads', pages: 4, facing: true },
]);

const MIN_CHARS_PER_LINE = 40; // narrowest comfortable text column
const FILL = 1.2; // generate more copy than fits; the preview trims it to whole paragraphs (see fitStory)

/** Text columns per frame: the most columns (dividing the grid evenly) that keep lines ≥ 40 chars. */
export function textColumns(grid) {
  const { number: cols, width: cw, gutter: cg } = grid.columns;
  const minWidthMm = (MIN_CHARS_PER_LINE * 0.5 * grid.input.fontSize) / mmToPt(1);
  for (let d = cols; d >= 1; d--) {
    if (cols % d) continue;
    const span = cols / d;
    if (span * cw + (span - 1) * cg >= minWidthMm) return d;
  }
  return 1;
}

/**
 * Trim the story to the first `count` paragraphs (those that fully fit, as measured
 * by a renderer), dropping any headings left stranded at the end.
 */
export function fitStory(doc, count) {
  let n = Math.max(1, Math.min(count, doc.story.length));
  while (n > 1 && /^Heading /.test(doc.story[n - 1][0])) n--;
  return { ...doc, story: doc.story.slice(0, n) };
}

export function computeDocument(grid, styles, formatId = 'single') {
  if (!grid?.ok || !styles?.ok) return { ok: false, errors: ['Fix the grid settings first.'] };
  const format = FORMATS.find((f) => f.id === formatId) ?? FORMATS[0];
  const W = grid.input.pageWidth;
  const H = grid.input.pageHeight;
  const m = grid.margins;
  const areaW = W - m.inside - m.outside;
  const areaH = H - m.top - m.bottom;
  const cols = textColumns(grid);
  const colGutter = grid.columns.gutter;

  // Pages: with facing pages, odd pages are rectos (right of the spine).
  const sideOf = (i) => (format.facing ? (i % 2 === 0 ? 'recto' : 'verso') : 'single');
  const pages = Array.from({ length: format.pages }, (_, i) => ({ index: i, name: String(i + 1), side: sideOf(i) }));
  const spreads = [];
  if (format.facing) {
    spreads.push([0]);
    for (let i = 1; i < pages.length; i += 2) spreads.push(i + 1 < pages.length ? [i, i + 1] : [i]);
  } else {
    pages.forEach((p) => spreads.push([p.index]));
  }

  const textLeft = (side) => (side === 'verso' ? m.outside : m.inside);
  const area = (side) => ({ x: textLeft(side), y: m.top, w: areaW, h: areaH });

  // Page 1 gets an image placeholder across the top rows, top on the first
  // image-line (if set) and bottom on the baseline that ends the row.
  const { rows } = grid;
  let image = null;
  let firstFrameTop = m.top;
  if (rows.number >= 3) {
    const k = rows.number >= 6 ? 2 : 1;
    const top = grid.imageLines ? grid.imageLines.firstY : m.top;
    const bottom = m.top + k * rows.height + (k - 1) * rows.gutter;
    image = { page: 0, x: textLeft(pages[0].side), y: top, w: areaW, h: bottom - top, rows: k };
    firstFrameTop = bottom + rows.gutter;
  }

  // Document text frames: one per page, threaded in page order.
  const frames = pages.map((p) => {
    const a = area(p.side);
    const top = p.index === 0 ? firstFrameTop : a.y;
    return { page: p.index, x: a.x, y: top, w: a.w, h: m.top + areaH - top, columns: cols, gutter: colGutter };
  });

  // Parent (master) spread: one page, or a verso/recto pair, with threaded frames.
  const masterPages = format.facing ? ['verso', 'recto'] : ['single'];
  const masterFrames = masterPages.map((side, i) => ({ page: i, ...area(side), columns: cols, gutter: colGutter }));

  // Guides (page-relative y): row edges inside the margins, and image-lines.
  const rowGuides = [];
  for (let r = 0; r < rows.number; r++) {
    const top = m.top + r * (rows.height + rows.gutter);
    if (r > 0) rowGuides.push(top);
    if (r < rows.number - 1) rowGuides.push(top + rows.height);
  }
  const imageLineGuides = grid.imageLines
    ? Array.from({ length: grid.imageLines.repeatCount + 1 }, (_, k) => grid.imageLines.firstY + k * grid.imageLines.offsetVertical)
    : [];

  // Dummy copy sized to roughly fill the frames.
  const lineMm = grid.grid.leadingMm;
  const charsPerMm = mmToPt(1) / (0.5 * grid.input.fontSize);
  const colW = (areaW - (cols - 1) * colGutter) / cols;
  const capacity = frames.reduce((n, f) => n + cols * Math.floor(f.h / lineMm) * colW * charsPerMm, 0);
  const story = resolveParagraphs(dummyParagraphs({ minChars: capacity * FILL }), styles);

  return {
    ok: true,
    format,
    pageWidth: W,
    pageHeight: H,
    pages,
    spreads,
    frames,
    image,
    master: { name: 'A-Parent', prefix: 'A', pages: masterPages, frames: masterFrames },
    guides: { rows: rowGuides, imageLines: imageLineGuides },
    story,
  };
}
