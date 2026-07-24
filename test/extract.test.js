import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  stripRunningHeadFoot,
  continuesToNextPage,
  bodyFontSize,
  partitionFootnotes,
  orderColumns,
  groupParagraphs,
  splitRunInHeading,
  imageRegionsFromOps,
  vectorRegionsFromOps,
  matchFigures,
  remapControlChars,
  composeDiacritics,
  itemGlyphImage,
  rotatedTableRegion,
  uprightTableRegion,
  equationRegions,
  placeImageSegments,
  mergeSubSuperscript,
} from '../extension/src/pdf/extract.js';

const para = (text, lastLineEndX) => ({ runs: [{ text, bold: false, italic: false }], lastLineEndX });

const line = (y, tag) => ({ y, tag });

function body(topY = 700, n = 10) {
  return Array.from({ length: n }, (_, i) => line(topY - i * 20, `body${i}`));
}

test('strips a footer that recurs at the same position across pages', () => {
  const pages = [];
  for (let p = 0; p < 4; p++) {
    pages.push([...body(700, 10), line(420, 'footer')]);
  }
  stripRunningHeadFoot(pages);
  for (const pg of pages) {
    assert.equal(pg.some((l) => l.tag === 'footer'), false, 'footer removed');
    assert.ok(pg.some((l) => l.tag === 'body0'), 'body kept');
    assert.equal(pg.length, 10);
  }
});

test('strips a recurring header', () => {
  const pages = [];
  for (let p = 0; p < 4; p++) {
    pages.push([line(780, 'header'), ...body(700, 10)]);
  }
  stripRunningHeadFoot(pages);
  for (const pg of pages) {
    assert.equal(pg.some((l) => l.tag === 'header'), false, 'header removed');
    assert.equal(pg.length, 10);
  }
});

test('keeps an isolated line that does not recur (e.g. a section heading)', () => {
  const pages = [
    [line(780, 'heading'), ...body(700, 10)],
    [...body(700, 10)],
    [...body(700, 10)],
    [...body(700, 10)],
  ];
  stripRunningHeadFoot(pages);
  assert.ok(pages[0].some((l) => l.tag === 'heading'), 'non-recurring heading kept');
});

test('does not touch body lines (none are isolated)', () => {
  const pages = [body(700, 12), body(700, 12), body(700, 12)];
  const before = pages.map((p) => p.length);
  stripRunningHeadFoot(pages);
  assert.deepEqual(pages.map((p) => p.length), before);
});

test('leaves short pages (< 3 lines) alone', () => {
  const pages = [[line(700, 'a'), line(400, 'b')], [line(700, 'a'), line(400, 'b')]];
  stripRunningHeadFoot(pages);
  assert.equal(pages[0].length, 2);
});

test('a line ending mid-sentence continues even when visibly short', () => {
  assert.equal(continuesToNextPage(para('representative action ... or participate in a', 433), 542), true);
});

test('a short line ending a sentence does not continue', () => {
  assert.equal(continuesToNextPage(para('... discussed in this paragraph 5.', 200), 542), false);
});

test('a sentence that ends at the right margin still continues (wrapped)', () => {
  assert.equal(continuesToNextPage(para('... to prevent irreparable harm.', 530), 542), true);
});

test('empty paragraph does not continue', () => {
  assert.equal(continuesToNextPage(para('   ', 0), 542), false);
});

const sized = (fontSize, y) => ({ fontSize, y, runs: [{ text: 'x', bold: false, italic: false }] });

test('bodyFontSize picks the most common line size', () => {
  const lines = [sized(22, 726), sized(9, 700), ...Array.from({ length: 8 }, (_, i) => sized(9, 600 - i * 10))];
  assert.equal(bodyFontSize(lines), 9);
});

test('bodyFontSize rounds to the nearest half point', () => {
  const lines = [sized(8.98, 600), sized(9.02, 590), sized(9.01, 580), sized(22, 726)];
  assert.equal(bodyFontSize(lines), 9);
});

test('partitionFootnotes pulls small bottom-of-page lines into footnotes', () => {
  const pageHeight = 783;
  const lines = [
    sized(22, 726), // title
    sized(7, 664), //  small, but near the top (affiliation) — stays body
    sized(9, 400), //  body
    sized(9, 126), //  last body line, low on the page but full-size
    sized(6, 98), //   footnote
    sized(6, 87), //   footnote
    sized(6.5, 40), // footer-ish note
  ];
  const { bodyLines, footnoteLines } = partitionFootnotes(lines, 9, pageHeight);
  assert.deepEqual(
    footnoteLines.map((l) => l.y),
    [98, 87, 40]
  );
  assert.deepEqual(
    bodyLines.map((l) => l.y),
    [726, 664, 400, 126]
  );
});

