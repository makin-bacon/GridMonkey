// Generates an ExtendScript (.jsx) file that sets the baseline grid and creates
// the GridMonkey paragraph styles in the active InDesign document.
// It's a stopgap until the UXP plugin exists. Pure string output, no I/O.

import { round } from './grid.js';

export function buildStylesScript(grid, styles) {
  if (!grid?.ok || !styles?.ok) throw new Error('Grid and styles must both be valid.');

  const spec = {
    group: styles.group,
    baselineStart: `${round(grid.baseline.start, 8)}mm`,
    baselineIncrement: `${round(grid.baseline.incrementPt, 8)}pt`,
    styles: styles.styles.map((s) => ({
      name: s.name,
      basedOn: s.basedOn,
      appliedFont: s.appliedFont,
      fontStyle: s.fontStyle,
      pointSize: round(s.pointSize, 3),
      leading: round(s.leading, 8),
      spaceBefore: `${round(s.spaceBefore, 8)}mm`,
      spaceAfter: `${round(s.spaceAfter, 8)}mm`,
      leftIndent: `${round(s.leftIndent, 8)}mm`,
      firstLineIndent: `${round(s.firstLineIndent, 8)}mm`,
      alignFirstLineOnly: s.alignFirstLineOnly,
      hyphenation: s.hyphenation,
      keepWithNext: s.keepWithNext,
      list: s.list,
    })),
  };

  return `// GridMonkey: paragraph styles for a ${grid.input.pageWidth} × ${grid.input.pageHeight} mm page,
// ${grid.input.fontSize}/${round(grid.type.correctedLeadingPt, 3)} pt, ${grid.columns.number} columns × ${grid.rows.number} rows.
// Run it from InDesign: Window › Utilities › Scripts (put this file in the Scripts Panel folder),
// or double-click it in the Scripts panel. It updates styles that already exist in the
// "${spec.group}" group, so you can run it again safely. One Undo reverses all of it.
#target indesign

(function () {
  if (app.documents.length === 0) { alert('GridMonkey: open a document first.'); return; }
  var doc = app.activeDocument;
  var SPEC = ${JSON.stringify(spec, null, 2)};
  var warnings = [];

  app.doScript(main, ScriptLanguage.JAVASCRIPT, undefined, UndoModes.ENTIRE_SCRIPT, 'GridMonkey styles');

  var msg = 'GridMonkey: baseline grid set and ' + SPEC.styles.length + ' paragraph styles created in "' + SPEC.group + '".';
  if (warnings.length) msg += '\\n\\nWarnings:\\n' + warnings.join('\\n');
  alert(msg);

  function set(obj, prop, value, label) {
    try { obj[prop] = value; } catch (e) { warnings.push(label + ': could not set ' + prop + ' (' + e.message + ')'); }
  }

  function main() {
    var gp = doc.gridPreferences;
    set(gp, 'baselineGridRelativeOption', BaselineGridRelativeOption.TOP_OF_PAGE_OF_BASELINE_GRID_RELATIVE_OPTION, 'Baseline grid');
    set(gp, 'baselineStart', SPEC.baselineStart, 'Baseline grid');
    set(gp, 'baselineDivision', SPEC.baselineIncrement, 'Baseline grid');

    var group = doc.paragraphStyleGroups.itemByName(SPEC.group);
    if (!group.isValid) group = doc.paragraphStyleGroups.add({ name: SPEC.group });

    var numList = doc.numberingLists.itemByName(SPEC.group);
    if (!numList.isValid) numList = doc.numberingLists.add({ name: SPEC.group });

    var made = {};
    for (var i = 0; i < SPEC.styles.length; i++) {
      var s = SPEC.styles[i];
      var st = group.paragraphStyles.itemByName(s.name);
      if (!st.isValid) st = group.paragraphStyles.add({ name: s.name });
      made[s.name] = st;

      set(st, 'basedOn', s.basedOn ? made[s.basedOn] : doc.paragraphStyles.item(0), s.name);
      set(st, 'appliedFont', s.appliedFont, s.name);
      set(st, 'fontStyle', s.fontStyle, s.name);
      set(st, 'pointSize', s.pointSize, s.name);
      set(st, 'leading', s.leading, s.name);
      set(st, 'spaceBefore', s.spaceBefore, s.name);
      set(st, 'spaceAfter', s.spaceAfter, s.name);
      set(st, 'leftIndent', s.leftIndent, s.name);
      set(st, 'firstLineIndent', s.firstLineIndent, s.name);
      set(st, 'gridAlignment', GridAlignment.ALIGN_TO_BASELINE, s.name);
      set(st, 'gridAlignFirstLineOnly', s.alignFirstLineOnly, s.name);
      set(st, 'hyphenation', s.hyphenation, s.name);
      set(st, 'keepWithNext', s.keepWithNext, s.name);

      if (!s.list) {
        set(st, 'bulletsAndNumberingListType', ListType.NO_LIST, s.name);
      } else if (s.list.type === 'bullet') {
        set(st, 'bulletsAndNumberingListType', ListType.BULLET_LIST, s.name);
        try {
          st.bulletChar.characterType = BulletCharacterType.UNICODE_ONLY;
          st.bulletChar.characterValue = s.list.charCode;
        } catch (e) { warnings.push(s.name + ': could not set bullet character'); }
        set(st, 'bulletsTextAfter', '^t', s.name);
      } else {
        set(st, 'bulletsAndNumberingListType', ListType.NUMBERED_LIST, s.name);
        set(st, 'appliedNumberingList', numList, s.name);
        set(st, 'numberingLevel', s.list.level, s.name);
        set(st, 'numberingFormat', s.list.format, s.name);
        set(st, 'numberingExpression', s.list.expression, s.name);
        set(st, 'numberingContinue', true, s.name);
      }
    }
  }
})();
`;
}
