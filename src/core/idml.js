// IDML package writer. Turns a grid + styles + document model into the files of an
// InDesign Markup Language package (a ZIP). Pure; no I/O.
//
// Targets DOMVersion 18.0 (InDesign 2023, the plugin's minimum too). InDesign drops
// attributes newer than the declared version, and the imported styles use paragraph
// shading and same-style spacing (CC 2015 / 2017), so 8.0 is too old. Geometry in IDML is
// in points, in spread coordinates: x = 0 is the spine, page tops sit at y = -H/2.

import { mmToPt } from './grid.js';
import { zipStore } from './zip.js';
import { EM_SPACE } from './document.js';
import { SWATCHES } from './swatches.js';
import { resolveLibrary } from './library.js';

const NS = 'http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging';
const DOM = '18.0';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const LAYER_TEXT = 'uLayerText';
const LAYER_IMAGE_LINES = 'uLayerImageLines';
const NUMBERING_LIST = 'NumberingList/GridMonkey';
const NO_PARA = '$ID/[No paragraph style]';
const NO_CHAR = 'CharacterStyle/$ID/[No character style]';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// 8 decimal places: grid values are irrational in mm/pt, so keep InDesign exact.
const num = (v) => String(Math.round(Number(v) * 1e8) / 1e8);
const pt = (mm) => num(mmToPt(mm));
const attrs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
const pkg = (tag, inner) => `${XML_HEAD}<idPkg:${tag} xmlns:idPkg="${NS}" DOMVersion="${DOM}">\n${inner}\n</idPkg:${tag}>\n`;

export const paragraphStyleId = (group, name) => `ParagraphStyle/${group}%3a${name}`;
export const characterStyleId = (group, name) => `CharacterStyle/${group}%3a${name}`;
export const swatchId = (name) => `Color/${name}`;

// ---------- Styles.xml ----------
function nextStyleName(s, names) {
  if (s.headingLevel) return names.has('Body First') ? 'Body First' : 'Body';
  if (s.name === 'Body First') return 'Body';
  return s.name;
}

function paragraphStyleXml(s, group, names) {
  const id = (n) => paragraphStyleId(group, n);
  const a = {
    Self: id(s.name),
    Name: `${group}:${s.name}`,
    Imported: 'false',
    NextStyle: id(nextStyleName(s, names)),
    PointSize: num(s.pointSize),
    FontStyle: s.fontStyle,
    SpaceBefore: pt(s.spaceBefore),
    SpaceAfter: pt(s.spaceAfter),
    LeftIndent: pt(s.leftIndent),
    FirstLineIndent: pt(s.firstLineIndent),
    GridAlignment: 'AlignBaseline', // the enum InDesign 2026 exports (not 'AlignToBaseline')
    GridAlignFirstLineOnly: String(s.alignFirstLineOnly),
    Hyphenation: String(s.hyphenation),
    KeepWithNext: String(s.keepWithNext),
    Justification: s.justification,
    BulletsAndNumberingListType: !s.list ? 'NoList' : s.list.type === 'bullet' ? 'BulletList' : 'NumberedList',
  };
  const props = [
    s.basedOn
      ? `<BasedOn type="object">${esc(id(s.basedOn))}</BasedOn>`
      : `<BasedOn type="string">${esc(NO_PARA)}</BasedOn>`,
    `<Leading type="unit">${num(s.leading)}</Leading>`,
    `<AppliedFont type="string">${esc(s.appliedFont)}</AppliedFont>`,
  ];
  if (s.sameParaStyleSpacing != null) props.push(`<SameParaStyleSpacing type="unit">${pt(s.sameParaStyleSpacing)}</SameParaStyleSpacing>`);
  if (s.list?.type === 'bullet') {
    props.push(`<BulletChar BulletCharacterType="UnicodeOnly" BulletCharacterValue="${s.list.charCode}"/>`);
  } else if (s.list?.type === 'number') {
    Object.assign(a, {
      NumberingLevel: String(s.list.level),
      NumberingExpression: s.list.expression,
      NumberingContinue: 'true',
      NumberingStartAt: '1',
    });
    props.push(`<NumberingFormat type="string">${esc(s.list.format)}</NumberingFormat>`);
    props.push(`<AppliedNumberingList type="object">${NUMBERING_LIST}</AppliedNumberingList>`);
  }
  return `<ParagraphStyle ${attrs(a)}>\n<Properties>\n${props.join('\n')}\n</Properties>\n</ParagraphStyle>`;
}