test('partitionFootnotes keeps small lines that are not near the bottom', () => {
  const { footnoteLines } = partitionFootnotes([sized(7, 664), sized(7, 370)], 9, 783);
  assert.equal(footnoteLines.length, 0);
});

test('partitionFootnotes keeps full-size lines even when low on the page', () => {
  const { footnoteLines } = partitionFootnotes([sized(9, 65)], 9, 783);
  assert.equal(footnoteLines.length, 0);
});

test('partitionFootnotes drops leaked equation debris and keeps headings in the body', () => {
  const fn = (fontSize, y, runs) => ({ fontSize, y, runs });
  const lines = [
    fn(6, 90, [{ text: 'See Smith et al. for details.' }]), // real footnote prose
    fn(6, 80, [{ text: '2 +' }]), // no letters ⇒ equation debris, dropped
    fn(6, 70, [{ text: '□', glyph: {} }]), // glyph run ⇒ debris, dropped
    fn(6, 60, [{ text: 'DISCUSSION' }]), // all-caps heading ⇒ body, not a footnote
  ];
  const { bodyLines, footnoteLines } = partitionFootnotes(lines, 9, 783);
  assert.deepEqual(footnoteLines.map((l) => l.y), [90]);
  assert.deepEqual(bodyLines.map((l) => l.y), [60]);
});

test('partitionFootnotes routes small prose below a figure to the body as a caption', () => {
  const withFig = partitionFootnotes([sized(6, 90)], 9, 783, true);
  const noFig = partitionFootnotes([sized(6, 90)], 9, 783, false);
  assert.equal(withFig.footnoteLines.length, 0);
  assert.equal(withFig.bodyLines.length, 1);
  assert.equal(noFig.footnoteLines.length, 1);
});

test('stripRunningHeadFoot removes a footer whose text recurs across pages at shifting y', () => {
  const foot = (y) => ({ y, runs: [{ text: 'J Neurophysiol doi 10.1152' }] });
  const bodyL = (y, t) => ({ y, runs: [{ text: t }] });
  const pages = [];
  for (let i = 0; i < 6; i++) {
    pages.push([bodyL(700, `unique body ${i} content line`), bodyL(400, `second ${i} body line`), foot(40 + i * 4)]);
  }
  stripRunningHeadFoot(pages);
  assert.ok(pages.every((p) => !p.some((l) => /J Neurophysiol/.test(l.runs[0].text))));
  assert.ok(pages.every((p) => p.some((l) => /unique body/.test(l.runs[0].text))));
});

test('splitRunInHeading does not split a bold name followed by a superscript affiliation', () => {
  const runs = [
    { text: 'Hansem Sohn', bold: true, italic: false },
    { text: ' 1', bold: false, italic: false, script: 'super' },
    { text: ' and Sang-Hun Lee', bold: false, italic: false },
  ];
  assert.equal(splitRunInHeading(runs), null);
});

const col = (x0, endX, y, fontSize, text) => ({
  x0,
  endX,
  y,
  fontSize,
  runs: [{ text, bold: false, italic: false }],
});
const texts = (segments) => segments.map((seg) => seg.map((l) => l.runs[0].text));

test('orderColumns emits full-width lines, then each column top-to-bottom, left-to-right', () => {
  const title = col(52, 370, 726, 22, 'Title'); // spans the gutter + heading font
  const left = [632, 622, 612, 602].map((y, i) => col(52, 300, y, 9, `L${i}`));
  const right = [631, 621, 611, 601].map((y, i) => col(314, 560, y, 9, `R${i}`));
  // Feed the lines shuffled; ordering must come from geometry, not input order.
  const segments = orderColumns([...right, title, ...left], 594);
  assert.deepEqual(texts(segments), [
    ['Title'],
    ['L0', 'L1', 'L2', 'L3'],
    ['R0', 'R1', 'R2', 'R3'],
  ]);
});

