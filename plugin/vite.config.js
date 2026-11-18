// Builds the UXP panel into plugin/dist — the folder you load in UXP Developer Tool.
// UXP loads a classic script and provides `require` for host modules, so the panel
// is bundled as a single CommonJS file with 'indesign' and 'uxp' left external.
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
// `--watch` only follows the JS module graph; also rebuild when static files change.
const watchStatic = () => ({
  name: 'gridmonkey:watch-static',
  buildStart() {
    for (const f of readdirSync(join(root, 'static'))) this.addWatchFile(join(root, 'static', f));
  },
});

export default defineConfig({
  root,
  plugins: [watchStatic()],
  publicDir: 'static', // manifest.json, index.html, panel.css copied as-is
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    minify: false, // readable stack traces in the UXP debugger
    lib: { entry: 'src/main.js', formats: ['cjs'], fileName: () => 'index.js' },
    rollupOptions: { external: ['indesign', 'uxp'] },
  },
});
