// Deterministic placeholder copy that exercises every GridMonkey paragraph style.
// Paragraphs are [styleName, text]; '@first' means "Body First if it exists, else Body".

const WORDS = (
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et ' +
  'dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea ' +
  'commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur ' +
  'excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum ' +
  'integer posuere erat a ante venenatis dapibus porta nunc vestibulum maecenas faucibus mollis interdum ' +
  'cras mattis tristique senectus netus fames turpis egestas pellentesque habitant morbi aenean lacinia'
).split(' ');

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dummyParagraphs({ minChars = 3000, seed = 7 } = {}) {
  const rand = rng(seed);
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const words = (n) => Array.from({ length: n }, () => WORDS[int(0, WORDS.length - 1)]);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const sentence = () => `${cap(words(int(7, 15)).join(' '))}.`;
  const para = (n) => Array.from({ length: n }, sentence).join(' ');
  const item = () => cap(words(int(3, 8)).join(' '));
  const heading = (lo, hi) => words(int(lo, hi)).map(cap).join(' ');

  const out = [];
  let chars = 0;
  const push = (style, text) => { out.push([style, text]); chars += text.length; };

  for (let section = 0; section === 0 || chars < minChars; section++) {
    if (section === 0) push('Heading 1', heading(3, 5));
    else push('Heading 2', heading(2, 4));
    push('@first', para(int(3, 4)));
    push('Body', para(int(3, 5)));
    push('Bullet 1', item());
    push('Bullet 2', item());
    push('Bullet 2', item());
    push('Bullet 1', item());
    push('@first', para(int(2, 4)));
    push('Heading 3', heading(2, 4));
    push('@first', para(int(2, 3)));
    push('Number 1', item());
    push('Number 2', item());
    push('Number 2', item());
    push('Number 1', item());
    push('@first', para(int(3, 5)));
    if (section > 40) break; // safety
  }
  return out;
}

/** Replace '@first' with the real style name for the current style set. */
export function resolveParagraphs(paragraphs, styles) {
  const names = new Set(styles.styles.map((s) => s.name));
  const first = names.has('Body First') ? 'Body First' : 'Body';
  return paragraphs.map(([s, t]) => [s === '@first' ? first : s, t]);
}
