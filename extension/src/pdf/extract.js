import { composeDiacritics } from './diacritics.js';
import { remapControlChars, itemGlyphImage, UNMAPPED_GLYPH } from './glyphs.js';
import {
  roundHalfPt,
  dominantSize,
  median,
  isRotated,
  isMatrixItalic,
  columnEdges,
  COLUMN_EDGE_TOL,
} from './geometry.js';

import { matchFigures, placeImageSegments } from './figures-layout.js';
import { rotatedTableRegion, equationRegions, uprightTableRegion } from './regions.js';

export { composeDiacritics } from './diacritics.js';
export { remapControlChars, itemGlyphImage } from './glyphs.js';
export { matchFigures, imageRegionsFromOps, placeImageSegments } from './figures-layout.js';
export { rotatedTableRegion, equationRegions, uprightTableRegion } from './regions.js';

const SPACE_GAP_RATIO = 0.3;
const PARA_GAP_RATIO = 1.6;
const PAGE_CONTINUE_RATIO = 0.8;
const HEADFOOT_GAP_FACTOR = 1.6;
const HEADFOOT_PAGE_FRACTION = 0.5;
const FOOTNOTE_SIZE_RATIO = 0.85;
const FOOTNOTE_REGION_RATIO = 0.2;
const COLUMN_SPAN_TOL = 4;
const COLUMN_HEADING_RATIO = 1.5;
const INDENT_RATIO = 0.3;
const INDENT_GAP_RATIO = 0.5;
const HEADING_MAX_CHARS = 80;
const HEADING_MAX_WORDS = 12;
const TRAILING_SMALL_MIN = 4; // lines of trailing small-font before a column splits (refs/notes)
const SUBSCRIPT_MERGE_RATIO = 0.5; // a fragment within this fraction of a line's height is a sub/superscript, not a new line
const SUBSCRIPT_FONT_RATIO = 0.85; // a run smaller than this fraction of the line font is a sub/superscript candidate

