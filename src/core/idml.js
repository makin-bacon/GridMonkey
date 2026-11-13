// IDML package writer. Turns a grid + styles + document model into the files of an
// InDesign Markup Language package (a ZIP). Pure; no I/O.
//
// Targets DOMVersion 8.0 (CS6) so any modern InDesign opens it. Geometry in IDML is
// in points, in spread coordinates: x = 0 is the spine, page tops sit at y = -H/2.

import { mmToPt } from './grid.js';
import { zipStore } from './zip.js';

const NS = 'http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging';
const DOM = '8.0';
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
    GridAlignment: 'AlignToBaseline',
    GridAlignFirstLineOnly: String(s.alignFirstLineOnly),
    Hyphenation: String(s.hyphenation),
    KeepWithNext: String(s.keepWithNext),
    BulletsAndNumberingListType: !s.list ? 'NoList' : s.list.type === 'bullet' ? 'BulletList' : 'NumberedList',
  };
  const props = [
    s.basedOn
      ? `<BasedOn type="object">${esc(id(s.basedOn))}</BasedOn>`
      : `<BasedOn type="string">${esc(NO_PARA)}</BasedOn>`,
    `<Leading type="unit">${num(s.leading)}</Leading>`,
    `<AppliedFont type="string">${esc(s.appliedFont)}</AppliedFont>`,
  ];
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

function stylesXml(styles) {
  const names = new Set(styles.styles.map((s) => s.name));
  return pkg('Styles', `<RootCharacterStyleGroup Self="uRootCharStyles">
<CharacterStyle Self="${NO_CHAR}" Imported="false" Name="$ID/[No character style]"/>
</RootCharacterStyleGroup>
<RootParagraphStyleGroup Self="uRootParaStyles">
<ParagraphStyle Self="ParagraphStyle/${NO_PARA}" Imported="false" Name="${NO_PARA}"/>
<ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Imported="false" Name="$ID/NormalParagraphStyle">
<Properties><BasedOn type="string">${NO_PARA}</BasedOn></Properties>
</ParagraphStyle>
<ParagraphStyleGroup Self="ParagraphStyleGroup/${esc(styles.group)}" Name="${esc(styles.group)}">
${styles.styles.map((s) => paragraphStyleXml(s, styles.group, names)).join('\n')}
</ParagraphStyleGroup>
</RootParagraphStyleGroup>`);
}

// ---------- Graphic.xml / Fonts.xml ----------
const graphicXml = () => pkg('Graphic', `<Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" ColorOverride="Specialblack" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="Black" ColorEditable="false" ColorRemovable="false" Visible="true"/>
<Color Self="Color/Paper" Model="Process" Space="CMYK" ColorValue="0 0 0 0" ColorOverride="Specialpaper" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="Paper" ColorEditable="true" ColorRemovable="false" Visible="true"/>
<Color Self="Color/Registration" Model="Registration" Space="CMYK" ColorValue="100 100 100 100" ColorOverride="Specialregistration" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="Registration" ColorEditable="false" ColorRemovable="false" Visible="true"/>
<Swatch Self="Swatch/None" Name="None" ColorEditable="false" ColorRemovable="false" Visible="true"/>
<StrokeStyle Self="StrokeStyle/$ID/Solid" Name="$ID/Solid"/>`);

const fontsXml = () => pkg('Fonts', ''); // fonts resolve by family name from the system

