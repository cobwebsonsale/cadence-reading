import { safeText } from './http.js';

const DOCS_ENDPOINT = 'https://docs.googleapis.com/v1/documents';

export async function fetchDoc(docId, token) {
  const url =
    `${DOCS_ENDPOINT}/${encodeURIComponent(docId)}` +
    `?suggestionsViewMode=PREVIEW_WITHOUT_SUGGESTIONS` +
    `&includeTabsContent=true`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (!res.ok) {
    const error = new Error(`Docs API ${res.status}: ${await safeText(res)}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}