const LIST_ITEM_RE = /^\s*(?:[•‣◦▪·●○∙*]|[-–—]|\d{1,3}[.)]|[A-Za-z][.)])\s+/u;
const SENTENCE_FINISHED_RE = /[.!?]['")\]”’]?$/;
const FIG_CAPTION_RE = /^\s*fig(?:ure)?\.?\s*(\d+)/i;

// extractRegions/glyphMap are injected (figures.js, encodings.js) so this module stays PDF.js-free.
export async function extractBlocks(pdf, onProgress, extractRegions = null, glyphMap = null) {
  const pageCount = pdf.numPages;
  const styleCache = new Map();
  const baseFontCache = new Map();

  const pageLines = [];
  const pageHeights = [];
  const pageWidths = [];
  const pageRegions = [];
  const pageTables = [];
  const pageUprightTables = [];
  const pageEquations = [];
  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await pdf.getPage(pageNum);
    let regions = [];
    try {
      const operatorList = await page.getOperatorList();
      if (extractRegions) regions = extractRegions(operatorList) || [];
    } catch {
      void 0;
    }
    pageRegions.push(regions);
    const content = await page.getTextContent();
    pageLines.push(
      buildLines(content.items, page, content.styles, styleCache, glyphMap, baseFontCache, pageNum)
    );
    const view = page.view;
    pageHeights.push(view ? view[3] - view[1] : 792);
    pageWidths.push(view ? view[2] - view[0] : 612);
    pageTables.push(rotatedTableRegion(content.items, view));
    pageUprightTables.push(uprightTableRegion(content.items, view));
    pageEquations.push(equationRegions(content.items, view));
    page.cleanup();
    onProgress?.(pageNum, pageCount);
  }

  stripRunningHeadFoot(pageLines);

  const blocks = [];
  const footnoteBlocks = [];
  let textPageCount = 0;

  const emit = (paragraph) => {
    if (!paragraph || !runsText(paragraph.runs).trim()) return;
    const split = splitRunInHeading(paragraph.runs);
    if (split) {
      blocks.push({ kind: 'paragraph', runs: split.heading, heading: true });
      if (runsText(split.body).trim()) blocks.push({ kind: 'paragraph', runs: split.body });
    } else {
      blocks.push({ kind: 'paragraph', runs: paragraph.runs });
    }
  };

  // Ordered reading segments across all pages; paragraphs carry across their boundaries.
  const segments = [];
  const figures = [];
  for (let p = 0; p < pageLines.length; p++) {
    let rawLines = pageLines[p];
    if (rawLines.length) textPageCount++;

    // Drop table/equation lines and snapshot the region; before footnote partitioning so a
    // low, small-font equation isn't mistaken for a footnote.
    const uprightTable = pageUprightTables[p];
    if (uprightTable) {
      rawLines = rawLines.filter(
        (line) => line.y < uprightTable.yBottom - 1 || line.y > uprightTable.yTop + 1
      );
    }
    const equations = pageEquations[p];
    for (const eq of equations) {
      rawLines = rawLines.filter(
        (line) =>
          line.y < eq.yBottom - 1 ||
          line.y > eq.yTop + 1 ||
          (line.x0 ?? 0) < eq.bbox.x0 - 4 ||
          (line.x0 ?? 0) > eq.bbox.x1
      );
    }

    const partition = partitionFootnotes(
      rawLines,
      bodyFontSize(rawLines),
      pageHeights[p],
      pageRegions[p].length > 0
    );
    const footnoteLines = partition.footnoteLines;
    let bodyLines = partition.bodyLines;

    for (const footnote of groupParagraphs(footnoteLines)) {
      if (runsText(footnote.runs).trim()) {
        footnoteBlocks.push({ kind: 'footnote', runs: footnote.runs });
      }
    }

    if (pageRegions[p].length) {
      const captions = captionsOnPage(bodyLines);
      for (const { region, num } of matchFigures(pageRegions[p], captions)) {
        figures.push({ page: p + 1, num, bbox: region });
      }
    }

    const inlineRegions = [];
    for (const eq of equations) {
      inlineRegions.push({ page: p + 1, bbox: eq.bbox, yTop: eq.yTop, yBottom: eq.yBottom });
    }
    if (uprightTable) {
      inlineRegions.push({
        page: p + 1,
        bbox: uprightTable.bbox,
        yTop: uprightTable.yTop,
        yBottom: uprightTable.yBottom,
      });
    }
    const pageSegs = placeImageSegments(orderColumns(bodyLines, pageWidths[p]), inlineRegions);
    for (const seg of pageSegs) segments.push(seg);
    // A rotated (landscape) table fills the page — no inline position, append it.
    if (pageTables[p]) segments.push({ tableImage: { page: p + 1, bbox: pageTables[p] } });
  }

  let carried = null;
  for (const segment of segments) {
    if (segment.tableImage) {
      if (carried) {
        emit(carried);
        carried = null;
      }
      blocks.push({ kind: 'image', page: segment.tableImage.page, bbox: segment.tableImage.bbox });
      continue;
    }
    // Full-width segments (front matter, spanning headings) never carry in or out.
    if (segment.isFullWidth) {
      if (carried) {
        emit(carried);
        carried = null;
      }
      for (const paragraph of groupParagraphs(segment)) emit({ runs: paragraph.runs });
      continue;
    }
    const segMaxEndX = segment.reduce((max, line) => Math.max(max, line.endX), 0);
    const paragraphs = groupParagraphs(segment).map((paragraph) => ({
      runs: paragraph.runs,
      fontSize: paragraph.fontSize,
      continues: continuesToNextPage(paragraph, segMaxEndX),
    }));
    if (!paragraphs.length) continue;

    if (carried) {
      if (carried.continues && sameTextStream(carried, paragraphs[0])) {
        joinRuns(carried.runs, paragraphs[0].runs);
        paragraphs[0] = { ...paragraphs[0], runs: carried.runs };
      } else {
        emit(carried);
      }
      carried = null;
    }
    for (let k = 0; k < paragraphs.length - 1; k++) emit(paragraphs[k]);
    carried = paragraphs[paragraphs.length - 1];
  }

  emit(carried);

  placeFigures(blocks, figures);

  for (const footnote of footnoteBlocks) blocks.push(footnote);

  for (const block of blocks) {
    for (const run of block.runs || []) {
      if (!run.glyph && run.text) run.text = composeDiacritics(run.text);
    }
  }

  return { blocks, hasText: textPageCount > 0 };
}

