import * as pdfjs from '../../vendor/pdfjs/pdf.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.mjs');

export async function loadPdf(bytes) {
  return pdfjs.getDocument({ data: bytes }).promise;
}
