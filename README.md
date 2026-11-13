# GridMonkey

A leading-driven multicolumn grid calculator for Adobe InDesign. Enter the page size, font size, leading, columns and rows. GridMonkey works out a baseline grid and document grid that fit the page exactly, then lets you allocate margins and gutters in whole gridlines, so every column and row edge lands on the grid.

## Run

```sh
npm install
npm run dev     # → http://127.0.0.1:5280/web/
npm run build   # → dist/
npm test
```

Built with Vite and Tailwind CSS v4. Needs Node 20.19+.

## Structure

- **`src/core/`**: pure JavaScript grid logic, shared by the web app and the plugin.
- **`web/`**: browser app with a live spread preview and values to copy into each InDesign dialog.
- **`plugin/`**: InDesign UXP plugin (planned) that applies the grid to the document directly.
- **`docs/`**: reference material.

See `CLAUDE.md` for the method, conventions and roadmap.