// Insert each figure before its caption block, or append if no caption matched.
function placeFigures(blocks, figures) {
  for (const figure of figures) {
    const imageBlock = { kind: 'image', page: figure.page, bbox: figure.bbox };
    const index = blocks.findIndex(
      (block) => !block.figured && figureNumOf(block) === figure.num
    );
    if (index >= 0) {
      blocks[index].figured = true;
      blocks.splice(index, 0, imageBlock);
    } else {
      blocks.push(imageBlock);
    }
  }
}

function figureNumOf(block) {
  if (block.kind !== 'paragraph') return null;
  const match = FIG_CAPTION_RE.exec(runsText(block.runs));
  return match ? Number(match[1]) : null;
}

function captionsOnPage(lines) {
  const captions = [];
  for (const line of lines) {
    const match = FIG_CAPTION_RE.exec(runsText(line.runs));
    if (match) {
      captions.push({ num: Number(match[1]), x0: line.x0, x1: line.endX, y: line.y });
    }
  }
  return captions;
}

// Paragraphs carry across segments only within the same font size (same text stream).
function sameTextStream(a, b) {
  return Math.round((a.fontSize || 0) * 2) === Math.round((b.fontSize || 0) * 2);
}

// Split a leading bold label into its own heading (rejects drop caps, front matter, numeric leads).
export function splitRunInHeading(runs) {
  if (!runs || !runs.length) return null;
  const first = runs[0];
  if (!first.bold) return null;

  const rest = runs.slice(1);
  const restText = runsText(rest);
  if (!restText.trim()) return null;
  if (rest[0].script) return null; // a superscript after the lead ⇒ a labeled name/term, not a heading

  const lead = first.text;
  const leadTrim = lead.trim();
  if (!/^[A-Z]/.test(leadTrim)) return null;
  if (!(/[\s.:]$/.test(lead) || /^\s/.test(restText))) return null;
  if (leadTrim.length > HEADING_MAX_CHARS || leadTrim.split(/\s+/).length > HEADING_MAX_WORDS) {
    return null;
  }

  const body = rest.map((run, i) => (i === 0 ? { ...run, text: run.text.replace(/^\s+/, '') } : run));
  return {
    heading: [{ text: leadTrim, bold: true, italic: !!first.italic }],
    body,
  };
}

// The most common line size on the page (rounded to 0.5pt).
export function bodyFontSize(lines) {
  const counts = new Map();
  for (const line of lines) {
    const size = roundHalfPt(line.fontSize || 0);
    if (size > 0) counts.set(size, (counts.get(size) || 0) + 1);
  }
  return dominantSize(counts) || 10;
}

// A footnote is markedly smaller than body AND in the bottom region (both gates required).
export function partitionFootnotes(lines, body, pageHeight, hasFigure = false) {
  const sizeCut = FOOTNOTE_SIZE_RATIO * body;
  const regionCut = FOOTNOTE_REGION_RATIO * (pageHeight || 0);
  const bodyLines = [];
  const footnoteLines = [];
  for (const line of lines) {
    const size = line.fontSize || body;
    if (size > sizeCut || line.y > regionCut) {
      bodyLines.push(line);
    } else if (isHeadingText(runsText(line.runs))) {
      bodyLines.push(line); // a section head low in a column is not a footnote
    } else if (hasFigure && isFootnoteProse(line)) {
      bodyLines.push(line); // small prose below a figure is its caption, not a footnote
    } else if (isFootnoteProse(line)) {
      footnoteLines.push(line);
    }
    // else: leaked equation/figure debris (math glyphs or no prose) — drop it
  }
  return { bodyLines, footnoteLines };
}

