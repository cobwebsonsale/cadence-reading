import * as pdfjs from '../../vendor/pdfjs/pdf.mjs';
import { imageRegionsFromOps, vectorRegionsFromOps } from './extract.js';

// Rasterize above 1:1 so crops stay crisp when scaled up to reader size on HiDPI.
const RENDER_SCALE = 4;

const OP_CODES = {
  save: pdfjs.OPS.save,
  restore: pdfjs.OPS.restore,
  transform: pdfjs.OPS.transform,
  imagePaint: new Set(
    [
      pdfjs.OPS.paintImageXObject,
      pdfjs.OPS.paintImageXObjectRepeat,
      pdfjs.OPS.paintInlineImageXObject,
      pdfjs.OPS.paintImageMaskXObject,
    ].filter((code) => code !== undefined)
  ),
};

const VECTOR_OP_CODES = {
  save: pdfjs.OPS.save,
  restore: pdfjs.OPS.restore,
  transform: pdfjs.OPS.transform,
  constructPath: pdfjs.OPS.constructPath,
  endPath: pdfjs.OPS.endPath,
  paint: new Set(
    [
      pdfjs.OPS.fill,
      pdfjs.OPS.eoFill,
      pdfjs.OPS.stroke,
      pdfjs.OPS.closeStroke,
      pdfjs.OPS.fillStroke,
      pdfjs.OPS.eoFillStroke,
      pdfjs.OPS.closeFillStroke,
      pdfjs.OPS.closeEOFillStroke,
      pdfjs.OPS.shadingFill,
    ].filter((code) => code !== undefined)
  ),
};

// Injected into extractBlocks: sizable image bounding boxes for one page.
export function extractRegions(operatorList) {
  return imageRegionsFromOps(operatorList.fnArray, operatorList.argsArray, OP_CODES);
}

// Injected into extractBlocks: bounding boxes of vector-drawn figures/tables for one page.
export function extractVectorRegions(operatorList, view) {
  return vectorRegionsFromOps(operatorList.fnArray, operatorList.argsArray, VECTOR_OP_CODES, view);
}

// Renders a page on first use (caching a few), cropping bboxes only as the reader reaches them.
const PAGE_CACHE_LIMIT = 3;

export function createRasterizer(pdf) {
  const cache = new Map(); // pageNum -> Promise<{ canvas, viewport }>

  function renderPage(pageNum) {
    if (cache.has(pageNum)) return cache.get(pageNum);
    const promise = (async () => {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      page.cleanup();
      return { canvas, viewport };
    })();
    cache.set(pageNum, promise);
    while (cache.size > PAGE_CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return promise;
  }

  return {
    async crop(pageNum, bbox) {
      try {
        const { canvas, viewport } = await renderPage(pageNum);
        let url = null;
        cropRegion(canvas, viewport, bbox, (dataURL) => {
          url = dataURL;
        });
        return url;
      } catch {
        return null;
      }
    },
  };
}

function cropRegion(canvas, viewport, bbox, assign) {
  const { x0, x1, y0, y1 } = bbox;
  const a = viewport.convertToViewportPoint(x0, y1);
  const b = viewport.convertToViewportPoint(x1, y0);
  const left = Math.max(0, Math.min(a[0], b[0]));
  const top = Math.max(0, Math.min(a[1], b[1]));
  const width = Math.min(canvas.width - left, Math.abs(b[0] - a[0]));
  const height = Math.min(canvas.height - top, Math.abs(b[1] - a[1]));
  if (width < 1 || height < 1) return;

  const crop = document.createElement('canvas');
  crop.width = Math.round(width);
  crop.height = Math.round(height);
  crop.getContext('2d').drawImage(canvas, left, top, width, height, 0, 0, crop.width, crop.height);
  assign(crop.toDataURL('image/png'), x1 - x0, y1 - y0);
}