// Character styles set only their one attribute (FontStyle or FillColor), nothing else.
function characterStylesXml(styles, extraXml = '') {
  const list = styles.characterStyles ?? [];
  if (!list.length && !extraXml) return '';
  const g = esc(styles.group);
  const items = list.map((c) => `<CharacterStyle ${attrs({
    Self: characterStyleId(styles.group, c.name), Imported: 'false', Name: `${styles.group}:${c.name}`,
    FontStyle: c.fontStyle, FillColor: c.fillColor ? swatchId(c.fillColor) : undefined,
  })}>
<Properties><BasedOn type="string">$ID/[No character style]</BasedOn></Properties>
</CharacterStyle>`);
  return `<CharacterStyleGroup Self="CharacterStyleGroup/${g}" Name="${g}">
${[...items, extraXml].filter(Boolean).join('\n')}
</CharacterStyleGroup>`;
}

// ---------- imported style library (library.js, already resolved for this grid) ----------
const LIB_TAGS = { paragraph: 'ParagraphStyle', character: 'CharacterStyle', table: 'TableStyle', cell: 'CellStyle', object: 'ObjectStyle' };

function libraryStyleXml(s) {
  const tag = LIB_TAGS[s.kind];
  const { Self, Name, ...rest } = s.attrs;
  const props = s.properties.map((p) => {
    if (p.raw) return p.raw;
    if (p.tag === 'TabList') {
      return `<TabList type="list">${p.tabs.map((t) => `<ListItem type="record">${
        t.position == null ? t.raw : t.raw.replace(/<Position type="unit">[^<]*<\/Position>/, `<Position type="unit">${num(t.position)}</Position>`)
      }</ListItem>`).join('')}</TabList>`;
    }
    return `<${p.tag} type="unit">${num(p.value)}</${p.tag}>`; // Leading, SameParaStyleSpacing…
  });
  const a = attrs({ Self, Imported: 'false', Name, ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, typeof v === 'number' ? num(v) : v])) });
  return `<${tag} ${a}>\n<Properties>\n${props.join('\n')}\n</Properties>\n</${tag}>`;
}

/** RootObjectStyleGroup: InDesign's defaults (from the library), imported, then GridMonkey's own. */
function objectGroupXml(lib, own) {
  if (!own.length && !lib?.object?.length) return '';
  const defaults = lib?.defaults?.object ?? [];
  const none = defaults.length ? [] : ['<ObjectStyle Self="ObjectStyle/$ID/[None]" Imported="false" Name="$ID/[None]"/>'];
  return `<RootObjectStyleGroup Self="uRootObjectStyles">
${[...none, ...defaults, ...(lib?.object ?? []).map(libraryStyleXml), ...own.map(objectStyleXml)].join('\n')}
</RootObjectStyleGroup>`;
}

/** Split imported paragraph/character styles into those in the GridMonkey group and the rest. */
const inGroup = (list, group) => [list.filter((s) => s.name.startsWith(`${group}:`)), list.filter((s) => !s.name.startsWith(`${group}:`))];