function isHeadingText(text) {
  const t = text.trim();
  const letters = t.replace(/[^A-Za-z]/g, '');
  return letters.length >= 3 && t.length <= HEADING_MAX_CHARS && letters === letters.toUpperCase();
}

// A real footnote is prose: it has letters and carries no unmapped/math glyphs.
function isFootnoteProse(line) {
  let hasLetter = false;
  for (const run of line.runs || []) {
    if (run.glyph || run.text.includes(UNMAPPED_GLYPH) || run.text.includes('=')) return false;
    if (!hasLetter && /\p{L}/u.test(run.text)) hasLetter = true;
  }
  return hasLetter;
}

export function continuesToNextPage(paragraph, pageMaxEndX) {
  const text = runsText(paragraph.runs).replace(/\s+$/, '');
  if (!text) return false;
  if (!SENTENCE_FINISHED_RE.test(text)) return true;
  return pageMaxEndX > 0 && paragraph.lastLineEndX >= PAGE_CONTINUE_RATIO * pageMaxEndX;
}

export function stripRunningHeadFoot(pageLines) {
  const roundY = (y) => Math.round(y / 5) * 5;
  const topCounts = new Map();
  const bottomCounts = new Map();
  const candidates = [];

  // Count exact-text recurrence up front so a shifting running head/foot is caught by content.
  const norm = (line) => runsText(line.runs || []).trim().replace(/\s+/g, ' ');
  const textPages = new Map();
  for (const lines of pageLines) {
    for (const text of new Set(lines.map(norm))) {
      if (text.length >= 6) textPages.set(text, (textPages.get(text) || 0) + 1);
    }
  }

  for (const lines of pageLines) {
    const candidate = { top: null, bottom: null };
    candidates.push(candidate);
    if (lines.length < 3) continue;

    const sorted = [...lines].sort((a, b) => b.y - a.y);
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) gaps.push(Math.abs(sorted[i - 1].y - sorted[i].y));
    const medianGap = median(gaps) || 1;

    const topGap = Math.abs(sorted[0].y - sorted[1].y);
    if (topGap > HEADFOOT_GAP_FACTOR * medianGap) {
      candidate.top = sorted[0];
      const key = roundY(sorted[0].y);
      topCounts.set(key, (topCounts.get(key) || 0) + 1);
    }
    const lastIndex = sorted.length - 1;
    const bottomGap = Math.abs(sorted[lastIndex].y - sorted[lastIndex - 1].y);
    if (bottomGap > HEADFOOT_GAP_FACTOR * medianGap) {
      candidate.bottom = sorted[lastIndex];
      const key = roundY(sorted[lastIndex].y);
      bottomCounts.set(key, (bottomCounts.get(key) || 0) + 1);
    }
  }

  const threshold = Math.max(2, Math.floor(pageLines.length * HEADFOOT_PAGE_FRACTION));
  const recurs = (counts, y) => (counts.get(roundY(y)) || 0) >= threshold;

  for (let p = 0; p < pageLines.length; p++) {
    const { top, bottom } = candidates[p];
    const dropTop = top && recurs(topCounts, top.y);
    const dropBottom = bottom && recurs(bottomCounts, bottom.y);
    if (!dropTop && !dropBottom) continue;
    pageLines[p] = pageLines[p].filter(
      (line) => line !== (dropTop && top) && line !== (dropBottom && bottom)
    );
  }

  for (let p = 0; p < pageLines.length; p++) {
    pageLines[p] = pageLines[p].filter((line) => (textPages.get(norm(line)) || 0) < threshold);
  }
}