test('orderColumns returns one top-down segment when there is a single column', () => {
  const lines = [700, 690, 680, 670, 660, 650, 640, 630].map((y, i) => col(52, 300, y, 9, `B${i}`));
  const segments = orderColumns([...lines].reverse(), 594);
  assert.deepEqual(texts(segments), [['B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7']]);
});

const bodyLine = (x0, y, text) => ({ x0, endX: 300, y, fontSize: 9, runs: [{ text, bold: false, italic: false }] });

test('groupParagraphs starts a new paragraph on a first-line indent', () => {
  // Column left edge at x0=52; indented paragraph starts at x0=61. No vertical
  // gaps beyond the normal line advance — separation comes from the indent only.
  const lines = [
    bodyLine(61, 700, 'First paragraph opens here'),
    bodyLine(52, 690, 'and wraps to a second line.'),
    bodyLine(61, 680, 'Second paragraph opens indented'),
    bodyLine(52, 670, 'and also wraps around.'),
  ];
  const paras = groupParagraphs(lines).map((p) => p.runs.map((r) => r.text).join(''));
  assert.equal(paras.length, 2);
  assert.match(paras[0], /^First paragraph opens here/);
  assert.match(paras[1], /^Second paragraph opens indented/);
});

test('groupParagraphs keeps a hanging-indent list item as one paragraph', () => {
  const L = (x0, y, text) => ({ x0, endX: 300, y, fontSize: 7, runs: [{ text, bold: false, italic: false }] });
  const paras = groupParagraphs([
    L(52, 700, '1. First reference by Smith'),
    L(64, 690, 'and continues on this line.'),
    L(52, 680, '2. Second reference by Jones'),
    L(64, 670, 'also continuing here.'),
  ]);
  assert.equal(paras.length, 2);
  assert.match(paras[0].runs.map((r) => r.text).join(''), /^1\. First reference by Smith and continues/);
});

test('groupParagraphs does not split a drop-cap spurious same-row indent', () => {
  // A drop cap makes the first row split into two lines at the same y: the tail
  // starts indented but sits on the same row, so it must stay in the paragraph.
  const lines = [
    bodyLine(52, 700.1, 'It is said that practice makes perfect but with too'),
    bodyLine(60, 700.0, 'much practice things change'),
    bodyLine(52, 690, 'and the paragraph continues normally'),
    bodyLine(52, 680, 'across several more lines'),
    bodyLine(52, 670, 'without any further indents.'),
  ];
  const paras = groupParagraphs(lines);
  assert.equal(paras.length, 1);
  assert.match(paras[0].runs.map((r) => r.text).join(''), /too much practice/);
});

test('groupParagraphs ignores a lone left-margin mark when measuring indents', () => {
  // A badge sits far left of the body margin; it must not redefine the margin and
  // make every body line read as indented.
  const lines = [
    bodyLine(20, 730, 'MARK'),
    bodyLine(52, 700, 'The body text begins here at the true'),
    bodyLine(52, 690, 'left margin and wraps across'),
    bodyLine(52, 680, 'several lines with no indent'),
    bodyLine(52, 670, 'and no blank-line breaks between them.'),
  ];
  const paras = groupParagraphs(lines).map((p) => p.runs.map((r) => r.text).join(''));
  assert.equal(paras.length, 2);
  assert.match(paras[1], /^The body text begins here.*between them\.$/);
});

test('groupParagraphs keeps a large-font title together amid small-font body leading', () => {
  // The title's own line leading dwarfs the body median; the gap threshold must
  // scale with the line's font so the title stays one paragraph.
  const heading = (y, text) => ({ x0: 52, endX: 400, y, fontSize: 24, runs: [{ text, bold: false, italic: false }] });
  const lines = [
    heading(700, 'A multi-line title that'),
    heading(672, 'spans three separate'),
    heading(644, 'visual lines here'),
    bodyLine(52, 610, 'The body starts well below the title'),
    bodyLine(52, 600, 'and wraps across many lines'),
    bodyLine(52, 590, 'at the ordinary body leading'),
    bodyLine(52, 580, 'so that the small line advance'),
    bodyLine(52, 570, 'is the dominant rhythm on'),
    bodyLine(52, 560, 'the page and sets the median'),
    bodyLine(52, 550, 'used to judge paragraph breaks.'),
  ];
  const paras = groupParagraphs(lines).map((p) => p.runs.map((r) => r.text).join(''));
  assert.equal(paras.length, 2);
  assert.match(paras[0], /^A multi-line title that.*visual lines here$/);
});

