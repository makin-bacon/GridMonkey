// Masonry layout that respects its own grid.
//
// Items are direct grid children (wrappers use display: contents) placed on a CSS
// grid of fixed-height rows. Each item takes only its own height, rounded up to whole
// rows; gaps are whole rows; free items go wherever the columns balance best. Nothing
// is stretched, so a card's content is never pushed out of view.
//
// Items opt in with data-track:
//   "inputs"  → always column 1     "results" → always column 2
//   "any"     → whichever column gives the most even bottoms
// Below the breakpoint the layout falls back to normal stacked flow.

export function createMasonry(container, { row = 8, gap = 24, query = '(min-width: 861px)' } = {}) {
  const mq = window.matchMedia(query);
  const gapRows = Math.round(gap / row);
  let frame = 0;

  const items = () =>
    [...container.querySelectorAll('[data-track]')].filter((el) => !el.hidden && getComputedStyle(el).display !== 'none');

  function clear() {
    for (const el of container.querySelectorAll('[data-track]')) {
      el.style.gridColumn = el.style.gridRow = el.style.alignSelf = '';
    }
  }

  function layout() {
    frame = 0;
    container.classList.toggle('is-masonry', mq.matches);
    if (!mq.matches) return clear();

    // 1. Measure each item's natural height (in rows) in every column it may use.
    //    Width differs per column, so "any" items are measured in both.
    const measured = items().map((el) => {
      const track = el.dataset.track;
      const cols = track === 'inputs' ? [0] : track === 'results' ? [1] : [0, 1];
      const rows = [];
      el.style.alignSelf = 'start';
      for (const c of cols) {
        el.style.gridColumn = String(c + 1);
        rows[c] = Math.max(1, Math.ceil(el.getBoundingClientRect().height / row));
      }
      return { el, track, rows };
    });

    // 2. Try every column assignment for the "any" items (document order is kept
    //    within each column) and pick the one whose columns end closest together,
    //    then the shortest page. There are only a handful of free items.
    const free = measured.filter((m) => m.track === 'any').slice(0, 10);
    let best = null;
    for (let mask = 0; mask < 1 << free.length; mask++) {
      const ends = [0, 0];
      const plan = measured.map((m) => {
        const i = free.indexOf(m);
        const col = m.track === 'inputs' ? 0 : m.track === 'results' ? 1 : (mask >> i) & 1;
        const start = ends[col] + 1; // CSS grid lines are 1-based
        ends[col] = start - 1 + m.rows[col] + gapRows;
        return { el: m.el, col, start, span: m.rows[col] };
      });
      const e = ends.map((x) => Math.max(0, x - gapRows));
      const score = [Math.abs(e[0] - e[1]), Math.max(...e)];
      if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1])) {
        best = { plan, score, end: Math.max(...e) };
      }
    }

    for (const { el, col, start, span } of best.plan) {
      el.style.gridColumn = String(col + 1);
      el.style.gridRow = `${start} / span ${span}`;
      el.style.alignSelf = 'stretch'; // fill its own rounded-up rows (< 1 row extra), keeping edges on the rhythm
    }
  }

  const schedule = () => { if (!frame) frame = requestAnimationFrame(layout); };

  // Observe each card's children too: a placed card has a fixed row span, so its own
  // box doesn't change size when its content grows — but the content's boxes do.
  const ro = new ResizeObserver(schedule);
  for (const el of container.querySelectorAll('[data-track]')) {
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
  }
  mq.addEventListener('change', schedule);

  layout();
  return { layout, schedule };
}