function resolveStyle(item, page, styles, cache) {
  const fontName = item.fontName;
  let style = cache.get(fontName);
  if (!style) {
    style = null;
    try {
      const font = page.commonObjs.get(fontName);
      if (font) style = styleFromFont(font);
    } catch {
      void 0;
    }
    if (!style) {
      const fontFamily = styles?.[fontName]?.fontFamily || '';
      style = { bold: hasBoldMarker(fontFamily), italic: hasItalicMarker(fontFamily) };
    }
    cache.set(fontName, style);
  }

  return {
    bold: style.bold,
    italic: style.italic || isMatrixItalic(item.transform),
  };
}

function styleFromFont(font) {
  let bold = font.bold === true || font.black === true;
  let italic = font.italic === true;
  for (const key of ['name', 'loadedName', 'fallbackName', 'psName']) {
    const value = font[key];
    if (typeof value === 'string') {
      bold = bold || hasBoldMarker(value);
      italic = italic || hasItalicMarker(value);
    }
  }
  return { bold, italic };
}

const hasBoldMarker = (s) => /bold|black|heavy|semibold/i.test(s);
const hasItalicMarker = (s) => /italic|oblique/i.test(s);

function buildLines(items, page, styles, cache, glyphMap = null, baseFontCache = null, pageNum = 0) {
  const lines = [];
  let line = null;
  let prevEndX = null;
  let sizeChars = null;

  // Representative size = the size covering the most characters (ignores drop caps).
  const finalizeSize = () => {
    if (!line) return;
    const dominant = dominantSize(sizeChars);
    if (dominant) line.fontSize = dominant;
  };

  for (const item of items) {
    if (!item.str && !item.hasEOL) continue;
    const transform = item.transform || [1, 0, 0, 1, 0, 0];
    if (isRotated(transform)) continue;
    const x = transform[4];
    const y = transform[5];
    const fontSize = Math.abs(transform[3]) || Math.hypot(transform[0], transform[1]) || 10;

    if (!line) {
      line = { runs: [], y, fontSize, endX: x, x0: x };
      prevEndX = null;
      sizeChars = new Map();
    }

    if (item.str) {
      const { bold, italic } = resolveStyle(item, page, styles, cache);
      const needsSpace =
        prevEndX != null && x - prevEndX > SPACE_GAP_RATIO * fontSize && !endsWithSpace(line.runs);
      const glyph = itemGlyphImage(item, page, glyphMap, baseFontCache, pageNum, x, y, fontSize);
      if (glyph) {
        if (needsSpace) pushRun(line.runs, { text: ' ', bold, italic, _y: y, _fs: fontSize });
        pushRun(line.runs, { text: UNMAPPED_GLYPH, bold, italic, glyph, _y: y, _fs: fontSize });
      } else {
        let text = remapControlChars(item.str, item, page, glyphMap, baseFontCache);
        if (needsSpace) text = ' ' + text;
        pushRun(line.runs, { text, bold, italic, _y: y, _fs: fontSize });
      }
      prevEndX = x + (item.width || 0);
      line.endX = Math.max(line.endX, prevEndX);
      const size = roundHalfPt(fontSize);
      sizeChars.set(size, (sizeChars.get(size) || 0) + item.str.length);
    }

    if (item.hasEOL) {
      finalizeSize();
      lines.push(line);
      line = null;
    }
  }
  if (line) {
    finalizeSize();
    lines.push(line);
  }

  return markScripts(mergeSubSuperscript(lines.filter((l) => runsText(l.runs).length)));
}

// Tag smaller-font runs offset from the baseline as super/subscripts, then drop the geometry.
function markScripts(lines) {
  for (const line of lines) {
    const baseFs = line.fontSize;
    const baselineY = baselineOf(line, baseFs);
    const offsetTol = 0.1 * (baseFs || 1);
    for (const run of line.runs) {
      if (baseFs && run._fs < baseFs * SUBSCRIPT_FONT_RATIO && run.text.trim()) {
        const dy = run._y - baselineY;
        if (dy > offsetTol) run.script = 'super';
        else if (dy < -offsetTol) run.script = 'sub';
      }
      delete run._y;
      delete run._fs;
    }
  }
  return lines;
}

