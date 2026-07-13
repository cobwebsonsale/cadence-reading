import { safeText } from './http.js';

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';

const COMMENT_FIELDS =
  'comments(id,content,htmlContent,author(displayName,photoLink),' +
  'createdTime,resolved,anchor,quotedFileContent(value),' +
  'replies(content,htmlContent,author(displayName,photoLink),createdTime)),' +
  'nextPageToken';

// Plain-text export; it renders chip values the Docs API omits, used to fill those gaps.
export async function fetchDocText(docId, token) {
  const url = `${DRIVE_FILES}/${encodeURIComponent(docId)}/export?mimeType=text/plain`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const error = new Error(`Drive export ${res.status}: ${await safeText(res)}`);
    error.status = res.status;
    throw error;
  }
  return res.text();
}

export async function fetchComments(docId, token, opts = {}) {
  const { includeResolved = false } = opts;
  const comments = [];
  let pageToken = '';

  do {
    const url = new URL(`${DRIVE_FILES}/${encodeURIComponent(docId)}/comments`);
    url.searchParams.set('fields', COMMENT_FIELDS);
    url.searchParams.set('includeDeleted', 'false');
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const error = new Error(`Drive API ${res.status}: ${await safeText(res)}`);
      error.status = res.status;
      throw error;
    }

    const page = await res.json();
    for (const comment of page.comments || []) {
      if (!includeResolved && comment.resolved) continue;
      comments.push(comment);
    }
    pageToken = page.nextPageToken || '';
  } while (pageToken);

  return comments;
}

export const DRIVE_DOC_MIME = 'application/vnd.google-apps.document';
export const DRIVE_PDF_MIME = 'application/pdf';

async function driveList(q, token, params = {}) {
  const url = new URL(DRIVE_FILES);
  url.searchParams.set('q', q);
  url.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime)');
  url.searchParams.set('orderBy', 'modifiedTime desc');
  url.searchParams.set('pageSize', '100');
  url.searchParams.set('supportsAllDrives', 'true');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const error = new Error(`Drive list ${res.status}: ${await safeText(res)}`);
    error.status = res.status;
    throw error;
  }
  return (await res.json()).files || [];
}

export async function listFiles(query, token) {
  const mime = `(mimeType='${DRIVE_DOC_MIME}' or mimeType='${DRIVE_PDF_MIME}')`;
  const term = (query || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").trim();
  const base = `${mime} and trashed=false${term ? ` and name contains '${term}'` : ''}`;

  const [owned, shared] = await Promise.all([
    driveList(base, token, { corpora: 'allDrives', includeItemsFromAllDrives: 'true' }),
    driveList(`${base} and sharedWithMe=true`, token),
  ]);

  const byId = new Map();
  for (const file of [...owned, ...shared]) byId.set(file.id, file);
  return [...byId.values()]
    .sort((a, b) => String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || '')))
    .slice(0, 50);
}