const run = (text, bold = false) => ({ text, bold, italic: false });

test('splitRunInHeading pulls a bold run-in label off the front of a paragraph', () => {
  const split = splitRunInHeading([run('Methods ', true), run('All experiments used the procedure.')]);
  assert.equal(split.heading.map((r) => r.text).join(''), 'Methods');
  assert.ok(split.heading[0].bold);
  assert.equal(split.body.map((r) => r.text).join(''), 'All experiments used the procedure.');
});

test('splitRunInHeading handles a period-terminated run-in label', () => {
  const split = splitRunInHeading([run('Participants and Procedures. ', true), run('A total of 30 people.')]);
  assert.equal(split.heading[0].text, 'Participants and Procedures.');
  assert.match(split.body[0].text, /^A total/);
});

test('splitRunInHeading ignores a drop cap that continues a word', () => {
  assert.equal(splitRunInHeading([run('I', true), run('t is said that practice makes perfect.')]), null);
});

test('splitRunInHeading ignores an all-bold paragraph with no body', () => {
  assert.equal(splitRunInHeading([run('The Time Course of Perceptual Deterioration', true)]), null);
});

test('splitRunInHeading ignores a numeric bold lead (reference volume number)', () => {
  assert.equal(splitRunInHeading([run('28, ', true), run('573–584.')]), null);
});

test('splitRunInHeading ignores a paragraph whose first run is not bold', () => {
  assert.equal(splitRunInHeading([run('Ordinary body text begins here.')]), null);
});

const PAINT = 9;
const OPS = { save: 1, restore: 2, transform: 3, imagePaint: new Set([PAINT]) };

test('imageRegionsFromOps computes an image bbox from the current transform matrix', () => {
  // transform scales to 200x100 and translates to (50, 600), then paints.
  const fnArray = [OPS.transform, PAINT];
  const argsArray = [[200, 0, 0, 100, 50, 600], null];
  const regions = imageRegionsFromOps(fnArray, argsArray, OPS);
  assert.equal(regions.length, 1);
  assert.deepEqual(regions[0], { x0: 50, x1: 250, y0: 600, y1: 700 });
});

test('imageRegionsFromOps drops tiny regions and honors save/restore', () => {
  const fnArray = [OPS.save, OPS.transform, PAINT, OPS.restore, PAINT];
  const argsArray = [null, [20, 0, 0, 20, 0, 0], null, null, null];
  // Inside save/restore: a 20x20 image (too small → dropped). After restore the
  // matrix is back to identity, so the second paint is a 1x1 unit square (dropped).
  assert.equal(imageRegionsFromOps(fnArray, argsArray, OPS).length, 0);
});

const VPAINT = 6;
const VOPS = { save: 1, restore: 2, transform: 3, constructPath: 4, endPath: 5, paint: new Set([VPAINT]) };
const PATH = (minMax) => [null, null, minMax];

test('vectorRegionsFromOps clusters nearby vector marks into one figure region', () => {
  const fnArray = [];
  const argsArray = [];
  // A grid of small filled boxes forming a ~120x80 figure, each painted after its path.
  for (let row = 0; row < 4; row++) {
    for (let cvol = 0; cvol < 3; cvol++) {
      const x = 100 + cvol * 40;
      const y = 500 + row * 20;
      fnArray.push(VOPS.constructPath, VPAINT);
      argsArray.push(PATH([x, y, x + 30, y + 12]), null);
    }
  }
  const regions = vectorRegionsFromOps(fnArray, argsArray, VOPS, [0, 0, 595, 782]);
  assert.equal(regions.length, 1);
  assert.ok(regions[0].bbox.x0 <= 100 && regions[0].bbox.x1 >= 210);
  assert.ok(regions[0].yBottom <= 500 && regions[0].yTop >= 560);
});

test('vectorRegionsFromOps ignores long thin rules and undersized clusters', () => {
  // A full-height margin rule (thin + long) and a lone small box: neither is a region.
  const fnArray = [VOPS.constructPath, VPAINT, VOPS.constructPath, VPAINT];
  const argsArray = [PATH([148, 50, 148, 650]), null, PATH([100, 500, 130, 520]), null];
  assert.equal(vectorRegionsFromOps(fnArray, argsArray, VOPS, [0, 0, 595, 782]).length, 0);
});

