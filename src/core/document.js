// Document model for export: pages, spreads, threaded text frames, guides, an image
// placeholder and dummy copy. Shared by the IDML writer and the in-app preview so
// what you see is what you download. All geometry is in mm, relative to each page's
// top-left corner. Pure.

import { mmToPt, ptToMm } from './grid.js';
import { folioStyle } from './styles.js';
import { dummyParagraphs, resolveParagraphs } from './dummy.js';

export const FORMATS = Object.freeze([
  // `facing` is the default for each; computeDocument follows the grid's facing setting
  // (a single page is always single-sided).
  { id: 'single', label: 'Single page', pages: 1, facing: false },
  { id: 'double', label: '2 pages', pages: 2, facing: true },
  { id: 'facing4', label: '4 pages', pages: 4, facing: true },
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
 * The download version of a document: same pages, frames, guides and folios, but no
 * dummy copy and no image placeholder (those are for the preview only). Page 1's frame
 * goes back to the full text area, and the story is one empty Body paragraph.
 */
export function emptyDocument(doc) {
  const frameFor = (p) => ({ ...doc.master.frames[doc.master.pages.indexOf(p.side)], page: p.index });
  return { ...doc, image: null, frames: doc.pages.map(frameFor), story: [['Body', '']] };
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

export const EM_SPACE = '\u2003';
const CAP_HEIGHT_EM = 0.7; // estimate when no cap height is set (Graphik ≈ 0.7 em)
const DESCENT_EM = 0.3; // room under the folio baseline inside its frame

/**
 * Folio frame placement on a page: same x and width as the text area, one line,
 * its baseline on the baseline grid as close as possible to centring the line's
 * cap height between the bottom of the text area and the bottom of the page.
 * Returns page-relative mm, plus `baseline` and `centreError` for checking.
 */
export function folioGeometry(grid, styles) {
  const H = grid.input.pageHeight;
  const m = grid.margins;
  const inc = grid.baseline.increment; // baselines sit at k × inc from the page top
  const style = folioStyle(styles);
  const sizeMm = ptToMm(style.pointSize);
  const leadMm = ptToMm(style.leading);
  const capMm = Number.isFinite(grid.input.capHeight) && grid.input.capHeight > 0 ? grid.input.capHeight : sizeMm * CAP_HEIGHT_EM;
  const textBottom = H - m.bottom;
  const centre = (textBottom + H) / 2;
  const target = centre + capMm / 2;
  // Keep the cap height below the text area and the descenders on the page.
  const lo = Math.ceil((textBottom + capMm) / inc - 1e-9);
  const hi = Math.floor((H - sizeMm * DESCENT_EM) / inc + 1e-9);
  const k = Math.min(hi, Math.max(lo, Math.round(target / inc)));
  const baseline = k * inc;
  // Frame top a hair above (baseline − leading): with a leading first-baseline
  // offset and align-to-grid, the line then snaps onto exactly this baseline.
  const nudge = 0.01;
  const y = baseline - leadMm - nudge;
  const bottom = Math.min(H, baseline + sizeMm * DESCENT_EM);
  return { y, h: bottom - y, baseline, capMm, centreError: baseline - capMm / 2 - centre, style };
}

/** Folio text for a page side. `page` is the number (or a marker) to show. */
export function folioText(side, title, page) {
  return side === 'verso' ? `${page}${EM_SPACE}${title}` : `${title}${EM_SPACE}${page}`;
}

/** @param options.folios add running feet (page number + title) on the parent pages. @param options.title */
export function computeDocument(grid, styles, formatId = 'single', options = {}) {
  if (!grid?.ok || !styles?.ok) return { ok: false, errors: ['Fix the grid settings first.'] };
  const base = FORMATS.find((f) => f.id === formatId) ?? FORMATS[0];
  // Multi-page documents follow the grid's Facing pages / Single-sided setting.
  const format = { ...base, facing: base.pages > 1 && grid.facing !== false };
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

  // Folios live on the parent pages, so every document page picks them up.
  let folios = null;
  if (options.folios) {
    const g = folioGeometry(grid, styles);
    const title = String(options.title ?? '').trim() || 'Untitled';
    folios = {
      title,
      style: g.style,
      baseline: g.baseline,
      centreError: g.centreError,
      frames: masterPages.map((side, i) => ({ page: i, side, x: textLeft(side), y: g.y, w: areaW, h: g.h })),
    };
  }

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
    folios,
  };
}
