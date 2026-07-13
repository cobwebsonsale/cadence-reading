import { isRotated, roundHalfPt, dominantSize, columnEdges, COLUMN_EDGE_TOL } from './geometry.js';

const ROTATED_TABLE_MIN_ITEMS = 30;
const UPRIGHT_TABLE_MIN_ROWS = 3;
const UPRIGHT_TABLE_MIN_COLS = 2; // ≥2 wide inter-column gaps ⇒ ≥3 columns
const COLUMN_GAP_FONTS = 2.5; // a gap this many font-heights wide separates columns
const EQUATION_GLYPH_RATIO = 1.4; // a glyph this much larger than body is a math operator
const EQUATION_MAX_BIG = 2; // >this many big glyphs on a line is a heading, not an operator
const EQUATION_BAND_FONTS = 1.7; // half-height of the equation band, in body-font multiples
const EQUATION_OFFSET = 20; // an operator sits this far past the column margin (unlike a drop cap)
const EQUATION_NUM_MARGIN_TOL = 12; // equation number's right edge within this of the column margin
const EQUATION_NUM_GAP_FONTS = 0.5; // gap (in body fonts) between the equation body and its right-aligned number

// Dense rotated-text region = landscape table; the item threshold excludes stray watermarks.
export function rotatedTableRegion(items, view) {
  let count = 0;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let maxWidth = 0;
  let maxFont = 0;
  for (const item of items) {
    const t = item.transform;
    if (!t || !isRotated(t) || !item.str.trim()) continue;
    count++;
    x0 = Math.min(x0, t[4]);
    x1 = Math.max(x1, t[4]);
    y0 = Math.min(y0, t[5]);
    y1 = Math.max(y1, t[5]);
    maxWidth = Math.max(maxWidth, item.width || 0);
    maxFont = Math.max(maxFont, Math.hypot(t[1], t[3]) || 8);
  }
  if (count < ROTATED_TABLE_MIN_ITEMS) return null;

  // Pad both axes to cover the rotated glyph extents regardless of rotation sign.
  const bbox = {
    x0: x0 - maxFont - 6,
    x1: x1 + maxFont + 6,
    y0: y0 - maxWidth - 6,
    y1: y1 + maxWidth + 6,
  };
  if (view) {
    bbox.x0 = Math.max(view[0], bbox.x0);
    bbox.y0 = Math.max(view[1], bbox.y0);
    bbox.x1 = Math.min(view[2], bbox.x1);
    bbox.y1 = Math.min(view[3], bbox.y1);
  }
  return bbox;
}

// A displayed equation can't be linearized; snapshot its region, anchored on a right-aligned
// "(N)" number or an isolated oversized operator glyph.
export function equationRegions(items, view) {
  const glyphs = items.filter((it) => it.str && it.str.trim());
  if (glyphs.length < 5) return [];
  const bodyFs = modeFontSize(glyphs);

  const lines = [];
  let cur = null;
  for (const it of [...glyphs].sort((a, b) => b.transform[5] - a.transform[5])) {
    const y = it.transform[5];
    if (!cur || Math.abs(cur.y - y) > 2) { cur = { y, x0: it.transform[4], items: [] }; lines.push(cur); }
    cur.x0 = Math.min(cur.x0, it.transform[4]);
    cur.items.push(it);
  }
  const edges = columnEdges(lines, view ? view[2] - view[0] : 600);
  const columnOf = (x0) => {
    let c = 0;
    for (let i = 0; i < edges.length; i++) if (x0 >= edges[i] - COLUMN_EDGE_TOL) c = i;
    return c;
  };
  // Per-item so a line spanning both columns doesn't inflate a column's right margin.
  const columnRight = edges.map(() => 0);
  for (const ln of lines) {
    for (const it of ln.items) {
      const c = columnOf(it.transform[4]);
      const boundary = c + 1 < edges.length ? edges[c + 1] : view ? view[2] : Infinity;
      const right = it.transform[4] + (it.width || 0);
      if (right <= boundary) columnRight[c] = Math.max(columnRight[c], right);
    }
  }

  const raw = [];
  // Test each y-line per column: a band may hold an equation in one column and prose in the other.
  for (const ln of lines) {
    for (let c = 0; c < edges.length; c++) {
      const left = edges[c] - COLUMN_EDGE_TOL;
      const right = c + 1 < edges.length ? edges[c + 1] : view ? view[2] : Infinity;
      const colItems = ln.items.filter((it) => it.transform[4] >= left && it.transform[4] < right);
      if (!colItems.length) continue;
      const subline = { y: ln.y, x0: Math.min(...colItems.map((it) => it.transform[4])), items: colItems };
      const numbered = hasEquationNumber(subline, columnRight[c], bodyFs) && lineHasMathGlyph(subline);
      const big = colItems.filter((it) => Math.abs(it.transform[3]) >= EQUATION_GLYPH_RATIO * bodyFs);
      const oversized = big.length > 0 && big.length <= EQUATION_MAX_BIG && subline.x0 - edges[c] >= EQUATION_OFFSET;
      if (!numbered && !oversized) continue;

      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const other of lines) {
        if (Math.abs(other.y - ln.y) > EQUATION_BAND_FONTS * bodyFs) continue;
        for (const it of other.items) {
          const x = it.transform[4];
          if (x < left || x >= right) continue;
          const fs = Math.abs(it.transform[3]) || bodyFs;
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x + (it.width || 0));
          y0 = Math.min(y0, it.transform[5]);
          y1 = Math.max(y1, it.transform[5] + fs);
        }
      }
      if (x1 > x0 && y1 > y0) raw.push({ x0, x1, y0, y1 });
    }
  }

  raw.sort((a, b) => b.y1 - a.y1);
  const merged = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r.y1 >= last.y0 - 2 && r.x0 < last.x1 && r.x1 > last.x0) {
      last.x0 = Math.min(last.x0, r.x0);
      last.x1 = Math.max(last.x1, r.x1);
      last.y0 = Math.min(last.y0, r.y0);
      last.y1 = Math.max(last.y1, r.y1);
    } else {
      merged.push({ ...r });
    }
  }
  return merged.map((r) => ({
    bbox: { x0: r.x0 - 2, x1: r.x1 + 2, y0: r.y0 - 2, y1: r.y1 + 2 },
    yTop: r.y1,
    yBottom: r.y0,
  }));
}