// GridMonkey's own object styles (styles.objectStyles), e.g. the QR box. Size and
// position, text wrap and frame fitting are switched on; everything else stays default.
function objectStyleXml(o) {
  return `<ObjectStyle ${attrs({
    Self: `ObjectStyle/${o.name}`, Imported: 'false', Name: o.name,
    EnableFill: 'true', EnableStroke: 'true', EnableStrokeAndCornerOptions: 'true', EnableTextWrapAndOthers: 'true',
    EnableFrameFittingOptions: 'true', EnableTransformAttributes: 'true',
    FillColor: 'Swatch/None', StrokeColor: 'Swatch/None', StrokeWeight: '0',
  })}>
<Properties><BasedOn type="string">$ID/[None]</BasedOn></Properties>
<TransformAttributeOption ${attrs({ TransformAttrWidth: pt(o.width), TransformAttrHeight: pt(o.height), TransformAttrLeftReference: 'PageEdgeReference', TransformAttrTopReference: 'PageEdgeReference', TransformAttrRefAnchorPoint: 'TopLeftAnchor' })}/>
<TextWrapPreference ${attrs({ Inverse: 'false', ApplyToMasterPageOnly: 'false', TextWrapSide: 'BothSides', TextWrapMode: o.textWrap.mode })}>
<Properties><TextWrapOffset ${attrs({ Top: pt(o.textWrap.offset.top), Left: pt(o.textWrap.offset.left), Bottom: pt(o.textWrap.offset.bottom), Right: pt(o.textWrap.offset.right) })}/></Properties>
</TextWrapPreference>
<FrameFittingOption ${attrs({ AutoFit: String(o.fitting.autoFit), LeftCrop: '0', TopCrop: '0', RightCrop: '0', BottomCrop: '0', FittingOnEmptyFrame: o.fitting.emptyFrame, FittingAlignment: o.fitting.alignment })}/>
</ObjectStyle>`;
}

function stylesXml(styles, extra = [], lib = null) {
  const all = [...styles.styles, ...extra];
  const names = new Set(all.map((s) => s.name));
  const [libParaGroup, libParaRoot] = inGroup(lib?.paragraph ?? [], styles.group);
  const [libCharGroup, libCharRoot] = inGroup(lib?.character ?? [], styles.group);
  const x = (list) => list.map(libraryStyleXml).join('\n');
  const group = (kind, root, list) => (list.length || lib?.defaults?.[kind]?.length
    ? `<${root} Self="u${root}">\n${[...(lib.defaults[kind] ?? []), x(list)].filter(Boolean).join('\n')}\n</${root}>` : '');
  return pkg('Styles', [`<RootCharacterStyleGroup Self="uRootCharStyles">
<CharacterStyle Self="${NO_CHAR}" Imported="false" Name="$ID/[No character style]"/>
${characterStylesXml(styles, x(libCharGroup))}
${x(libCharRoot)}
</RootCharacterStyleGroup>
<RootParagraphStyleGroup Self="uRootParaStyles">
<ParagraphStyle Self="ParagraphStyle/${NO_PARA}" Imported="false" Name="${NO_PARA}"/>
<ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Imported="false" Name="$ID/NormalParagraphStyle">
<Properties><BasedOn type="string">${NO_PARA}</BasedOn></Properties>
</ParagraphStyle>
<ParagraphStyleGroup Self="ParagraphStyleGroup/${esc(styles.group)}" Name="${esc(styles.group)}">
${all.map((s) => paragraphStyleXml(s, styles.group, names)).join('\n')}
${x(libParaGroup)}
</ParagraphStyleGroup>
${x(libParaRoot)}
</RootParagraphStyleGroup>`,
  // Same order as InDesign writes them: cell, table, object.
  lib ? group('cell', 'RootCellStyleGroup', lib.cell) : '',
  lib ? group('table', 'RootTableStyleGroup', lib.table) : '',
  objectGroupXml(lib, styles.objectStyles ?? []),
  ].filter(Boolean).join('\n'));
}

// ---------- Graphic.xml / Fonts.xml ----------
const graphicXml = () => pkg('Graphic', `<Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" ColorOverride="Specialblack" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="Black" ColorEditable="false" ColorRemovable="false" Visible="true"/>
<Color Self="Color/Paper" Model="Process" Space="CMYK" ColorValue="0 0 0 0" ColorOverride="Specialpaper" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="Paper" ColorEditable="true" ColorRemovable="false" Visible="true"/>
<Color Self="Color/Registration" Model="Registration" Space="CMYK" ColorValue="100 100 100 100" ColorOverride="Specialregistration" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="Registration" ColorEditable="false" ColorRemovable="false" Visible="true"/>
${SWATCHES.map((c) => `<Color ${attrs({
  Self: swatchId(c.name), Model: 'Process', Space: c.space, ColorValue: c.value.join(' '), ColorOverride: 'Normal',
  AlternateSpace: 'NoAlternateColor', AlternateColorValue: '', Name: c.name, ColorEditable: 'true', ColorRemovable: 'true', Visible: 'true',
})}/>`).join('\n')}
<Swatch Self="Swatch/None" Name="None" ColorEditable="false" ColorRemovable="false" Visible="true"/>
<StrokeStyle Self="StrokeStyle/$ID/Solid" Name="$ID/Solid"/>`);

