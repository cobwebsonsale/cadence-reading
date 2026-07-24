const FIGURE_MIN_SIZE = 40;
const CAPTION_ABOVE_TOL = 4;
const VECTOR_MIN_SIZE = 40;
const VECTOR_MIN_MARKS = 6;
const VECTOR_CLUSTER_GAP = 12;
const VECTOR_MAX_PAGE_FRACTION = 0.9;
const RULE_THIN = 2;
const RULE_LONG = 72;

// Pair each caption with the nearest image region directly above it, sharing horizontal span.
export function matchFigures(regions, captions) {
  const used = new Set();
  const matches = [];
  for (const caption of captions) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < regions.length; i++) {
      if (used.has(i)) continue;
      const region = regions[i];
      const overlap = Math.min(region.x1, caption.x1) - Math.max(region.x0, caption.x0);
      if (overlap <= 0) continue;
      if (region.y0 < caption.y - CAPTION_ABOVE_TOL) continue;
      const dist = region.y0 - caption.y;
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    if (best >= 0) {
      used.add(best);
      matches.push({ region: regions[best], num: caption.num });
    }
  }
  return matches;
}

// CTM-tracked image-paint bounding boxes in PDF user space; `ops` are the op codes.
export function imageRegionsFromOps(fnArray, argsArray, ops) {
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const regions = [];
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    if (fn === ops.save) {
      stack.push(ctm.slice());
    } else if (fn === ops.restore) {
      ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    } else if (fn === ops.transform) {
      ctm = multiplyMatrix(ctm, argsArray[i]);
    } else if (ops.imagePaint.has(fn)) {
      const corners = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      if (x1 - x0 >= FIGURE_MIN_SIZE && y1 - y0 >= FIGURE_MIN_SIZE) {
        regions.push({ x0, x1, y0, y1 });
      }
    }
  }
  return regions;
}

// Vector-drawn figures/tables leave no image-paint op; cluster their fill/stroke marks
// (excluding long thin rules) into snapshot regions in PDF user space.
export function vectorRegionsFromOps(fnArray, argsArray, ops, view) {
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let pending = null;
  const marks = [];
  const extend = (minMax) => {
    if (!minMax) return;
    const [mnx, mny, mxx, mxy] = minMax;
    const xs = [];
    const ys = [];
    for (const [px, py] of [
      [mnx, mny],
      [mxx, mny],
      [mxx, mxy],
      [mnx, mxy],
    ]) {
      xs.push(ctm[0] * px + ctm[2] * py + ctm[4]);
      ys.push(ctm[1] * px + ctm[3] * py + ctm[5]);
    }
    const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    pending = pending ? unionBox(pending, box) : box;
  };

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    if (fn === ops.save) {
      stack.push(ctm.slice());
    } else if (fn === ops.restore) {
      ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    } else if (fn === ops.transform) {
      ctm = multiplyMatrix(ctm, argsArray[i]);
    } else if (fn === ops.constructPath) {
      extend(argsArray[i]?.[2]);
    } else if (ops.paint.has(fn)) {
      if (pending) marks.push(pending);
      pending = null;
    } else if (fn === ops.endPath) {
      pending = null;
    }
  }

  const solid = marks.filter((m) => {
    const w = m.x1 - m.x0;
    const h = m.y1 - m.y0;
    return !(Math.min(w, h) < RULE_THIN && Math.max(w, h) > RULE_LONG);
  });
  const pageArea = view ? (view[2] - view[0]) * (view[3] - view[1]) : Infinity;
  return clusterBoxes(solid, VECTOR_CLUSTER_GAP)
    .filter((c) => {
      const w = c.x1 - c.x0;
      const h = c.y1 - c.y0;
      return (
        w >= VECTOR_MIN_SIZE &&
        h >= VECTOR_MIN_SIZE &&
        c.count >= VECTOR_MIN_MARKS &&
        w * h < VECTOR_MAX_PAGE_FRACTION * pageArea
      );
    })
    .map((c) => ({ bbox: { x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1 }, yTop: c.y1, yBottom: c.y0 }));
}

function unionBox(a, b) {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

function clusterBoxes(boxes, gap) {
  const parent = boxes.map((_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const near = (a, b) =>
    a.x0 - gap <= b.x1 && b.x0 - gap <= a.x1 && a.y0 - gap <= b.y1 && b.y0 - gap <= a.y1;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (near(boxes[i], boxes[j])) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < boxes.length; i++) {
    const root = find(i);
    const g = groups.get(root);
    if (g) {
      g.x0 = Math.min(g.x0, boxes[i].x0);
      g.y0 = Math.min(g.y0, boxes[i].y0);
      g.x1 = Math.max(g.x1, boxes[i].x1);
      g.y1 = Math.max(g.y1, boxes[i].y1);
      g.count++;
    } else {
      groups.set(root, { x0: boxes[i].x0, y0: boxes[i].y0, x1: boxes[i].x1, y1: boxes[i].y1, count: 1 });
    }
  }
  return [...groups.values()];
}

function multiplyMatrix(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

// Drop each image region into the gap its removed lines left in the column flow.
export function placeImageSegments(pageSegs, regions) {
  let segs = pageSegs;
  for (const region of regions) {
    const img = { tableImage: { page: region.page, bbox: region.bbox } };
    const cx = (region.bbox.x0 + region.bbox.x1) / 2;
    const midY = (region.yTop + region.yBottom) / 2;
    const next = [];
    let placed = false;
    for (const seg of segs) {
      if (placed || seg.tableImage || seg.isFullWidth || !Array.isArray(seg) || !seg.length) {
        next.push(seg);
        continue;
      }
      const inColumn = seg.some((l) => l.x0 <= cx && cx <= (l.endX ?? l.x0));
      const minY = Math.min(...seg.map((l) => l.y));
      const reachesInto = region.yBottom >= minY - 2;
      if (inColumn && reachesInto) {
        const above = seg.filter((l) => l.y > midY);
        const below = seg.filter((l) => l.y <= midY);
        if (above.length) next.push(above);
        next.push(img);
        if (below.length) next.push(below);
        placed = true;
      } else {
        next.push(seg);
      }
    }
    if (!placed) next.push(img);
    segs = next;
  }
  return segs;
}
