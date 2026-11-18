#!/usr/bin/env node
// Import a style library from an IDML that InDesign exported (File › Export › InDesign
// Markup). Reads Resources/Styles.xml and Resources/Preferences.xml and writes
// src/core/library-data.js: every paragraph, character, table, cell and object style
// that GridMonkey doesn't already generate, with each measurement stored relative to
// the source grid so it can be rebuilt for any font size, leading and grid unit.
//
//   npm run library:import -- path/to/file.idml
//
// Measurements become:
//   size  — multiple of the body point size  (PointSize, BaselineShift, shading/border radii…)
//   lines — multiple of the leading          (Leading, SpaceBefore/After, insets top/bottom…)
//   units — multiple of the grid unit        (indents, left/right offsets and insets, tabs…)
// Everything else (stroke weights, tints, flags, colours) is copied as is.
//
// Paragraph and character leading and spacing snap to the nearest ¼ line (the finest
// baseline step GridMonkey offers), and point sizes within 3% of the body size snap to
// it, so leftovers from earlier grid settings fall back onto the grid. Table, cell and
// object insets keep their exact proportions.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error('Usage: npm run library:import -- path/to/file.idml');
  process.exit(1);
}
const out = resolve(import.meta.dirname, '../src/core/library-data.js');

// ---------- read the package ----------
const dir = mkdtempSync(join(tmpdir(), 'gm-lib-'));
let stylesXml, prefsXml;
try {
  execFileSync('unzip', ['-q', '-o', resolve(src), 'Resources/Styles.xml', 'Resources/Preferences.xml', '-d', dir]);
  stylesXml = readFileSync(join(dir, 'Resources/Styles.xml'), 'utf8');
  prefsXml = readFileSync(join(dir, 'Resources/Preferences.xml'), 'utf8');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const attrsOf = (tag) => Object.fromEntries([...tag.matchAll(/([A-Za-z:]+)="([^"]*)"/g)].map((m) => [m[1], unesc(m[2])]));

// ---------- the source grid ----------
const gridPref = attrsOf(prefsXml.match(/<GridPreference [^>]*>/)[0]);
const leadingPt = Number(gridPref.VerticalGridlineDivision); // the document grid's vertical step = corrected leading
const unitPt = Number(gridPref.HorizontalGridlineDivision);
const divisor = Math.round(leadingPt / Number(gridPref.BaselineDivision));
const bodyTag = stylesXml.match(/<ParagraphStyle [^>]*Name="GridMonkey:Body"[^>]*>/);
const bodySize = bodyTag ? Number(attrsOf(bodyTag[0]).PointSize) : NaN;
if (!(leadingPt > 0 && unitPt > 0 && bodySize > 0)) {
  console.error('Could not read the source grid (needs a GridMonkey:Body style and a document grid).');
  process.exit(1);
}

// ---------- measurement rules ----------
const SIZE = new Set(['PointSize', 'BaselineShift', 'ParagraphShadingTopOffset', 'ParagraphShadingBottomOffset',
  'ParagraphBorderTopOffset', 'ParagraphBorderBottomOffset', 'UnderlineOffset', 'StrikeThroughOffset',
  'DropCapDetail']);
const SIZE_RE = /CornerRadius$/;
const LINES = new Set(['SpaceBefore', 'SpaceAfter', 'SameParaStyleSpacing', 'RuleAboveOffset', 'RuleBelowOffset',
  'TextTopInset', 'TextBottomInset', 'TopInset', 'BottomInset']);
const UNITS = new Set(['LeftIndent', 'RightIndent', 'FirstLineIndent', 'LastLineIndent',
  'ParagraphShadingLeftOffset', 'ParagraphShadingRightOffset', 'ParagraphBorderLeftOffset', 'ParagraphBorderRightOffset',
  'RuleAboveLeftIndent', 'RuleAboveRightIndent', 'RuleBelowLeftIndent', 'RuleBelowRightIndent',
  'SpanColumnInsideGutter', 'SpanColumnOutsideGutter', 'SplitColumnInsideGutter', 'SplitColumnOutsideGutter',
  'TextLeftInset', 'TextRightInset', 'LeftInset', 'RightInset']);

const round = (v, dp = 6) => Math.round(v * 10 ** dp) / 10 ** dp;
const snapLines = (v) => Math.round(v * 4) / 4;
const snapSize = (v) => (Math.abs(v - 1) <= 0.03 ? 1 : round(v));

/** Convert one attribute to a scalable value, or return the raw string. */
function measure(kind, key, raw) {
  const v = Number(raw);
  if (raw === '' || !Number.isFinite(v)) return raw;
  const text = kind === 'paragraph' || kind === 'character';
  if (SIZE.has(key) || SIZE_RE.test(key)) return { size: key === 'PointSize' && text ? snapSize(v / bodySize) : round(v / bodySize) };
  if (LINES.has(key)) return { lines: text ? snapLines(v / leadingPt) : round(v / leadingPt) };
  if (UNITS.has(key)) return { units: round(v / unitPt) };
  return raw;
}

// ---------- styles ----------
// GridMonkey generates these itself (they follow the app's settings), so skip the copies.
const GENERATED = new Set(['Body', 'Body First', 'Heading 1', 'Heading 2', 'Heading 3', 'Bullet 1', 'Bullet 2',
  'Number 1', 'Number 2', 'Folio', 'Medium', 'White'].map((n) => `GridMonkey:${n}`));
const KINDS = { ParagraphStyle: 'paragraph', CharacterStyle: 'character', TableStyle: 'table', CellStyle: 'cell', ObjectStyle: 'object' };
const DROP = new Set(['Imported', 'KeyboardShortcut', 'ExtendedKeyboardShortcut', 'StyleUniqueId']);

function parseStyles(tag) {
  const kind = KINDS[tag];
  const re = new RegExp(`<${tag} ((?:[^>"]|"[^"]*")*?)(/>|>([\\s\\S]*?)</${tag}>)`, 'g');
  return [...stylesXml.matchAll(re)].map((m) => {
    const a = attrsOf(m[1]);
    const inner = m[3] ?? '';
    const props = (inner.match(/<Properties>([\s\S]*?)<\/Properties>/)?.[1] ?? '').trim();
    const attrs = {};
    for (const [k, v] of Object.entries(a)) if (!DROP.has(k)) attrs[k] = k === 'Self' || k === 'Name' ? v : measure(kind, k, v);
    const style = { kind, name: a.Name, attrs, properties: [] };
    // Properties: Leading and tab stops scale; BasedOn and the rest are copied.
    for (const pm of props.matchAll(/<(\w+)([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g)) {
      const [raw, ptag, pattrs, body] = pm;
      if (ptag === 'Leading' && /type="unit"/.test(pattrs)) {
        style.properties.push({ tag: 'Leading', lines: snapLines(Number(body) / leadingPt) });
      } else if (ptag === 'TabList') {
        const tabs = [...(body ?? '').matchAll(/<ListItem type="record">([\s\S]*?)<\/ListItem>/g)].map((t) => {
          const pos = t[1].match(/<Position type="unit">([^<]+)<\/Position>/);
          return { raw: t[1], units: pos ? round(Number(pos[1]) / unitPt) : null };
        });
        style.properties.push({ tag: 'TabList', tabs });
      } else if (/type="unit"/.test(pattrs) && body !== undefined && typeof measure(kind, ptag, body) === 'object') {
        style.properties.push({ tag: ptag, ...measure(kind, ptag, body) }); // e.g. SameParaStyleSpacing
      } else {
        style.properties.push({ raw: raw.trim() });
      }
    }
    return style;
  });
}

const library = { paragraph: [], character: [], table: [], cell: [], object: [], defaults: {} };
for (const tag of Object.keys(KINDS)) {
  for (const s of parseStyles(tag)) {
    if (s.name.startsWith('$ID/')) {
      // InDesign's own [None]/[No table style]/[Basic …] styles: copied verbatim so the
      // table, cell and object groups are complete.
      if (s.kind === 'table' || s.kind === 'cell' || s.kind === 'object') (library.defaults[s.kind] ??= []).push(rawOf(tag, s.name));
      continue;
    }
    if (GENERATED.has(s.name)) continue;
    library[s.kind].push(s);
  }
}

function rawOf(tag, name) {
  const re = new RegExp(`<${tag} (?:[^>"]|"[^"]*")*?Name="${name.replace(/[$[\]]/g, '\\$&')}"(?:[^>"]|"[^"]*")*?(?:/>|>[\\s\\S]*?</${tag}>)`);
  return stylesXml.match(re)[0];
}

// Colours the styles refer to (so the writer can check they exist).
const colours = [...new Set([...JSON.stringify(library).matchAll(/Color\/([^"<\\]+)/g)].map((m) => m[1]))].sort();

const header = `// GENERATED by scripts/import-library.mjs from ${basename(src)} — do not edit by hand.
// Re-run: npm run library:import -- path/to/file.idml
//
// Styles from that document that GridMonkey doesn't generate itself. Measurements are
// stored relative to the source grid: { size } × body point size, { lines } × leading,
// { units } × grid unit. src/core/library.js rebuilds them for the current grid.
`;
const data = {
  source: { file: basename(src), bodySize, leadingPt: round(leadingPt, 8), unitPt: round(unitPt, 8), divisor },
  colours,
  ...library,
};
writeFileSync(out, `${header}\nexport const LIBRARY = ${JSON.stringify(data, null, 2)};\n`);
const count = (k) => library[k].length;
console.log(`Wrote ${out}
  source: ${bodySize} pt body, ${round(leadingPt, 3)} pt leading, ${round(unitPt, 3)} pt unit, ÷${divisor}
  paragraph ${count('paragraph')}, character ${count('character')}, table ${count('table')}, cell ${count('cell')}, object ${count('object')}
  colours referenced: ${colours.join(', ') || 'none'}`);
