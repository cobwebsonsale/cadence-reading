import { fetchDoc, fetchComments, fetchDocText, fetchPdfBytes, fetchFileName } from './rpc.js';
import { bytesFromBase64 } from './bytes.js';
import { parseDocRef } from './gdocs.js';
import { listTabs, resolveTabId, tabTitle } from './render/tabs-model.js';

export function detectSource(href) {
  const ref = parseDocRef(href);
  if (!ref) return null;
  return ref.kind === 'doc' ? docsSource(ref.fileId, ref.tabId) : pdfSource(ref.fileId);
}

function composeDocTitle(doc, tabs, tabId) {
  const docTitle = doc.title || '';
  const name = tabTitle(doc, tabId);
  return tabs.length > 1 && name ? `${docTitle} — ${name}` : docTitle;
}

function docsSource(docId, requestedTabId) {
  return {
    type: 'docs',
    async prepare(session) {
      const [{ buildDocument, reconcileChips }, { anchorComments }] = await Promise.all([
        import('./render/builder.js'),
        import('./render/comments.js'),
      ]);

      const [doc, rawComments, exportText] = await Promise.all([
        fetchDoc(docId),
        fetchComments(docId, false).catch((error) => {
          console.warn('[cadence] comments fetch failed:', error);
          return [];
        }),
        fetchDocText(docId).catch(() => ''),
      ]);

      session.doc = doc;
      session.tabs = listTabs(doc);
      session.tabId = resolveTabId(doc, requestedTabId);
      session.docTitle = composeDocTitle(doc, session.tabs, session.tabId);

      buildDocument(doc, {
        mount: session.overlay.content,
        settings: session.settings,
        tabId: session.tabId,
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
      const [base64, name] = await Promise.all([
        fetchPdfBytes(fileId),
        fetchFileName(fileId).catch(() => ''),
      ]);
      session.docTitle = name || '';
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
    { extractRegions, extractVectorRegions, createRasterizer },
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
    glyphMap,
    extractVectorRegions
  );

  if (!hasText) {
    throw new Error('No text layer found — this looks like a scanned PDF.');
  }

  // Build the DOM lazily and rasterize each page's figures only as its block is built.
  const rasterizer = createRasterizer(pdf);
  session.setupLazyBuild({
    blocks,
    buildBlock: (block, index) => buildBlock(block, index, rasterizer),
  });
}
