// Sample content for the InDesign document preview: the course block from
// SPREAD-REV-181126.indd (a COURSE-BLOCK table), repeated down the pages. Preview
// only; the downloaded IDML has no copy. Pure data.
//
// Measurements follow library.js: { lines } × leading, { units } × grid unit,
// { size } × body point size, taken from the source (7.8 pt / 10.022 pt, 10.089 pt unit).
// Paragraph runs are [characterStyle | null, text]; 'Medium' is GridMonkey's Medium.

export const COURSE_TABLE = Object.freeze({
  tableStyle: 'COURSE-BLOCK',
  // Column widths as fractions of the table (= text frame) width, from the source table.
  columns: [106.034, 34.968, 60.537, 57.036, 63.168, 62.153, 79.717].map((w, _, a) => w / a.reduce((s, x) => s + x, 0)),
  headerFill: 'Word_R232_G236_B239', // RGB 232 236 239
  insets: {
    header: { top: { lines: 0.848485 }, bottom: { lines: 0.848485 } }, // 3 mm in the source
    values: { top: { lines: 0.565657 }, bottom: { lines: 0.565657 } }, // 2 mm (BOTTOM-ROW uses the same top)
    side: { units: 0.396456 }, // 4 pt
  },
  gapAfter: { lines: 1 }, // between consecutive blocks
  // Fallbacks only; the preview uses the QR-Code object style (styles.js).
  qrSize: { units: 4 }, // the QR frame is 4 grid units square (14.24 mm in the source)
  qrWrap: { units: 1 }, // text wrap offset: the caption sits 1 grid unit to the QR's right
  pathwayIcon: { size: 1.538 }, // the inline shuffle glyph, ≈ 12 pt wide at 7.8 pt
});

export const COURSE = Object.freeze({
  // [text, column span]; the header row uses COURSE-TABLE-HEAD, the values row Body.
  header: [['Course', 1], ['ATAR', 1], ['Location', 2], ['Duration (years)', 1], ['Starts', 1], ['Professional Accreditation', 1]],
  values: [
    [[['Medium', 'Bachelor of Business']], 1],
    [[[null, '70']], 1],
    [[[null, 'Gold Coast, Melbourne, Perth, Sydney, Online']], 2],
    [[[null, '3FT/6PT']], 1],
    [[[null, 'March, July, October']], 1],
    [[[null, 'CPA Australia CA ANZ']], 1],
  ],
  // Bottom row, left cell (columns 1–3).
  description: [
    ['Body', [[null, 'Develop a broad understanding of modern business through studies in artificial intelligence, entrepreneurship, marketing, accounting, finance, sustainability and analytics, while gaining valuable industry experience.']]],
    ['Body', [['Medium', 'Career opportunities:'], [null, ' Business Manager, Entrepreneur, Marketing Manager, Accountant, Financial Analyst, HR Manager, Business Analyst, Tourism and Events Manager']]],
    ['Body-qtr-space', [['Medium', 'Placement hours:'], [null, ' 200']]],
    ['Body-qtr-space', [['Medium', 'Specialisations:'], [null, ' Accounting']]],
    ['Body-qtr-space', [['Medium', 'Double degree:'], [null, ' Engineering; Information Technology; Laws; Psychological Science']]],
  ],
  // Bottom row, right cell (columns 4–7).
  pathway: { style: 'Pathway-lozenge', lines: ['Pathway option: Diploma of Health', '(Counselling Specialisation)'] },
  qr: { style: 'QR-Block-Style', textStyle: 'Course-QR-Text', lines: ['Scan the code to view', 'the full course details'] },
});
