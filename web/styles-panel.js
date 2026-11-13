// Text-styles panel: inputs, style table, live specimen on the baseline grid,
// and the InDesign script download. Display only — maths lives in src/core.
import { round, mmToPt } from '../src/core/grid.js';
import { computeStyles, SCALES, STYLE_DEFAULTS, FONTS } from '../src/core/styles.js';
import { buildStylesScript } from '../src/core/indesign-script.js';
import { resolveParagraphs } from '../src/core/dummy.js';
import { flowText, requestFonts, svgText } from './flow.js';

const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const SPECIMEN_PX_PER_PT = 1.6; // a little over actual size (1pt ≈ 1.33px at 96dpi)

const inputs = {
  enabled: { el: $('stEnabled'), prop: 'checked' },
  bodyFontStyle: { el: $('stBodyStyle'), prop: 'value' },
  scale: { el: $('stScale'), prop: 'value', parse: Number },
  separation: { el: $('stSeparation'), prop: 'value' },
};

export function createStylesPanel({ options, onChange }) {
  const merge = (o) => ({
    ...STYLE_DEFAULTS,
    ...o,
    headingFontStyles: { ...STYLE_DEFAULTS.headingFontStyles, ...(o?.headingFontStyles || {}) },
  });
  let opts = merge(options);
  const headingSelects = [1, 2, 3].map((l) => $(`stH${l}Style`));
  let grid = null;
  let styles = null;

  $('stScale').innerHTML = SCALES.map((s) => `<option value="${s.value}">${s.label}</option>`).join('');
  const optionsFor = (font) => font.styles.map((st) => `<option value="${st}">${st}</option>`).join('');
  $('stBodyStyle').innerHTML = optionsFor(FONTS.body);
  headingSelects.forEach((sel) => (sel.innerHTML = optionsFor(FONTS.heading)));
  $('stBodyFamily').textContent = FONTS.body.family;
  $('stHeadingFamily').textContent = FONTS.heading.family;

  headingSelects.forEach((sel, i) =>
    sel.addEventListener('change', () => {
      opts.headingFontStyles = { ...opts.headingFontStyles, [i + 1]: sel.value };
      onChange({ ...opts });
      render(grid);
    }));

  for (const [key, { el, prop, parse }] of Object.entries(inputs)) {
    el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
      const raw = el[prop];
      opts[key] = parse ? parse(raw) : raw;
      onChange({ ...opts });
      render(grid);
    });
  }

  $('downloadJsx').addEventListener('click', () => {
    if (!grid?.ok || !styles?.ok) return;
    const blob = new Blob([buildStylesScript(grid, styles)], { type: 'text/javascript' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: 'gridmonkey-styles.jsx',
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  function fill(next) {
    opts = merge(next);
    for (const [key, { el, prop }] of Object.entries(inputs)) el[prop] = opts[key];
    headingSelects.forEach((sel, i) => (sel.value = opts.headingFontStyles[i + 1]));
  }

  function render(nextGrid) {
    grid = nextGrid;
    const on = opts.enabled;
    $('styleFields').hidden = !on;
    $('cardStyles').hidden = !on;
    $('cardSpecimen').hidden = !on;
    if (!on) return;

    styles = computeStyles(grid, opts);
    $('downloadJsx').disabled = !styles.ok;
    if (!styles.ok) {
      $('styleTable').innerHTML = `<tr><td>${styles.errors.join(' ')}</td></tr>`;
      $('specimen').replaceChildren();
      $('styleWarnings').hidden = true;
      return;
    }
    renderTable(styles);
    renderSpecimen(grid, styles, opts);
    $('styleWarnings').hidden = !styles.warnings.length;
    $('styleWarnings').textContent = styles.warnings.join(' ');
  }

  // Re-wrap the specimen with real metrics whenever web fonts finish loading.
  document.fonts.addEventListener('loadingdone', () => render(grid));

  fill(opts);
  // Styles for other consumers (the export needs them even when this panel is switched off).
  const compute = (g) => computeStyles(g, opts);
  return { fill, render, compute };
}

// ---------- table ----------
const mm = (n) => (Math.abs(n) < 1e-9 ? '0' : `${round(n, 3)} mm`);
const pt = (n) => round(n, 3);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function listLabel(l) {
  if (!l) return '—';
  return l.type === 'bullet' ? `Bullet ${l.char} · level ${l.level}` : `${l.level === 1 ? '1.' : 'a.'} · level ${l.level}`;
}

function renderTable(r) {
  $('styleTable').innerHTML = `
    <thead><tr>
      <th scope="col">Style</th><th scope="col">Font</th><th scope="col">Size / leading</th>
      <th scope="col">Space before / after</th><th scope="col">Left / first-line indent</th>
      <th scope="col">Grid align</th><th scope="col">List</th>
    </tr></thead>
    <tbody>${r.styles.map((s) => `
      <tr>
        <th scope="row">${esc(s.name)}${s.basedOn ? `<span class="based">based on ${esc(s.basedOn)}</span>` : ''}</th>
        <td>${esc(s.appliedFont)} ${esc(s.fontStyle)}</td>
        <td class="n">${pt(s.pointSize)} / ${pt(s.leading)} pt</td>
        <td class="n">${mm(s.spaceBefore)} / ${mm(s.spaceAfter)}</td>
        <td class="n">${mm(s.leftIndent)} / ${mm(s.firstLineIndent)}</td>
        <td>${s.alignFirstLineOnly ? 'First line only' : 'All lines'}</td>
        <td>${listLabel(s.list)}</td>
      </tr>`).join('')}
    </tbody>`;
}

// ---------- specimen ----------
const SAMPLE = [
  ['Heading 1', 'A grid that holds its line'],
  ['@first', 'Every line of text sits on the baseline grid, so columns that sit side by side line up across the spread. The leading was adjusted slightly so the page height holds a whole number of lines.'],
  ['Body', 'Headings take their sizes from a modular scale. Their first line snaps to the grid, and the body text after them snaps straight back on.'],
  ['Heading 2', 'Indents follow the grid'],
  ['@first', 'List indents use whole grid units, so markers and text line up with the document grid:'],
  ['Bullet 1', 'Margins and gutters are counted in gridlines'],
  ['Bullet 2', 'Inside and outside are set separately'],
  ['Bullet 2', 'Rows use whole baseline lines'],
  ['Bullet 1', 'Image-lines line up with the cap height'],
  ['Heading 3', 'Setting up a document'],
  ['Number 1', 'Apply the grid settings'],
  ['Number 2', 'Baseline grid and document grid'],
  ['Number 2', 'Margins and columns on the parent page'],
  ['Number 1', 'Run the styles script and start typing'],
];

function renderSpecimen(grid, r) {
  const svg = $('specimen');
  svg.replaceChildren();
  const base = r.gridStepPt; // snap grid (may be finer than the leading)
  const major = r.leadingPt;
  const unitPt = mmToPt(r.unitMm);

  // Frame width: smallest column span ≥ 70 mm (or the full text area).
  const { width: cw, gutter: cg, number: cols } = grid.columns;
  let span = 1;
  while (span < cols && span * cw + (span - 1) * cg < 70) span++;
  const frameMm = span * cw + (span - 1) * cg;
  const W = mmToPt(frameMm);
  $('specimenCaption').innerHTML =
    `<span class="num">${span}</span> column${span > 1 ? 's' : ''} wide (<span class="num">${round(frameMm, 2)} mm</span>), frame at the top margin. ` +
    `Green lines show the baseline grid${r.divisor > 1 ? ` (dashed = <span class="num">÷ ${r.divisor}</span> steps)` : ''}; grey lines show the vertical grid units.`;

  const { items, lastY, fonts } = flowText(resolveParagraphs(SAMPLE, r), r, [{ x: 0, top: 0, bottom: Infinity, width: W }]);
  requestFonts(fonts); // the panel re-renders on 'loadingdone'

  const H = Math.ceil((lastY + major) / major - 1e-6) * major;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.aspectRatio = `${W} / ${H}`;
  svg.style.width = `${W * SPECIMEN_PX_PER_PT}px`; // fixed scale; CSS max-width keeps it inside the card
  for (let x = unitPt; x < W - 0.01; x += unitPt) line(svg, x, 0, x, H, 'sp-unit');
  for (let k = 1; k * base <= H + 0.01; k++) {
    line(svg, 0, k * base, W, k * base, k % r.divisor === 0 ? 'sp-base' : 'sp-base sp-sub');
  }
  for (const it of items) svgText(svg, it, 'sp-text');
}

function line(svg, x1, y1, x2, y2, cls) {
  const l = document.createElementNS(SVGNS, 'line');
  Object.entries({ x1, y1, x2, y2, class: cls, 'vector-effect': 'non-scaling-stroke' }).forEach(([k, v]) => l.setAttribute(k, v));
  svg.appendChild(l);
}