const fontsXml = () => pkg('Fonts', ''); // fonts resolve by family name from the system

// ---------- Preferences.xml ----------
function preferencesXml(grid, doc, options = {}) {
  const m = grid.margins;
  return pkg('Preferences', [
    `<TextPreference ${attrs({
      SmartTextReflow: String(options.smartTextReflow ?? true), AddPages: 'EndOfStory', LimitToMasterTextFrames: 'false',
      PreserveFacingPageSpreads: 'false', DeleteEmptyPages: 'false',
    })}/>`,
    `<MarginPreference ${attrs({
      ColumnCount: grid.columns.number, ColumnGutter: pt(grid.columns.gutter),
      Top: pt(m.top), Bottom: pt(m.bottom), Left: pt(m.inside), Right: pt(m.outside), ColumnDirection: 'Horizontal',
    })}/>`,
    `<ViewPreference ${attrs({
      HorizontalMeasurementUnits: 'Millimeters', VerticalMeasurementUnits: 'Millimeters',
      TypographicMeasurementUnits: 'Points', TextSizeMeasurementUnits: 'Points',
    })}/>`,
    // Guides visible on open; the grids are set up but hidden (View › Grids & Guides).
    `<GuidePreference ${attrs({ GuidesShown: 'true', GuidesLocked: 'false', GuidesInBack: 'false', GuidesSnapto: 'true' })}/>`,
    `<GridPreference ${attrs({
      DocumentGridShown: 'false', DocumentGridSnapto: 'false', BaselineGridShown: 'false', // grids set up but hidden; guides stay visible
      GridsInBack: 'true',
      HorizontalGridlineDivision: pt(grid.documentGrid.horizontalEvery),
      VerticalGridlineDivision: pt(grid.documentGrid.verticalEvery),
      HorizontalGridSubdivision: grid.documentGrid.horizontalSubdivisions,
      VerticalGridSubdivision: grid.documentGrid.verticalSubdivisions,
      BaselineStart: pt(grid.baseline.start), BaselineDivision: num(grid.baseline.incrementPt),
      BaselineGridRelativeOption: 'TopOfPageOfBaselineGridRelativeOption', BaselineViewThreshold: '25',
    })}/>`,
    `<DocumentPreference ${attrs({
      PageHeight: pt(doc.pageHeight), PageWidth: pt(doc.pageWidth), PagesPerDocument: 1, // as InDesign writes it; the spreads define the pages
      FacingPages: String(doc.format.facing), PageBinding: 'LeftToRight', Intent: 'PrintIntent',
    })}/>`,
  ].join('\n'));
}

// ---------- geometry helpers ----------
function pagePlacement(side, W, H) {
  // x origin of a page in spread coords (pt), and its transform
  const w = mmToPt(W);
  const x0 = side === 'verso' ? -w : 0;
  return { x0, transform: `1 0 0 1 ${num(x0)} ${num(-mmToPt(H) / 2)}` };
}

function pathXml(x, y, w, h) {
  const p = (px, py) => `<PathPointType Anchor="${num(px)} ${num(py)}" LeftDirection="${num(px)} ${num(py)}" RightDirection="${num(px)} ${num(py)}"/>`;
  return `<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>${
    p(x, y) + p(x, y + h) + p(x + w, y + h) + p(x + w, y)
  }</PathPointArray></GeometryPathType></PathGeometry></Properties>`;
}

function toSpread(rect, side, W, H) {
  const { x0 } = pagePlacement(side, W, H);
  return { x: x0 + mmToPt(rect.x), y: -mmToPt(H) / 2 + mmToPt(rect.y), w: mmToPt(rect.w), h: mmToPt(rect.h) };
}

