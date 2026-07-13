import { fetchDoc } from './api/docs.js';
import { fetchComments, fetchDocText, listFiles } from './api/drive.js';
import { fetchPdfBytes } from './api/pdf.js';

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
  async listDriveFiles({ query }) {
    return withToken((token) => listFiles(query, token));
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

async function startSessionInActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  const supported =
    /^https:\/\/docs\.google\.com\/document\//.test(url) ||
    /^https:\/\/drive\.google\.com\/file\//.test(url);

  // Always read in a dedicated reader tab, passing the doc URL so a reload re-opens it.
  const reader = chrome.runtime.getURL('reader/reader.html');
  await chrome.tabs.create({ url: supported ? `${reader}?url=${encodeURIComponent(url)}` : reader });
}

chrome.action.onClicked.addListener(startSessionInActiveTab);

chrome.commands.onCommand.addListener((command) => {
  if (command === 'start-session') startSessionInActiveTab();
});
