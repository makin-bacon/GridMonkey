// Icon buttons: fills every [data-icon] element with an inline Font Awesome Free
// SVG (solid set, CC BY 4.0, https://fontawesome.com/license/free). Only the icons
// imported here end up in the bundle. Swap an icon by changing its import below.
import { faRotateLeft, faCircleQuestion } from '@fortawesome/free-solid-svg-icons';

const ICONS = { reset: faRotateLeft, tour: faCircleQuestion };

const svg = ({ icon: [w, h, , , path] }) =>
  `<svg viewBox="0 0 ${w} ${h}" class="size-4" fill="currentColor" aria-hidden="true" focusable="false"><path d="${Array.isArray(path) ? path.join(' ') : path}"/></svg>`;

export function renderIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    const def = ICONS[el.dataset.icon];
    if (def) el.innerHTML = svg(def);
  }
}
