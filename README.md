# GridMonkey

A grid calculator for Adobe InDesign.

## Plan

- **`src/core/`** – pure JavaScript grid-calculation logic (no InDesign or DOM dependencies), so the same code runs everywhere.
- **`plugin/`** – InDesign UXP plugin (InDesign 18.5+) that wraps the core logic and applies the results to the document (margins, columns, gutters, baseline grid, guides).
- **`web/`** – in-browser fallback that uses the same core logic, so you can calculate values and enter them by hand.
- **`docs/`** – reference material, including screenshots of the process.

## Status

Scaffolding only. The calculation logic is still to come.
