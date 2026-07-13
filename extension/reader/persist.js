import { base64FromBytes, bytesFromBase64 } from '../src/bytes.js';

const KEY_BYTES = 'dr-pdf-bytes';
const KEY_NAME = 'dr-pdf-name';

export function saveDoc({ name, bytes }) {
  try {
    sessionStorage.setItem(KEY_BYTES, base64FromBytes(bytes));
    sessionStorage.setItem(KEY_NAME, name || '');
    return true;
  } catch {
    clearDoc();
    return false;
  }
}

export function loadDoc() {
  const base64 = sessionStorage.getItem(KEY_BYTES);
  if (!base64) return null;
  try {
    return { name: sessionStorage.getItem(KEY_NAME) || '', bytes: bytesFromBase64(base64) };
  } catch {
    return null;
  }
}

export function clearDoc() {
  sessionStorage.removeItem(KEY_BYTES);
  sessionStorage.removeItem(KEY_NAME);
}