// A line with an equation number "(N)" right-aligned to the margin after a wide gap.
function hasEquationNumber(line, colRight, bodyFs) {
  const sorted = [...line.items].sort((a, b) => a.transform[4] - b.transform[4]);
  let text = '';
  const startX = [];
  const endX = [];
  for (const it of sorted) {
    const per = (it.width || 0) / Math.max(1, it.str.length);
    for (let k = 0; k < it.str.length; k++) {
      text += it.str[k];
      startX.push(it.transform[4] + k * per);
      endX.push(it.transform[4] + (k + 1) * per);
    }
  }
  const m = /\(\d+[a-z]?\)/.exec(text);
  if (!m) return false;
  const last = m.index + m[0].length - 1;
  if (endX[last] < colRight - EQUATION_NUM_MARGIN_TOL) return false;
  if (m.index > 0 && startX[m.index] - endX[m.index - 1] < EQUATION_NUM_GAP_FONTS * bodyFs) return false;
  return true;
}

// The equation body carries an "=" (literal or an unmapped math glyph); rejects "(N)" citations.
function lineHasMathGlyph(line) {
  for (const it of line.items) {
    if (it.str.includes('=')) return true;
    for (const ch of it.str) {
      const c = ch.charCodeAt(0);
      if (c >= 1 && c <= 31 && c !== 9 && c !== 10 && c !== 13) return true;
    }
  }
  return false;
}

function modeFontSize(glyphs) {
  const counts = new Map();
  for (const it of glyphs) {
    const s = roundHalfPt(Math.abs(it.transform[3]) || 0);
    if (s > 0) counts.set(s, (counts.get(s) || 0) + 1);
  }
  return dominantSize(counts) || 10;
}

// Consecutive multi-column upright lines = borderless table (prose has ≤1 wide gap/line).
export function uprightTableRegion(items, view) {
  const lines = [];
  let current = null;
  const upright = items
    .filter((it) => it.str.trim() && !isRotated(it.transform || [1, 0, 0, 1, 0, 0]))
    .sort((a, b) => b.transform[5] - a.transform[5]);
  for (const it of upright) {
    const y = it.transform[5];
    if (!current || Math.abs(current.y - y) > 3) {
      current = { y, items: [] };
      lines.push(current);
    }
    current.items.push(it);
  }

  let bestStart = -1;
  let bestLen = 0;
  let runStart = 0;
  const tabular = lines.map((ln) => columnGapCount(ln.items) >= UPRIGHT_TABLE_MIN_COLS);
  for (let i = 0; i < lines.length; i++) {
    if (!tabular[i]) {
      runStart = i + 1;
      continue;
    }
    if (i - runStart + 1 > bestLen) {
      bestLen = i - runStart + 1;
      bestStart = runStart;
    }
  }
  if (bestLen < UPRIGHT_TABLE_MIN_ROWS) return null;

  const rows = lines.slice(bestStart, bestStart + bestLen);
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let fontSize = 9;
  for (const ln of rows) {
    for (const it of ln.items) {
      fontSize = Math.abs(it.transform[3]) || fontSize;
      x0 = Math.min(x0, it.transform[4]);
      x1 = Math.max(x1, it.transform[4] + (it.width || 0));
      y0 = Math.min(y0, it.transform[5]);
      y1 = Math.max(y1, it.transform[5]);
    }
  }
  const bbox = { x0: x0 - 4, x1: x1 + 4, y0: y0 - 4, y1: y1 + fontSize + 4 };
  if (view) {
    bbox.x0 = Math.max(view[0], bbox.x0);
    bbox.y0 = Math.max(view[1], bbox.y0);
    bbox.x1 = Math.min(view[2], bbox.x1);
    bbox.y1 = Math.min(view[3], bbox.y1);
  }
  return { bbox, yTop: y1 + fontSize, yBottom: y0 };
}

function columnGapCount(items) {
  const parts = items
    .filter((i) => i.str.trim())
    .map((i) => ({
      x0: i.transform[4],
      x1: i.transform[4] + (i.width || 0),
      fontSize: Math.abs(i.transform[3]) || 9,
    }))
    .sort((a, b) => a.x0 - b.x0);
  let gaps = 0;
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].x0 - parts[i - 1].x1 > COLUMN_GAP_FONTS * parts[i].fontSize) gaps++;
  }
  return gaps;
}
