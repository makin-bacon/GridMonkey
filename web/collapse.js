// Collapsible cards. Each card's <h2> becomes a disclosure button; collapsing hides
// everything but the card's title row. Which cards are collapsed (by h2 id) is
// reported through onChange so the app can persist it.

export function initCollapsible(cards, { collapsed = [], onChange = () => {} } = {}) {
  const closed = new Set(collapsed);

  for (const card of cards) {
    const h2 = card.querySelector('h2[id]');
    if (!h2) continue;
    // The card's direct child that holds the title is its "top" row.
    let top = h2;
    while (top.parentElement !== card) top = top.parentElement;
    top.classList.add('card-top', 'pr-8'); // keep header content clear of the chevron

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'collapse-btn';
    btn.append(...h2.childNodes);
    // The chevron is inside the button (so it toggles too) but positioned against the
    // card, aligned with the first header line at the card's right edge.
    btn.insertAdjacentHTML('beforeend', '<svg class="chev absolute right-4 top-5 size-4" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>');
    h2.append(btn);

    const set = (isClosed) => {
      card.classList.toggle('is-collapsed', isClosed);
      btn.setAttribute('aria-expanded', String(!isClosed));
      btn.title = isClosed ? 'Expand' : 'Collapse';
    };
    set(closed.has(h2.id));
    btn.addEventListener('click', () => {
      const isClosed = !card.classList.contains('is-collapsed');
      set(isClosed);
      if (isClosed) closed.add(h2.id); else closed.delete(h2.id);
      onChange([...closed]);
    });
  }
}
