import { getAuthToken } from '../src/rpc.js';

const PICKER_ORIGIN = 'https://picker.bharatmunshi.cc';

// Opens the hosted Google Picker in a popup and resolves the chosen file, or null on
// cancel/close. Call this synchronously from a user gesture — the popup must open before
// the (async) token fetch, or the browser blocks it.
export function openPicker({ query } = {}) {
  const popup = window.open(PICKER_ORIGIN, 'cadence-picker', 'width=1000,height=680');
  if (!popup) {
    return Promise.reject(new Error('Popup blocked — allow popups to open the Google Picker.'));
  }
  const tokenPromise = getAuthToken();

  return new Promise((resolve, reject) => {
    let done = false;
    const settle = (fn, value) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      clearInterval(closedTimer);
      fn(value);
    };

    const onMessage = (event) => {
      if (event.origin !== PICKER_ORIGIN || event.source !== popup) return;
      const data = event.data || {};
      if (data.type === 'picker-ready') {
        tokenPromise
          .then((token) => {
            if (!done) popup.postMessage({ type: 'picker-init', token, query: query || '' }, PICKER_ORIGIN);
          })
          .catch((error) => {
            try {
              popup.close();
            } catch {
              void 0;
            }
            settle(reject, error);
          });
      } else if (data.type === 'picker-pick') {
        settle(resolve, { fileId: data.fileId, mimeType: data.mimeType, name: data.name });
        try {
          popup.close();
        } catch {
          void 0;
        }
      } else if (data.type === 'picker-cancel') {
        settle(resolve, null);
      }
    };

    const closedTimer = setInterval(() => {
      if (popup.closed) settle(resolve, null);
    }, 500);
    window.addEventListener('message', onMessage);
  });
}
