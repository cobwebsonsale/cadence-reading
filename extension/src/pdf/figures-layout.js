const FIGURE_MIN_SIZE = 40;
const CAPTION_ABOVE_TOL = 4;

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
      const maxY = Math.max(...seg.map((l) => l.y));
      const minY = Math.min(...seg.map((l) => l.y));
      const spans = region.yBottom <= maxY + 2 && region.yTop >= minY - 2;
      if (inColumn && spans) {
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