test('matchFigures pairs each caption with the nearest overlapping region above it', () => {
  const regions = [
    { x0: 52, x1: 298, y0: 661, y1: 741 }, // left column, top
    { x0: 336, x1: 540, y0: 531, y1: 740 }, // right column
  ];
  const captions = [
    { num: 1, x0: 52, x1: 200, y: 650 }, // below the left-column figure
    { num: 2, x0: 336, x1: 500, y: 520 }, // below the right-column figure
  ];
  const matches = matchFigures(regions, captions);
  assert.deepEqual(
    matches.map((m) => [m.num, m.region.x0]),
    [
      [1, 52],
      [2, 336],
    ]
  );
});

test('matchFigures ignores a region that does not share the caption column', () => {
  const regions = [{ x0: 336, x1: 540, y0: 531, y1: 740 }];
  const captions = [{ num: 1, x0: 52, x1: 200, y: 650 }];
  assert.equal(matchFigures(regions, captions).length, 0);
});

const ctrl = (n) => String.fromCharCode(n);

test('remapControlChars substitutes recovered glyphs and boxes the rest', () => {
  const glyphMap = new Map([['MathFont', new Map([[1, '≈'], [5, '±']])]]);
  const baseCache = new Map([['f1', 'MathFont']]);
  const item = { fontName: 'f1' };
  const input = `P ${ctrl(4)} 0.05 lasting ${ctrl(1)} 3.2 ${ctrl(5)} 0.4`;
  // code 1 → ≈ and code 5 → ± are recovered; code 4 is unmapped → box.
  const out = remapControlChars(input, item, null, glyphMap, baseCache);
  assert.equal(out, 'P □ 0.05 lasting ≈ 3.2 ± 0.4');
});

const glyphItem = (str, width = 12) => ({ str, fontName: 'f1', width });
const mathCache = new Map([['f1', 'MathFont']]);

test('itemGlyphImage crops a whole multi-char math run when any glyph is unmapped', () => {
  // "= Δ": code 2 resolves to "=", code 1 (Δ) does not → whole item becomes an image.
  const glyphMap = new Map([['MathFont', new Map([[2, '=']])]]);
  const item = glyphItem(`${String.fromCharCode(2)} ${String.fromCharCode(1)}`, 15);
  const glyph = itemGlyphImage(item, null, glyphMap, mathCache, 3, 100, 200, 10);
  assert.ok(glyph);
  assert.deepEqual(glyph.bbox, { x0: 100, x1: 115, y0: 200 - 2.5, y1: 200 + 8.5 });
  assert.equal(glyph.page, 3);
});

test('itemGlyphImage returns null when every control glyph resolves', () => {
  const glyphMap = new Map([['MathFont', new Map([[2, '='], [1, '≈']])]]);
  const item = glyphItem(`${String.fromCharCode(2)}${String.fromCharCode(1)}`);
  assert.equal(itemGlyphImage(item, null, glyphMap, mathCache, 1, 0, 0, 10), null);
});

test('itemGlyphImage returns null for ordinary text', () => {
  assert.equal(itemGlyphImage(glyphItem('plain'), null, new Map(), mathCache, 1, 0, 0, 10), null);
});

const rotatedItem = (x, y) => ({ str: 'x', width: 8, transform: [0, 10, -10, 0, x, y] });
const uprightItem = (x, y) => ({ str: 'x', width: 8, transform: [10, 0, 0, 10, x, y] });

test('rotatedTableRegion returns a clamped bbox for a dense rotated block', () => {
  const items = [];
  for (let i = 0; i < 40; i++) items.push(rotatedItem(100 + i, 100 + i));
  const region = rotatedTableRegion(items, [0, 0, 600, 800]);
  assert.ok(region);
  assert.ok(region.x0 >= 0 && region.y0 >= 0 && region.x1 <= 600 && region.y1 <= 800);
  assert.ok(region.x1 > region.x0 && region.y1 > region.y0);
});

test('rotatedTableRegion ignores a stray rotated run (e.g. a watermark)', () => {
  const items = [rotatedItem(500, 400), rotatedItem(500, 410), ...Array.from({ length: 20 }, (_, i) => uprightItem(i * 5, 700))];
  assert.equal(rotatedTableRegion(items, [0, 0, 600, 800]), null);
});

