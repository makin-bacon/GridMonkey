// Guided walkthrough: dims the page, spotlights one card at a time and explains it.
// Keyboard: ←/→ to move, Esc to close; focus is trapped in the panel and restored after.

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const GAP = 16; // px between spotlight and panel
const PAD = 8; // px of breathing room around the spotlighted card

export function createTour(steps, { onClose = () => {}, beforeStep = () => {} } = {}) {
  let index = 0;
  let root = null;
  let returnFocus = null;
  let raf = 0;

  function build() {
    root = document.createElement('div');
    root.className = 'tour';
    root.innerHTML = `
      <div class="tour-spot" aria-hidden="true"></div>
      <div class="tour-pop" role="dialog" aria-modal="true" aria-labelledby="tourTitle" aria-describedby="tourBody">
        <p class="tour-count"></p>
        <h2 class="tour-title" id="tourTitle"></h2>
        <p class="tour-body" id="tourBody"></p>
        <div class="tour-actions">
          <button type="button" class="btn ghost" data-act="skip">Skip tour</button>
          <span class="tour-spacer"></span>
          <button type="button" class="btn" data-act="back">Back</button>
          <button type="button" class="btn primary" data-act="next">Next</button>
        </div>
      </div>`;
    root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'skip') close();
      if (act === 'back') go(index - 1);
      if (act === 'next') (index === steps.length - 1 ? close() : go(index + 1));
    });
    document.body.appendChild(root);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); index === steps.length - 1 ? close() : go(index + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
    else if (e.key === 'Tab') {
      const f = [...root.querySelectorAll('button:not([disabled])')];
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  }

  const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(position); };

  function target() {
    const s = steps[index];
    return s.target ? document.querySelector(s.target)?.closest(s.closest ?? '*') : null;
  }

  function position() {
    const spot = root.querySelector('.tour-spot');
    const pop = root.querySelector('.tour-pop');
    const el = target();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;

    if (!el) { // centred step, no spotlight
      spot.classList.add('is-empty');
      pop.style.left = `${(vw - pw) / 2}px`;
      pop.style.top = `${Math.max(GAP, (vh - ph) / 2)}px`;
      return;
    }
    spot.classList.remove('is-empty');
    const r = el.getBoundingClientRect();
    const box = {
      left: Math.max(4, r.left - PAD), top: Math.max(4, r.top - PAD),
      right: Math.min(vw - 4, r.right + PAD), bottom: Math.min(vh - 4, r.bottom + PAD),
    };
    Object.assign(spot.style, {
      left: `${box.left}px`, top: `${box.top}px`,
      width: `${Math.max(0, box.right - box.left)}px`, height: `${Math.max(0, box.bottom - box.top)}px`,
    });

    // Prefer beside the card, then below, then above; always clamped to the viewport.
    let left; let top;
    if (vw - box.right >= pw + GAP * 2) { left = box.right + GAP; top = box.top; }
    else if (box.left >= pw + GAP * 2) { left = box.left - GAP - pw; top = box.top; }
    else if (vh - box.bottom >= ph + GAP) { left = box.left; top = box.bottom + GAP; }
    else { left = box.left; top = box.top - GAP - ph; }
    pop.style.left = `${Math.min(Math.max(GAP, left), vw - pw - GAP)}px`;
    pop.style.top = `${Math.min(Math.max(GAP, top), vh - ph - GAP)}px`;
  }

  function go(i) {
    if (i < 0 || i >= steps.length) return;
    index = i;
    const s = steps[i];
    beforeStep(s);
    root.querySelector('.tour-count').innerHTML = `<span class="num">${i + 1} / ${steps.length}</span>`;
    root.querySelector('.tour-title').textContent = s.title;
    root.querySelector('.tour-body').innerHTML = s.body;
    root.querySelector('[data-act="back"]').disabled = i === 0;
    root.querySelector('[data-act="next"]').textContent = i === steps.length - 1 ? 'Done' : 'Next';
    const el = target();
    if (el) {
      const tall = el.getBoundingClientRect().height > window.innerHeight * 0.7;
      el.scrollIntoView({ block: tall ? 'start' : 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
    }
    schedule();
    root.querySelector('[data-act="next"]').focus();
  }

  function start() {
    if (root) return;
    returnFocus = document.activeElement;
    build();
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    go(0);
  }

  function close() {
    if (!root) return;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', schedule, true);
    window.removeEventListener('resize', schedule);
    cancelAnimationFrame(raf);
    root.remove();
    root = null;
    returnFocus?.focus?.();
    onClose();
  }

  return { start, close, get open() { return !!root; } };
}
