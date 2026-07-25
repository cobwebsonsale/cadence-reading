import { fetchDoc } from './api/docs.js';
import { fetchComments, fetchDocText, fetchFileName } from './api/drive.js';
import { fetchPdfBytes } from './api/pdf.js';
import { parseDocRef, stripGoogleSuffix } from './gdocs.js';
import { DOC_PREFIX } from './notes/storage.js';

function getToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || 'No token granted'));
        return;
      }
      resolve(token);
    });
  });
}

function invalidateToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

async function withToken(fn) {
  let token = await getToken(true);
  try {
    return await fn(token);
  } catch (error) {
    if (error && error.status === 401) {
      await invalidateToken(token);
      token = await getToken(true);
      return await fn(token);
    }
    throw error;
  }
}

const handlers = {
  async fetchDoc({ docId }) {
    return withToken((token) => fetchDoc(docId, token));
  },
  async fetchComments({ docId, includeResolved }) {
    return withToken((token) => fetchComments(docId, token, { includeResolved }));
  },
  async fetchDocText({ docId }) {
    return withToken((token) => fetchDocText(docId, token));
  },
  async fetchPdfBytes({ fileId }) {
    return withToken((token) => fetchPdfBytes(fileId, token));
  },
  async fetchFileName({ fileId }) {
    return withToken((token) => fetchFileName(fileId, token));
  },
  async getAuthToken() {
    return getToken(true);
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler(msg)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: serializeError(error) }));
  return true;
});

function serializeError(error) {
  return {
    message: error?.message || String(error),
    status: error?.status,
  };
}

async function fileIsGranted(fileId) {
  if (!fileId) return false;
  const store = await chrome.storage.local.get(null);
  const needle = `/d/${fileId}`;
  return Object.keys(store).some((key) => key.startsWith(DOC_PREFIX) && key.includes(needle));
}

async function openReaderForActiveTab(tab) {
  const reader = chrome.runtime.getURL('reader/reader.html');
  const ref = parseDocRef(tab?.url || '');

  if (ref && (await fileIsGranted(ref.fileId))) {
    await chrome.tabs.create({ url: `${reader}?url=${encodeURIComponent(tab.url)}` });
    return;
  }

  const params = new URLSearchParams();
  if (ref) {
    const title = stripGoogleSuffix(tab?.title || '');
    if (title) params.set('q', title);
    if (ref.tabId) params.set('tab', ref.tabId);
  }
  const query = params.toString();
  await chrome.tabs.create({ url: query ? `${reader}?${query}` : reader });
}

chrome.action.onClicked.addListener((tab) => openReaderForActiveTab(tab));

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'start-session') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  openReaderForActiveTab(tab);
});