// The y shared by the longest run at the line's dominant font size.
function baselineOf(line, baseFs) {
  let bestY = line.y;
  let bestLen = -1;
  for (const run of line.runs) {
    if (Math.round(run._fs) === Math.round(baseFs) && run.text.length > bestLen) {
      bestLen = run.text.length;
      bestY = run._y;
    }
  }
  return bestY;
}

// Rejoin sub/superscript fragments PDF.js split onto their own lines.
export function mergeSubSuperscript(lines) {
  const merged = [];
  for (const line of lines) {
    const prev = merged[merged.length - 1];
    const maxFs = prev && Math.max(prev.fontSize, line.fontSize);
    // Overlapping x = stacked script; a small right gap = same-line continuation; a wide gap stays split.
    const overlaps = prev && prev.x0 <= line.endX && line.x0 <= prev.endX;
    const continues = prev && line.x0 >= prev.x0 && line.x0 - prev.endX < maxFs;
    if (prev && Math.abs(prev.y - line.y) < SUBSCRIPT_MERGE_RATIO * maxFs && (overlaps || continues)) {
      for (const run of line.runs) pushRun(prev.runs, run);
      prev.x0 = Math.min(prev.x0, line.x0);
      prev.endX = Math.max(prev.endX, line.endX);
      if (line.fontSize > prev.fontSize) {
        prev.fontSize = line.fontSize;
        prev.y = line.y;
      }
      continue;
    }
    merged.push(line);
  }
  return merged;
}

function pushRun(runs, run) {
  if (!run.text && !run.glyph) return;
  const last = runs[runs.length - 1];
  if (last && runsMergeable(last, run)) {
    last.text += run.text;
  } else {
    const next = { text: run.text, bold: run.bold, italic: run.italic };
    if (run.glyph) next.glyph = run.glyph;
    if (run.script) next.script = run.script;
    if (run._y != null) next._y = run._y;
    if (run._fs != null) next._fs = run._fs;
    runs.push(next);
  }
}

// Runs merge only within the same style, script, baseline, and size.
function runsMergeable(a, b) {
  if (a.glyph || b.glyph) return false;
  if (a.bold !== b.bold || a.italic !== b.italic) return false;
  if ((a.script || null) !== (b.script || null)) return false;
  if (a._fs != null && b._fs != null) {
    return Math.round(a._fs) === Math.round(b._fs) && Math.abs(a._y - b._y) < 0.5;
  }
  return true;
}

// Reading segments: full-width lines split bands; within a band, columns read top-down, left-to-right.
export function orderColumns(lines, pageWidth) {
  if (!lines.length) return [];
  const edges = columnEdges(lines, pageWidth);
  const sorted = [...lines].sort((a, b) => b.y - a.y);
  if (edges.length < 2) return [sorted];

  const bodySize = bodyFontSize(lines);
  const headingSize = COLUMN_HEADING_RATIO * bodySize;
  const columnOf = (line) => {
    let column = 0;
    for (let i = 0; i < edges.length; i++) {
      if (line.x0 >= edges[i] - COLUMN_EDGE_TOL) column = i;
    }
    return column;
  };
  // Full-width = reaches into the next column, or is a heading-sized font (spans even when short).
  const spansColumns = (line, column) =>
    (line.fontSize || 0) >= headingSize ||
    (column < edges.length - 1 && line.endX >= edges[column + 1] - COLUMN_SPAN_TOL);

  const segments = [];
  let band = edges.map(() => []);
  let fullWidth = [];
  // Emit every column's body before any column's trailing small-font block.
  const flushBand = () => {
    const trailings = [];
    for (const column of band) {
      if (!column.length) continue;
      const cut = trailingSmallFontStart(column);
      if (cut > 0) segments.push(column.slice(0, cut));
      if (cut < column.length) trailings.push(column.slice(cut));
    }
    for (const trailing of trailings) segments.push(trailing);
    band = edges.map(() => []);
  };
  const flushFullWidth = () => {
    if (fullWidth.length) {
      fullWidth.isFullWidth = true;
      segments.push(fullWidth);
      fullWidth = [];
    }
  };

  for (const line of sorted) {
    const column = columnOf(line);
    if (spansColumns(line, column)) {
      flushBand();
      fullWidth.push(line);
    } else if (column === 0 && continuesFullWidth(fullWidth, line)) {
      fullWidth.push(line);
    } else {
      flushFullWidth();
      band[column].push(line);
    }
  }
  flushBand();
  flushFullWidth();
  return segments;
}

