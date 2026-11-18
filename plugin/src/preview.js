// Live preview, like the Preview checkbox in InDesign's own dialogs.
// Each update replaces the previous preview as a single undo step named
// PREVIEW_UNDO; turning preview off undoes it; Apply swaps it for a permanent
// APPLY_UNDO step. We only ever undo a step that InDesign reports as ours, so the
// user's own edits are never reverted. Applying is idempotent, so even if an undo
// is skipped, re-applying can't stack duplicate guides or styles.

import { runUndoable, PREVIEW_UNDO, APPLY_UNDO } from './apply.js';

const keyOf = (doc) => { try { return doc.id ?? doc.name ?? 'doc'; } catch { return 'doc'; } };
const lastUndoIs = (doc, name) => { try { return doc.undoName === name; } catch { return false; } };

export function createPreview(deps, { getDoc, apply }) {
  let appliedTo = null; // key of the document holding our preview step

  function undoPreview(doc) {
    if (appliedTo && doc && keyOf(doc) === appliedTo && lastUndoIs(doc, PREVIEW_UNDO)) {
      doc.undo();
      return true;
    }
    return false;
  }

  return {
    get active() { return appliedTo !== null; },

    /** Apply the current settings as the preview. */
    update() {
      const doc = getDoc();
      if (!doc) return { ok: false, message: 'Open a document to preview.' };
      if (appliedTo && keyOf(doc) !== appliedTo) appliedTo = null; // switched documents
      undoPreview(doc);
      const result = runUndoable(deps, PREVIEW_UNDO, () => apply(doc));
      appliedTo = result.grouped ? keyOf(doc) : null;
      return { ok: true, ...result };
    },

    /** Remove the preview (preview switched off). */
    revert() {
      const doc = getDoc();
      const undone = undoPreview(doc);
      appliedTo = null;
      return { ok: true, undone };
    },

    /** Make the current settings permanent as one "GridMonkey" undo step. */
    commit() {
      const doc = getDoc();
      if (!doc) return { ok: false, message: 'Open a document first.' };
      undoPreview(doc);
      appliedTo = null;
      return { ok: true, ...runUndoable(deps, APPLY_UNDO, () => apply(doc)) };
    },
  };
}
