import { safeText } from './http.js';

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';

export async function fetchFileName(fileId, token) {
  const url = `${DRIVE_FILES}/${encodeURIComponent(fileId)}?fields=name&supportsAllDrives=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const error = new Error(`Drive files.get ${res.status}: ${await safeText(res)}`);
    error.status = res.status;
    throw error;
  }
  return (await res.json()).name || '';
}

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