// Build a text item at (x, y) with a given width, font size 9.
const cell = (str, x, y, w) => ({ str, width: w, transform: [9, 0, 0, 9, x, y] });
// A tabular row: three columns spaced far apart (wide gaps between them).
const tableRow = (y) => [cell('aa', 60, y, 15), cell('bb', 200, y, 15), cell('cc', 340, y, 15)];

test('uprightTableRegion detects a run of aligned multi-column rows', () => {
  const items = [...tableRow(500), ...tableRow(488), ...tableRow(476), ...tableRow(464)];
  const region = uprightTableRegion(items, [0, 0, 612, 792]);
  assert.ok(region, 'table region found');
  assert.ok(region.bbox.x1 > region.bbox.x0 && region.bbox.y1 > region.bbox.y0);
  assert.ok(region.yTop > region.yBottom);
});

test('uprightTableRegion ignores ordinary prose (no wide intra-line gaps)', () => {
  // Continuous prose: words with normal spacing, one item per line.
  const prose = [cell('the quick brown fox jumps', 60, 500, 200), cell('over the lazy dog again', 60, 488, 190), cell('and keeps on running here', 60, 476, 195)];
  assert.equal(uprightTableRegion(prose, [0, 0, 612, 792]), null);
});

test('uprightTableRegion needs enough rows (a single columned line is not a table)', () => {
  assert.equal(uprightTableRegion(tableRow(500), [0, 0, 612, 792]), null);
});

test('composeDiacritics recomposes a dotless-i + diaeresis into ï', () => {
  // "na" + U+0131 (dotless i) + U+00A8 (spacing diaeresis) + "ve"
  assert.equal(composeDiacritics('naı¨ve'), 'naïve');
});

test('composeDiacritics recomposes a base letter + spacing acute', () => {
  assert.equal(composeDiacritics('cafe´'), 'café');
});

test('composeDiacritics leaves ordinary text unchanged', () => {
  assert.equal(composeDiacritics('ordinary text'), 'ordinary text');
});

test('remapControlChars leaves ordinary text untouched', () => {
  const out = remapControlChars('plain text 90', {}, null, new Map(), new Map());
  assert.equal(out, 'plain text 90');
});

test('remapControlChars boxes glyphs when the font has no recovered encoding', () => {
  const out = remapControlChars(`x${ctrl(2)}y`, { fontName: 'f9' }, null, new Map(), new Map([['f9', 'Unknown']]));
  assert.equal(out, 'x□y');
});

const glyph = (str, x, y, fs, w = 5) => ({ str, width: w, transform: [fs, 0, 0, fs, x, y] });
const bodyColumn = (n = 10) => Array.from({ length: n }, (_, i) => glyph('ordinary body text here', 52, 700 - i * 10, 9, 120));

test('equationRegions snapshots a displayed equation (isolated offset oversized glyph)', () => {
  const items = [
    ...bodyColumn(),
    glyph('Σ', 115, 500, 15, 8), // isolated oversized operator, offset from margin, in a gap
    glyph('a b', 205, 508, 9, 40),
    glyph('c d', 224, 492, 9, 40),
  ];
  const regions = equationRegions(items, [0, 0, 306, 800]);
  assert.equal(regions.length, 1);
  assert.ok(regions[0].bbox.x0 >= 90 && regions[0].bbox.x1 <= 306);
  assert.ok(regions[0].yTop > regions[0].yBottom);
});

test('equationRegions detects a numbered equation (right-aligned (N) + math glyph)', () => {
  const items = [
    ...bodyColumn(),
    glyph('x', 60, 500, 9, 6),
    glyph('=', 70, 500, 9, 6),
    glyph('y', 82, 500, 9, 6),
    glyph('(5)', 155, 500, 9, 15),
  ];
  assert.equal(equationRegions(items, [0, 0, 220, 800]).length, 1);
});

test('equationRegions attributes a numbered equation to its own column, not same-y prose', () => {
  const col1Body = Array.from({ length: 8 }, (_, i) => glyph('right column body text', 330, 695 - i * 10, 9, 150));
  const items = [
    ...bodyColumn(8), // column 0 at x52
    ...col1Body, // column 1 at x330, baselines staggered so columns stay distinct
    glyph('session with replacement and applying', 52, 500, 9, 120), // column-0 prose, same y, no number
    glyph('x', 330, 500, 9, 6),
    glyph('=', 340, 500, 9, 6), // math glyph
    glyph('(8)', 470, 500, 9, 15), // right-aligned equation number in column 1
  ];
  const regions = equationRegions(items, [0, 0, 600, 800]);
  assert.equal(regions.length, 1);
  assert.ok(regions[0].bbox.x0 >= 300, 'region sits in the equation column');
});

