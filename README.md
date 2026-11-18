# GridMonkey

A leading-driven multicolumn grid calculator for Adobe InDesign. Enter the page size, font size, leading, columns and rows. GridMonkey works out a baseline grid and document grid that fit the page exactly, then lets you allocate margins and gutters in whole gridlines, so every column and row edge lands on the grid.

It also builds paragraph, character, table, cell and object styles that follow the grid (including a scalable style library imported from a reference InDesign document), and downloads a ready-made IDML: facing or single-sided, 1, 2 or 4 pages, with guides, threaded frames, swatches and optional folios.

## Run

```sh
npm install
npm run dev     # → http://127.0.0.1:5280/web/
npm run build   # → dist/
npm test
npm run plugin:build             # InDesign plugin → plugin/dist/
npm run library:import -- f.idml # re-import the style library
```

Built with Vite and Tailwind CSS v4. Needs Node 20.19+.

## Structure

- **`src/core/`**: pure JavaScript grid logic, shared by the web app and the plugin.
- **`web/`**: browser app with a live spread preview and values to copy into each InDesign dialog.
- **`plugin/`**: InDesign UXP plugin (v1) that previews and applies the grid and styles to the open document, or creates a new one.
- **`scripts/`**: tooling, such as the style-library importer.
- **`docs/`**: local-only font folders (git-ignored; never commit them).

See `CLAUDE.md` for the method, conventions and roadmap.