function textFrameXml({ id, story, prev, next, rect, columns, gutter, firstBaseline = 'AscentOffset' }) {
  return `<TextFrame ${attrs({
    Self: id, ParentStory: story, PreviousTextFrame: prev ?? 'n', NextTextFrame: next ?? 'n', ContentType: 'TextType',
    FillColor: 'Swatch/None', StrokeColor: 'Swatch/None', StrokeWeight: '0', ItemLayer: LAYER_TEXT, ItemTransform: '1 0 0 1 0 0',
  })}>
${pathXml(rect.x, rect.y, rect.w, rect.h)}
<TextFramePreference ${attrs({
    TextColumnCount: columns, TextColumnGutter: pt(gutter), UseFixedColumnWidth: 'false',
    FirstBaselineOffset: firstBaseline, VerticalJustification: 'TopAlign',
  })}/>
</TextFrame>`;
}

function pageXml({ id, name, master, side, grid, doc, guides = '' }) {
  const m = grid.margins;
  const { transform } = pagePlacement(side, doc.pageWidth, doc.pageHeight);
  return `<Page ${attrs({
    Self: id, Name: name, AppliedMaster: master ?? 'n', OverrideList: '',
    GeometricBounds: `0 0 ${pt(doc.pageHeight)} ${pt(doc.pageWidth)}`, ItemTransform: transform,
  })}>
${guides}<MarginPreference ${attrs({
    ColumnCount: grid.columns.number, ColumnGutter: pt(grid.columns.gutter), Top: pt(m.top), Bottom: pt(m.bottom),
    Left: pt(m.inside), Right: pt(m.outside), ColumnDirection: 'Horizontal',
  })}/>
</Page>`;
}

// Guides sit inside their <Page>, before MarginPreference. A horizontal guide's
// Location is measured from the top of that page (pt), not in spread coordinates.
// Checked against an IDML exported by InDesign 2026 (PageIndex there is 1-based on
// parent spreads).
function guideXml(id, y, pageIndex, layer, color = 'Cyan') {
  return `<Guide ${attrs({
    Self: id, OverriddenPageItemProps: '', Orientation: 'Horizontal', Location: num(mmToPt(y)), FitToPage: 'true',
    ViewThreshold: '0', Locked: 'false', ItemLayer: layer, PageIndex: pageIndex, GuideType: 'Ruler', GuideZone: '1',
  })}><Properties><GuideColor type="enumeration">${color}</GuideColor></Properties></Guide>
`;
}

// ---------- spreads ----------
function masterSpreadXml(grid, doc) {
  const M = doc.master;
  let g = 0;
  const guidesFor = (i) => [
    ...doc.guides.rows.map((y) => guideXml(`uMasterGuide${g++}`, y, i + 1, LAYER_TEXT)),
    ...doc.guides.imageLines.map((y) => guideXml(`uMasterGuide${g++}`, y, i + 1, LAYER_IMAGE_LINES, 'Magenta')),
  ].join('');
  const pages = M.pages.map((side, i) => pageXml({ id: `uMasterPage${i}`, name: M.prefix, side, grid, doc, guides: guidesFor(i) }));
  const frames = M.frames.map((f, i) => textFrameXml({
    id: `uMasterFrame${i}`, story: 'uMasterStory',
    prev: i > 0 ? `uMasterFrame${i - 1}` : null, next: i < M.frames.length - 1 ? `uMasterFrame${i + 1}` : null,
    rect: toSpread(f, M.pages[i], doc.pageWidth, doc.pageHeight), columns: f.columns, gutter: f.gutter,
  }));
  // Folios: one single-line frame per parent page, each its own story.
  const folios = (doc.folios?.frames ?? []).map((f, i) => textFrameXml({
    id: `uFolioFrame${i}`, story: `uFolioStory${i}`,
    rect: toSpread(f, f.side, doc.pageWidth, doc.pageHeight), columns: 1, gutter: 0, firstBaseline: 'LeadingOffset',
  }));
  return pkg('MasterSpread', `<MasterSpread ${attrs({
    Self: 'uMaster', Name: M.name, NamePrefix: M.prefix, BaseName: M.name.slice(M.prefix.length + 1),
    ShowMasterItems: 'true', PageCount: M.pages.length, OverriddenPageItemProps: '', ItemTransform: '1 0 0 1 0 0',
  })}>
${pages.join('\n')}
${frames.join('\n')}
${folios.join('\n')}
</MasterSpread>`);
}

