import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// Fonts are licensed and must never be bundled into a build (see CLAUDE.md › Fonts).
// web/public/fonts.css points at /docs/<Family>/… which the dev server serves locally;
// public files aren't processed, so the fonts never enter the bundle. This plugin is
// the backstop: the build fails if any font file shows up in the output.
const FONT_FILE = /\.(otf|ttf|ttc|woff2?|eot|dfont)$/i;
const noFontsInBuild = () => ({
  name: 'gridmonkey:no-fonts-in-build',
  generateBundle(_, bundle) {
    const fonts = Object.keys(bundle).filter((f) => FONT_FILE.test(f));
    if (fonts.length) this.error(`Licensed font files must not be bundled: ${fonts.join(', ')}`);
  },
});

export default defineConfig({
  root: '.', // repo root, so /web/ and /docs/ are both reachable in dev
  publicDir: 'web/public',
  base: './',
  plugins: [tailwindcss(), noFontsInBuild()],
  server: {
    host: '127.0.0.1', // local only — never expose the font files on the network
    port: 5280, // 5173 is used by another local project
    strictPort: true,
    open: false,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input: 'web/index.html' },
  },
});
