export const DRIVE_DOC_MIME = 'application/vnd.google-apps.document';
export const DRIVE_PDF_MIME = 'application/pdf';

function queryParam(href, key) {
  try {
    return new URL(href).searchParams.get(key) || null;
  } catch {
    return null;
  }
}

export function parseDocRef(href) {
  const s = String(href || '');
  let match = s.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return { kind: 'doc', fileId: match[1], tabId: queryParam(s, 'tab') };
  match = s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return { kind: 'pdf', fileId: match[1], tabId: null };
  return null;
}

export function synthesizeUrl(fileId, mimeType, tabId) {
  if (mimeType === DRIVE_PDF_MIME) return `https://drive.google.com/file/d/${fileId}/view`;
  const base = `https://docs.google.com/document/d/${fileId}/edit`;
  return tabId ? `${base}?tab=${encodeURIComponent(tabId)}` : base;
}

export function stripGoogleSuffix(title) {
  return String(title || '')
    .replace(/\s*[-–—]\s*Google (?:Docs|Sheets|Slides|Drive)\s*$/i, '')
    .trim();
}