// A short line one row below a full-width run, at its font, is that paragraph's last line.
function continuesFullWidth(fullWidth, line) {
  const prev = fullWidth[fullWidth.length - 1];
  if (!prev) return false;
  const sameFont = Math.round((line.fontSize || 0) * 2) === Math.round((prev.fontSize || 0) * 2);
  return sameFont && prev.y - line.y <= 1.5 * (line.fontSize || 10);
}

// Start of a column's trailing small-font block, judged against the column's own main font.
function trailingSmallFontStart(column) {
  const counts = new Map();
  for (const line of column) {
    const size = roundHalfPt(line.fontSize || 0);
    counts.set(size, (counts.get(size) || 0) + 1);
  }
  let mainFont = 0;
  for (const [size, count] of counts) if (count >= 3 && size > mainFont) mainFont = size;
  if (!mainFont) return column.length;

  const cut = FOOTNOTE_SIZE_RATIO * mainFont;
  let i = column.length;
  while (i > 0 && (column[i - 1].fontSize || mainFont) <= cut) i--;
  return column.length - i >= TRAILING_SMALL_MIN ? i : column.length;
}

export function groupParagraphs(lines) {
  if (!lines.length) return [];

  const gaps = [];
  for (let i = 1; i < lines.length; i++) gaps.push(Math.abs(lines[i - 1].y - lines[i].y));
  const medianGap = median(gaps) || lines[0].fontSize * 1.2;
  const baseLeft = Math.min(...lines.map((line) => line.x0 ?? 0));
  // A list hang-indents continuations, so its markers (not indent) delimit items.
  const isList = lines.filter((line) => LIST_ITEM_RE.test(runsText(line.runs))).length >= 2;

  const paragraphs = [];
  let paragraph = null;
  let sizeCounts = null;

  const flush = () => {
    if (paragraph && runsText(paragraph.runs).trim()) {
      paragraph.fontSize = dominantSize(sizeCounts);
      paragraphs.push(paragraph);
    }
    paragraph = null;
    sizeCounts = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i > 0) {
      const gap = Math.abs(lines[i - 1].y - line.y);
      const startsListItem = LIST_ITEM_RE.test(runsText(line.runs));
      const indented = !isList && (line.x0 ?? baseLeft) - baseLeft > INDENT_RATIO * (line.fontSize || 10);
      const newRow = gap >= INDENT_GAP_RATIO * medianGap;
      if (gap > PARA_GAP_RATIO * medianGap || startsListItem || (indented && newRow)) flush();
    }
    if (!paragraph) {
      paragraph = { runs: [], lastLineEndX: 0 };
      sizeCounts = new Map();
    }
    joinRuns(paragraph.runs, line.runs);
    paragraph.lastLineEndX = line.endX;
    const size = roundHalfPt(line.fontSize || 0);
    sizeCounts.set(size, (sizeCounts.get(size) || 0) + 1);
  }
  flush();

  return paragraphs;
}

function joinRuns(into, more) {
  if (!more.length) return;
  if (into.length) {
    const last = into[into.length - 1];
    if (/[A-Za-z]-$/.test(last.text)) {
      last.text = last.text.replace(/-$/, '');
    } else if (!/\s$/.test(last.text) && !/^\s/.test(more[0].text)) {
      last.text += ' ';
    }
  }
  for (const run of more) pushRun(into, run);
}

function runsText(runs) {
  let text = '';
  for (const run of runs) text += run.text;
  return text;
}

function endsWithSpace(runs) {
  const last = runs[runs.length - 1];
  return last ? /\s$/.test(last.text) : false;
}

