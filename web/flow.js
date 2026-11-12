// Text flow simulation shared by the specimen and the export preview.
// Sets paragraphs into a sequence of column "slots" (in pt), snapping baselines to
// the grid the way InDesign does with Align to Baseline Grid. Display only.

import { mmToPt } from '../src/core/grid.js';

// Style name → CSS weight. Order matters ("semibold" before "bold",
// "extralight" before "light"). Mirrors the weights in web/fonts.css.
const WEIGHTS = [
  [/super/, 950], [/black|heavy/, 900], [/extra\s*bold|ultra\s*bold/, 800], [/semi\s*bold|demi/, 600],
  [/bold/, 700], [/medium/, 500], [/extra\s*light|ultra\s*light/, 200], [/light/, 300], [/thin|hairline/, 100],
];
export function fontWeight(styleName) {
  const s = styleName.toLowerCase();
  return WEIGHTS.find(([re]) => re.test(s))?.[1] ?? 400;
}

export function fontFor(style) {
  const fs = style.fontStyle.toLowerCase();
  const weight = fontWeight(fs);
  const italic = /italic|oblique/.test(fs) ? 'italic' : 'normal';
  const family = `"${style.appliedFont.replace(/"/g, '')}", system-ui, sans-serif`;
  return { weight, italic, family, css: `${italic} ${weight} ${style.pointSize}px ${family}` };
}

let ctx;
export function wrap(text, fontCss, width) {
  ctx ??= document.createElement('canvas').getContext('2d');
  ctx.font = fontCss;
  const lines = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > width && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/** Ask the browser for any web-font faces that canvas measurement needs. */
export function requestFonts(cssList) {
  for (const css of cssList) if (!document.fonts.check(css)) document.fonts.load(css).catch(() => {});
}

/**
 * @param paragraphs  [styleName, text][] (already resolved, no '@first')
 * @param styles      computeStyles() result
 * @param slots       [{ x, top, bottom, width }] in pt; tops sit on the leading grid
 * @returns { items: [{x, y, text, font, slot, para}], overset, lastY, fonts, placed }
 *   placed = number of paragraphs set completely (the rest are overset)
 */
export function flowText(paragraphs, styles, slots) {
  const byName = Object.fromEntries(styles.styles.map((s) => [s.name, s]));
  const step = styles.gridStepPt;
  const snap = (y) => Math.ceil(y / step - 1e-6) * step;
  const items = [];
  const fonts = new Set();
  let si = 0;
  let y = 0;
  let atTop = true;
  let prevAfter = 0;
  const counters = [0, 0];

  let placed = 0;
  outer: for (let p = 0; p < paragraphs.length; p++) {
    const [name, text] = paragraphs[p];
    const s = byName[name];
    if (!s || !text) { placed = p + 1; continue; }
    const font = fontFor(s);
    fonts.add(font.css);

    let marker = null;
    if (s.list?.type === 'number') {
      if (s.list.level === 1) { counters[0]++; counters[1] = 0; marker = `${counters[0]}.`; }
      else { counters[1]++; marker = `${String.fromCharCode(96 + counters[1])}.`; }
    } else if (s.list) marker = s.list.char;
    else { counters[0] = 0; counters[1] = 0; }

    const left = mmToPt(s.leftIndent);
    const fi = mmToPt(s.firstLineIndent);
    const textX0 = s.list ? left : left + fi; // list text tabs to the left indent
    const lines = wrap(text, font.css, slots[si].width - Math.max(left, textX0));
    const descent = s.pointSize * 0.25;

    for (let i = 0; i < lines.length; i++) {
      if (atTop) y = snap(s.pointSize * 0.75); // space before is ignored at the top of a column
      else if (i === 0) y = snap(y + mmToPt(prevAfter) + mmToPt(s.spaceBefore) + s.leading);
      else y = s.alignFirstLineOnly ? y + s.leading : snap(y + s.leading);

      if (slots[si].top + y + descent > slots[si].bottom) {
        si++;
        if (si >= slots.length) return { items, overset: true, lastY: y, fonts, placed };
        atTop = true;
        y = snap(s.pointSize * 0.75);
      }
      atTop = false;
      const slot = slots[si];
      items.push({ x: slot.x + (i === 0 ? textX0 : left), y: slot.top + y, text: lines[i], font, slot: si, para: p });
      if (i === 0 && marker) items.push({ x: slot.x + left + fi, y: slot.top + y, text: marker, font, slot: si, para: p });
      if (si >= slots.length) break outer;
    }
    prevAfter = s.spaceAfter;
    placed = p + 1;
  }
  return { items, overset: false, lastY: y, fonts, placed };
}

const SVGNS = 'http://www.w3.org/2000/svg';
/** Append a flowed line as an SVG <text>. `scale` converts pt to the SVG's units. */
export function svgText(parent, it, cls, scale = 1) {
  const t = document.createElementNS(SVGNS, 'text');
  t.setAttribute('x', it.x * scale);
  t.setAttribute('y', it.y * scale);
  t.setAttribute('font-size', it.font.css.match(/ ([\d.]+)px /)[1] * scale);
  t.setAttribute('font-family', it.font.family);
  t.setAttribute('font-weight', it.font.weight);
  t.setAttribute('font-style', it.font.italic);
  t.setAttribute('class', cls);
  t.textContent = it.text;
  parent.appendChild(t);
  return t;
}
