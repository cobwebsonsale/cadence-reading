const COLUMN_GAP_RATIO = 0.12;
const COLUMN_CLUSTER_GAP = 8;
const COLUMN_MIN_LINES = 3;
export const COLUMN_EDGE_TOL = 4;

export function roundHalfPt(size) {
  return Math.round(size * 2) / 2;
}

export function dominantSize(counts) {
  let best = 0;
  let bestCount = -1;
  for (const [size, count] of counts || []) {
    if (count > bestCount) {
      bestCount = count;
      best = size;
    }
  }
  return best;
}

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Rotated text lands in transform[1] (b); italic shear is in [2] (c), so test b.
export function isRotated(transform) {
  if (!transform) return false;
  const [a, b] = transform;
  return Math.abs(b) > 0.3 * (Math.abs(a) || 1);
}

export function isMatrixItalic(transform) {
  if (!transform) return false;
  const [a, b, , d] = transform;
  if (Math.abs(b) > 0.01 * (Math.abs(a) || 1)) return false;
  const shear = transform[2];
  return Math.abs(shear) / (Math.abs(d) || 1) > 0.15;
}

// Column left-edges: cluster line-starts into anchors, dropping sparse math that bridges gutters.
export function columnEdges(lines, pageWidth) {
  const xs = lines.map((line) => line.x0).sort((a, b) => a - b);
  if (xs.length < 8) return xs.length ? [xs[0]] : [];

  const clusters = [];
  let start = 0;
  for (let i = 1; i <= xs.length; i++) {
    if (i === xs.length || xs[i] - xs[i - 1] > COLUMN_CLUSTER_GAP) {
      clusters.push({ left: xs[start], count: i - start });
      start = i;
    }
  }

  const minLines = Math.max(COLUMN_MIN_LINES, Math.floor(xs.length * 0.1));
  const anchors = clusters.filter((c) => c.count >= minLines).map((c) => c.left);
  if (!anchors.length) return [xs[0]];

  const gutter = COLUMN_GAP_RATIO * (pageWidth || 600);
  const edges = [anchors[0]];
  for (const x of anchors) if (x - edges[edges.length - 1] > gutter) edges.push(x);
  return edges;
}
