import { fetchDoc, fetchComments, fetchDocText, fetchPdfBytes } from './rpc.js';
import { bytesFromBase64 } from './bytes.js';

export function detectSource(href) {
  let match = href.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return docsSource(match[1]);

  match = href.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return pdfSource(match[1]);

  return null;
}

function docsSource(docId) {
  return {
    type: 'docs',
    async prepare(session) {
      const [{ buildDocument, reconcileChips }, { anchorComments }] = await Promise.all([
        import('./render/builder.js'),
        import('./render/comments.js'),
      ]);

      const [doc, rawComments, exportText] = await Promise.all([
        fetchDoc(docId),
        fetchComments(docId, session.settings.showResolvedComments).catch((error) => {
          console.warn('[cadence] comments fetch failed:', error);
          return [];
        }),
        fetchDocText(docId).catch(() => ''),
      ]);

      session.docTitle = doc.title || '';

      buildDocument(doc, {
        mount: session.overlay.content,
        settings: session.settings,
      });
      reconcileChips(session.overlay.content, exportText);

      return anchorComments(session.overlay.content, rawComments);
    },
  };
}

function pdfSource(fileId) {
  return {
    type: 'pdf',
    async prepare(session) {
      session.overlay.hud.setStatus('Downloading PDF…');
      const base64 = await fetchPdfBytes(fileId);
      await loadExtractBuild(session, bytesFromBase64(base64));
      return new Map();
    },
  };
}

export function localPdfSource(bytes, name) {
  return {
    type: 'pdf-local',
    name,
    async prepare(session) {
      session.docTitle = name || '';
      await loadExtractBuild(session, bytes);
      return new Map();
    },
  };
}

async function loadExtractBuild(session, bytes) {
  const hud = session.overlay.hud;
  const [
    { loadPdf },
    { extractBlocks },
    { buildBlock },
    { extractRegions, createRasterizer },
    { buildEncodingMap },
  ] = await Promise.all([
    import('./pdf/loader.js'),
    import('./pdf/extract.js'),
    import('./pdf/pdf-builder.js'),
    import('./pdf/figures.js'),
    import('./pdf/encodings.js'),
  ]);

  hud.setStatus('Parsing PDF…');
  const pdf = await loadPdf(bytes);
  const glyphMap = await buildEncodingMap(bytes);

  const { blocks, hasText } = await extractBlocks(
    pdf,
    (done, total) => hud.setStatus(`Extracting text ${done}/${total}…`),
    extractRegions,
    glyphMap
  );

  if (!hasText) {
    throw new Error('No text layer found — this looks like a scanned PDF.');
  }

  // Build the DOM lazily and rasterize each page's figures only as its block is built.
  const rasterizer = createRasterizer(pdf);
  if (session.settings.fontFamily) {
    session.overlay.content.style.fontFamily = session.settings.fontFamily;
  }
  session.setupLazyBuild({
    blocks,
    buildBlock: (block, index) => buildBlock(block, index, rasterizer),
  });
}