test('equationRegions ignores a reference with a (year) but no math glyph', () => {
  const items = [...bodyColumn(), glyph('Levi D M', 52, 500, 9, 50), glyph('(2004)', 130, 500, 9, 30)];
  assert.equal(equationRegions(items, [0, 0, 220, 800]).length, 0);
});

test('mergeSubSuperscript rejoins a superscript fragment split onto its own line', () => {
  const ln = (text, y, fontSize, x0, endX) => ({ runs: [{ text }], y, fontSize, x0, endX });
  const out = mergeSubSuperscript([
    ln('deviation (D', 192.5, 9, 52, 156),
    ln('NF', 196.2, 5.5, 150, 158), // raised superscript, overlapping x
    ln(') curves', 192.5, 9, 158, 220),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].runs.map((r) => r.text).join(''), 'deviation (DNF) curves');
  assert.equal(out[0].y, 192.5, 'keeps the baseline y so it sorts in reading order');
});

test('mergeSubSuperscript rejoins a same-baseline fragment split off by a spurious break', () => {
  const ln = (text, y, fontSize, x0, endX) => ({ runs: [{ text }], y, fontSize, x0, endX });
  const out = mergeSubSuperscript([
    ln('constraint on', 445, 9, 53, 282),
    ln('X', 445, 9, 285, 305), // same baseline, small gap ⇒ continuation, not a new line
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].runs.map((r) => r.text).join(''), 'constraint onX');
});

test('mergeSubSuperscript does not merge a same-y line across a column gap', () => {
  const ln = (text, y, x0, endX) => ({ runs: [{ text }], y, fontSize: 9, x0, endX });
  const out = mergeSubSuperscript([
    ln('left column line', 445, 53, 200),
    ln('right column line', 445, 316, 500), // same y, but a column-width gap away
  ]);
  assert.equal(out.length, 2);
});

test('mergeSubSuperscript keeps genuinely separate lines apart', () => {
  const ln = (text, y, x0, endX) => ({ runs: [{ text }], y, fontSize: 9, x0, endX });
  const out = mergeSubSuperscript([
    ln('first line', 192.5, 52, 156), // next line is a full line-height below
    ln('second line', 182.5, 52, 160),
    ln('other column', 192.6, 317, 500), // same y, no x-overlap
  ]);
  assert.equal(out.length, 3);
});

test('placeImageSegments inserts an image inline between the split column parts', () => {
  const line = (y) => ({ x0: 52, endX: 300, y });
  const col = [line(700), line(690), line(680), line(660), line(650)]; // gap ~675 where the eq was
  const region = { page: 1, bbox: { x0: 60, x1: 280, y0: 670, y1: 680 }, yTop: 680, yBottom: 670 };
  const out = placeImageSegments([col], [region]);
  assert.equal(out.length, 3);
  assert.equal(out[0].length, 3, 'lines above the equation');
  assert.ok(out[1].tableImage, 'image segment in the middle');
  assert.equal(out[2].length, 2, 'lines below the equation');
});

test('placeImageSegments puts a region above all column text at the top, not the end', () => {
  const line = (y) => ({ x0: 52, endX: 300, y });
  const col = [line(504), line(490), line(480), line(470)]; // caption + body, all below the region
  const region = { page: 1, bbox: { x0: 60, x1: 280, y0: 521, y1: 735 }, yTop: 735, yBottom: 521 };
  const out = placeImageSegments([col], [region]);
  assert.ok(out[0].tableImage, 'image comes first');
  assert.equal(out[1].length, 4, 'all text follows the image');
});

test('equationRegions ignores a drop cap (oversized glyph at the margin)', () => {
  const items = [...bodyColumn(), glyph('I', 52, 500, 24, 12)];
  assert.equal(equationRegions(items, [0, 0, 306, 800]).length, 0);
});

test('equationRegions ignores ordinary body text', () => {
  assert.equal(equationRegions(bodyColumn(), [0, 0, 306, 800]).length, 0);
});

const bandLine = (x0, endX, y, fontSize, text = 'x') => ({
  x0,
  endX,
  y,
  fontSize,
  runs: [{ text, bold: false, italic: false }],
});

