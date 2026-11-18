// Colour swatches added to every GridMonkey document. Pure data.
// Names are "<space>-<colour name>"; the values match the brand spec exactly.

const cmyk = (name, c, m, y, k) => ({ name: `CMYK-${name}`, space: 'CMYK', value: [c, m, y, k] });
const rgb = (name, r, g, b) => ({ name: `RGB-${name}`, space: 'RGB', value: [r, g, b] });

export const SWATCHES = Object.freeze([
  cmyk('SCU Blue', 95, 61, 30, 8),
  cmyk('SCU Teal', 37, 4, 22, 0),
  cmyk('SCU Off white', 4, 2, 2, 0),
  cmyk('SCU Yellow', 0, 30, 100, 0),
  cmyk('SCU Dark', 95, 100, 30, 50),
  cmyk('SCU Aqua', 77, 13, 28, 0),
  cmyk('SCU Sky', 75, 30, 0, 0),
  rgb('SCU Blue', 0, 94, 134),
  rgb('SCU Teal', 160, 207, 202),
  rgb('SCU Off white', 241, 243, 244),
  rgb('SCU Yellow', 252, 184, 23),
  rgb('SCU Dark', 20, 0, 64),
  rgb('SCU Aqua', 0, 166, 182),
  rgb('SCU Sky', 56, 148, 206),
].map(Object.freeze));
