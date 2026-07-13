import { base64FromBytes } from '../bytes.js';
import { safeText } from './http.js';

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';

export async function fetchPdfBytes(fileId, token) {
  const url = `${DRIVE_FILES}/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const error = new Error(`Drive media ${res.status}: ${await safeText(res)}`);
    error.status = res.status;
    throw error;
  }
  return base64FromBytes(new Uint8Array(await res.arrayBuffer()));
}