test('orderColumns reads both columns\' body before either column\'s trailing references', () => {
  const lines = [];
  [700, 690, 680, 670].forEach((y, i) => lines.push(bandLine(52, 290, y, 9, `Lb${i}`)));
  [600, 591, 582, 573, 564].forEach((y, i) => lines.push(bandLine(52, 290, y, 7, `Lr${i}`)));
  [700, 690, 680, 670].forEach((y, i) => lines.push(bandLine(314, 560, y, 9, `Rb${i}`)));
  [600, 591, 582, 573, 564].forEach((y, i) => lines.push(bandLine(314, 560, y, 7, `Rr${i}`)));
  const segs = orderColumns(lines, 612);
  // body col0, body col1, then refs col0, refs col1 — not col0-all then col1-all.
  assert.deepEqual(
    segs.map((s) => [s[0].x0, s[0].fontSize]),
    [[52, 9], [314, 9], [52, 7], [314, 7]]
  );
});

test('orderColumns keeps a full-width paragraph\'s short last line in the full-width segment', () => {
  const lines = [
    bandLine(52, 560, 700, 8, 'c0'), // full-width caption lines (span the gutter)
    bandLine(52, 560, 691, 8, 'c1'),
    bandLine(52, 180, 682, 8, 'c2 short last line'), // short → would look like column 0
  ];
  [640, 631, 622, 613].forEach((y, i) => lines.push(bandLine(52, 290, y, 10, `L${i}`)));
  [640, 631, 622, 613].forEach((y, i) => lines.push(bandLine(314, 560, y, 10, `R${i}`)));
  const segs = orderColumns(lines, 612);
  assert.equal(segs[0].isFullWidth, true);
  assert.equal(segs[0].length, 3, 'short last line stays with the full-width caption');
  assert.ok(!segs.some((s) => s.length === 1 && s[0].fontSize === 8), 'no orphaned caption line');
});

test('orderColumns still detects two columns when sparse mid-page starts bridge the gutter', () => {
  const lines = [];
  for (let i = 0; i < 12; i++) lines.push(bandLine(52, 290, 700 - i * 10, 9, `L${i}`));
  for (let i = 0; i < 12; i++) lines.push(bandLine(314, 560, 700 - i * 10, 9, `R${i}`));
  // sparse starts from an equation, spanning the gutter — must not merge the columns.
  lines.push(bandLine(150, 260, 500, 9, 'x'));
  lines.push(bandLine(200, 300, 490, 9, 'y'));
  lines.push(bandLine(250, 300, 480, 9, 'z'));
  const segs = orderColumns(lines, 612);
  assert.ok(segs.length >= 2, 'two columns detected despite the bridging starts');
  assert.ok(
    segs.some((s) => s.length >= 12 && s.every((l) => l.x0 >= 314)),
    'the right column is its own segment'
  );
});

test('orderColumns tags a full-width band so it can be isolated from the columns', () => {
  const lines = [bandLine(52, 560, 720, 9, 'spanning header')];
  [700, 690, 680, 670].forEach((y, i) => lines.push(bandLine(52, 290, y, 9, `L${i}`)));
  [700, 690, 680, 670].forEach((y, i) => lines.push(bandLine(314, 560, y, 9, `R${i}`)));
  const segs = orderColumns(lines, 612);
  assert.ok(segs.some((s) => s.isFullWidth), 'full-width band tagged');
  assert.equal(segs[0].isFullWidth, true, 'the spanning header is the first, isolated segment');
});

test('a full-width heading between column bands splits them into ordered segments', () => {
  const upperL = [700, 690].map((y, i) => col(52, 300, y, 9, `UL${i}`));
  const upperR = [699, 689].map((y, i) => col(314, 560, y, 9, `UR${i}`));
  const heading = col(52, 400, 660, 14, 'Heading'); // spans + larger font
  const lowerL = [620, 610].map((y, i) => col(52, 300, y, 9, `LL${i}`));
  const lowerR = [619, 609].map((y, i) => col(314, 560, y, 9, `LR${i}`));
  const segments = orderColumns([...upperL, ...upperR, heading, ...lowerL, ...lowerR], 594);
  assert.deepEqual(texts(segments), [
    ['UL0', 'UL1'],
    ['UR0', 'UR1'],
    ['Heading'],
    ['LL0', 'LL1'],
    ['LR0', 'LR1'],
  ]);
});