function spreadXml(spreadIndex, pageIdxs, grid, doc) {
  const sides = pageIdxs.map((i) => doc.pages[i].side);
  const binding = sides[0] === 'verso' ? 1 : 0;
  const ty = spreadIndex * (mmToPt(doc.pageHeight) + 36);
  const pages = pageIdxs.map((i) => pageXml({ id: `uPage${i}`, name: doc.pages[i].name, master: 'uMaster', side: doc.pages[i].side, grid, doc }));
  const frames = pageIdxs.map((i) => {
    const f = doc.frames[i];
    return textFrameXml({
      id: `uFrame${i}`, story: 'uStory',
      prev: i > 0 ? `uFrame${i - 1}` : null, next: i < doc.frames.length - 1 ? `uFrame${i + 1}` : null,
      rect: toSpread(f, doc.pages[i].side, doc.pageWidth, doc.pageHeight), columns: f.columns, gutter: f.gutter,
    });
  });
  const img = doc.image && pageIdxs.includes(doc.image.page) ? (() => {
    const r = toSpread(doc.image, doc.pages[doc.image.page].side, doc.pageWidth, doc.pageHeight);
    return `<Rectangle ${attrs({
      Self: 'uImage', ContentType: 'GraphicType', FillColor: 'Color/Black', FillTint: '12',
      StrokeColor: 'Swatch/None', StrokeWeight: '0', ItemLayer: LAYER_TEXT, ItemTransform: '1 0 0 1 0 0',
    })}>
${pathXml(r.x, r.y, r.w, r.h)}
</Rectangle>`;
  })() : '';
  return pkg('Spread', `<Spread ${attrs({
    Self: `uSpread${spreadIndex}`, PageCount: pageIdxs.length, BindingLocation: binding,
    ShowMasterItems: 'true', AllowPageShuffle: 'true', ItemTransform: `1 0 0 1 0 ${num(ty)}`,
  })}>
${pages.join('\n')}
${img}
${frames.join('\n')}
</Spread>`);
}

// ---------- stories ----------
function storyXml(id, paragraphs, group) {
  const ranges = paragraphs.map(([style, text], i) => `<ParagraphStyleRange AppliedParagraphStyle="${esc(paragraphStyleId(group, style))}">
<CharacterStyleRange AppliedCharacterStyle="${NO_CHAR}">
<Content>${esc(text)}</Content>${i < paragraphs.length - 1 ? '\n<Br/>' : ''}
</CharacterStyleRange>
</ParagraphStyleRange>`);
  return pkg('Story', `<Story Self="${id}" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">
<StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection"/>
${ranges.join('\n')}
</Story>`);
}

// Auto page number special character, as IDML writes it inside <Content>.
const PAGE_NUMBER = '<?ACE 18?>';

function folioStoryXml(id, side, title, group) {
  const t = esc(title);
  const content = side === 'verso' ? `${PAGE_NUMBER}${EM_SPACE}${t}` : `${t}${EM_SPACE}${PAGE_NUMBER}`;
  return pkg('Story', `<Story Self="${id}" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">
<StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection"/>
<ParagraphStyleRange AppliedParagraphStyle="${esc(paragraphStyleId(group, 'Folio'))}">
<CharacterStyleRange AppliedCharacterStyle="${NO_CHAR}">
<Content>${content}</Content>
</CharacterStyleRange>
</ParagraphStyleRange>
</Story>`);
}

// ---------- package ----------
/**
 * @param options.smartTextReflow default true; the plugin turns it off while it trims overset copy.
 * @param options.library the imported style library (library.js); false leaves it out.
 */