// ---------- Preferences.xml ----------
function preferencesXml(grid, doc) {
  const m = grid.margins;
  return pkg('Preferences', [
    `<TextPreference ${attrs({
      SmartTextReflow: 'true', AddPages: 'EndOfStory', LimitToMasterTextFrames: 'false',
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
    // Grids and guides visible as soon as the file opens.
    `<GuidePreference ${attrs({ GuidesShown: 'true', GuidesLocked: 'false', GuidesInBack: 'false', GuidesSnapto: 'true' })}/>`,
    `<GridPreference ${attrs({
      DocumentGridShown: 'true', DocumentGridSnapto: 'false', BaselineGridShown: 'true', GridsInBack: 'true',
      HorizontalGridlineDivision: pt(grid.documentGrid.horizontalEvery),
      VerticalGridlineDivision: pt(grid.documentGrid.verticalEvery),
      HorizontalGridSubdivision: grid.documentGrid.horizontalSubdivisions,
      VerticalGridSubdivision: grid.documentGrid.verticalSubdivisions,
      BaselineStart: pt(grid.baseline.start), BaselineDivision: num(grid.baseline.incrementPt),
      BaselineGridRelativeOption: 'TopOfPageOfBaselineGridRelativeOption', BaselineViewThreshold: '25',
    })}/>`,
    `<DocumentPreference ${attrs({
      PageHeight: pt(doc.pageHeight), PageWidth: pt(doc.pageWidth), PagesPerDocument: doc.pages.length,
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

function textFrameXml({ id, story, prev, next, rect, columns, gutter }) {
  return `<TextFrame ${attrs({
    Self: id, ParentStory: story, PreviousTextFrame: prev ?? 'n', NextTextFrame: next ?? 'n', ContentType: 'TextType',
    FillColor: 'Swatch/None', StrokeColor: 'Swatch/None', StrokeWeight: '0', ItemLayer: LAYER_TEXT, ItemTransform: '1 0 0 1 0 0',
  })}>
${pathXml(rect.x, rect.y, rect.w, rect.h)}
<TextFramePreference ${attrs({
    TextColumnCount: columns, TextColumnGutter: pt(gutter), UseFixedColumnWidth: 'false',
    FirstBaselineOffset: 'AscentOffset', VerticalJustification: 'TopAlign',
  })}/>
</TextFrame>`;
}

function pageXml({ id, name, master, side, grid, doc }) {
  const m = grid.margins;
  const { transform } = pagePlacement(side, doc.pageWidth, doc.pageHeight);
  return `<Page ${attrs({
    Self: id, Name: name, AppliedMaster: master ?? 'n', OverrideList: '',
    GeometricBounds: `0 0 ${pt(doc.pageHeight)} ${pt(doc.pageWidth)}`, ItemTransform: transform,
  })}>
<MarginPreference ${attrs({
    ColumnCount: grid.columns.number, ColumnGutter: pt(grid.columns.gutter), Top: pt(m.top), Bottom: pt(m.bottom),
    Left: pt(m.inside), Right: pt(m.outside), ColumnDirection: 'Horizontal',
  })}/>
</Page>`;
}

function guideXml(id, y, pageIndex, side, doc, layer, color) {
  const Y = -mmToPt(doc.pageHeight) / 2 + mmToPt(y);
  return `<Guide ${attrs({
    Self: id, Orientation: 'Horizontal', Location: num(Y), FitToPage: 'true', ViewThreshold: '0',
    Locked: 'false', ItemLayer: layer, PageIndex: pageIndex, GuideColor: color,
  })}/>`;
}

// ---------- spreads ----------
function masterSpreadXml(grid, doc) {
  const M = doc.master;
  const pages = M.pages.map((side, i) => pageXml({ id: `uMasterPage${i}`, name: M.prefix, side, grid, doc }));
  const frames = M.frames.map((f, i) => textFrameXml({
    id: `uMasterFrame${i}`, story: 'uMasterStory',
    prev: i > 0 ? `uMasterFrame${i - 1}` : null, next: i < M.frames.length - 1 ? `uMasterFrame${i + 1}` : null,
    rect: toSpread(f, M.pages[i], doc.pageWidth, doc.pageHeight), columns: f.columns, gutter: f.gutter,
  }));
  let g = 0;
  const guides = M.pages.flatMap((side, i) => [
    ...doc.guides.rows.map((y) => guideXml(`uMasterGuide${g++}`, y, i, side, doc, LAYER_TEXT)),
    ...doc.guides.imageLines.map((y) => guideXml(`uMasterGuide${g++}`, y, i, side, doc, LAYER_IMAGE_LINES, 'Magenta')),
  ]);
  return pkg('MasterSpread', `<MasterSpread ${attrs({
    Self: 'uMaster', Name: M.name, NamePrefix: M.prefix, BaseName: M.name.slice(M.prefix.length + 1),
    ShowMasterItems: 'true', PageCount: M.pages.length, OverriddenPageItemProps: '', ItemTransform: '1 0 0 1 0 0',
  })}>
${pages.join('\n')}
${frames.join('\n')}
${guides.join('\n')}
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

// ---------- package ----------
export function buildIdmlFiles(grid, styles, doc) {
  if (!grid?.ok || !styles?.ok || !doc?.ok) throw new Error('Grid, styles and document must all be valid.');
  const spreadFiles = doc.spreads.map((p, i) => ({ path: `Spreads/Spread_uSpread${i}.xml`, data: spreadXml(i, p, grid, doc) }));

  const designmap = `${XML_HEAD}<?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="8.0(370)" ?>
<Document xmlns:idPkg="${NS}" ${attrs({ DOMVersion: DOM, Self: 'd', StoryList: 'uStory uMasterStory', ActiveLayer: LAYER_TEXT })}>
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
    { path: 'Resources/Styles.xml', data: stylesXml(styles) },
    { path: 'Resources/Preferences.xml', data: preferencesXml(grid, doc) },
    { path: 'MasterSpreads/MasterSpread_uMaster.xml', data: masterSpreadXml(grid, doc) },
    ...spreadFiles,
    { path: 'Stories/Story_uStory.xml', data: storyXml('uStory', doc.story, styles.group) },
    { path: 'Stories/Story_uMasterStory.xml', data: storyXml('uMasterStory', [['Body', '']], styles.group) },
    { path: 'XML/BackingStory.xml', data: backing },
  ];
}

export function buildIdml(grid, styles, doc) {
  return zipStore(buildIdmlFiles(grid, styles, doc));
}
