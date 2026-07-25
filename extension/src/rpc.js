export function call(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error('No response from background worker'));
        return;
      }
      if (!response.ok) {
        const error = new Error(response.error?.message || 'RPC failed');
        error.status = response.error?.status;
        reject(error);
        return;
      }
      resolve(response.data);
    });
  });
}

export const fetchDoc = (docId) => call({ type: 'fetchDoc', docId });

export const fetchComments = (docId, includeResolved) =>
  call({ type: 'fetchComments', docId, includeResolved });

export const fetchDocText = (docId) => call({ type: 'fetchDocText', docId });

export const fetchPdfBytes = (fileId) => call({ type: 'fetchPdfBytes', fileId });

export const getAuthToken = () => call({ type: 'getAuthToken' });
