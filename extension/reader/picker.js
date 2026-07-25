import { getAuthToken } from '../src/rpc.js';

const PICKER_ORIGIN = 'https://picker.bharatmunshi.cc';

export function openPicker({ query } = {}) {
  const width = 1000;
  const height = 680;
  const left = Math.max(0, Math.round((window.screen.width - width) / 2));
  const top = Math.max(0, Math.round((window.screen.height - height) / 2));
  const features = `popup=yes,width=${width},height=${height},left=${left},top=${top}`;
  const popup = window.open(PICKER_ORIGIN, 'cadence-picker', features);
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