export function buildIdmlFiles(grid, styles, doc, options = {}) {
  if (!grid?.ok || !styles?.ok || !doc?.ok) throw new Error('Grid, styles and document must all be valid.');
  const library = options.library === false ? null : (options.library ?? resolveLibrary(grid));
  const folioFiles = (doc.folios?.frames ?? []).map((f, i) => ({
    id: `uFolioStory${i}`, path: `Stories/Story_uFolioStory${i}.xml`,
    data: folioStoryXml(`uFolioStory${i}`, f.side, doc.folios.title, styles.group),
  }));
  const spreadFiles = doc.spreads.map((p, i) => ({ path: `Spreads/Spread_uSpread${i}.xml`, data: spreadXml(i, p, grid, doc) }));

  const designmap = `${XML_HEAD}<?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="18.0(1)" ?>
<Document xmlns:idPkg="${NS}" ${attrs({ DOMVersion: DOM, Self: 'd', StoryList: ['uStory', 'uMasterStory', ...folioFiles.map((f) => f.id)].join(' '), ActiveLayer: LAYER_TEXT })}>
<idPkg:Graphic src="Resources/Graphic.xml"/>
<idPkg:Fonts src="Resources/Fonts.xml"/>
<idPkg:Styles src="Resources/Styles.xml"/>
<NumberingList Self="${NUMBERING_LIST}" Name="GridMonkey" ContinueNumbersAcrossStories="false" ContinueNumbersAcrossDocuments="false"/>
<idPkg:Preferences src="Resources/Preferences.xml"/>
<Layer Self="${LAYER_IMAGE_LINES}" Name="Image-lines" Visible="true" Locked="false" IgnoreWrap="false" ShowGuides="true" LockGuides="false" UI="true" Expendable="true" Printable="false"><Properties><LayerColor type="enumeration">Magenta</LayerColor></Properties></Layer>
<Layer Self="${LAYER_TEXT}" Name="Layout" Visible="true" Locked="false" IgnoreWrap="false" ShowGuides="true" LockGuides="false" UI="true" Expendable="true" Printable="true"><Properties><LayerColor type="enumeration">LightBlue</LayerColor></Properties></Layer>
<idPkg:MasterSpread src="MasterSpreads/MasterSpread_uMaster.xml"/>
${spreadFiles.map((f) => `<idPkg:Spread src="${f.path}"/>`).join('\n')}
<Section ${attrs({ Self: 'uSection', Length: doc.pages.length, Name: '', PageNumberStyle: 'Arabic', ContinueNumbering: 'true', IncludeSectionPrefix: 'false', PageStart: 'uPage0', SectionPrefix: '', Marker: '' })}/>
<idPkg:BackingStory src="XML/BackingStory.xml"/>
<idPkg:Story src="Stories/Story_uStory.xml"/>
<idPkg:Story src="Stories/Story_uMasterStory.xml"/>
${folioFiles.map((f) => `<idPkg:Story src="${f.path}"/>`).join('\n')}
</Document>
`;

  const backing = pkg('BackingStory', `<XmlStory Self="uBackingStory" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle"><CharacterStyleRange AppliedCharacterStyle="${NO_CHAR}"/></ParagraphStyleRange>
</XmlStory>`);

  return [
    { path: 'mimetype', data: 'application/vnd.adobe.indesign-idml-package' },
    { path: 'META-INF/container.xml', data: `${XML_HEAD}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="designmap.xml" media-type="text/xml"/></rootfiles>
</container>
` },
    { path: 'designmap.xml', data: designmap },
    { path: 'Resources/Graphic.xml', data: graphicXml() },
    { path: 'Resources/Fonts.xml', data: fontsXml() },
    { path: 'Resources/Styles.xml', data: stylesXml(styles, doc.folios ? [doc.folios.style] : [], library) },
    { path: 'Resources/Preferences.xml', data: preferencesXml(grid, doc, options) },
    { path: 'MasterSpreads/MasterSpread_uMaster.xml', data: masterSpreadXml(grid, doc) },
    ...spreadFiles,
    { path: 'Stories/Story_uStory.xml', data: storyXml('uStory', doc.story, styles.group) },
    { path: 'Stories/Story_uMasterStory.xml', data: storyXml('uMasterStory', [['Body', '']], styles.group) },
    ...folioFiles.map(({ path, data }) => ({ path, data })),
    { path: 'XML/BackingStory.xml', data: backing },
  ];
}

export function buildIdml(grid, styles, doc, options = {}) {
  return zipStore(buildIdmlFiles(grid, styles, doc, options));
}
