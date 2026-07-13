(() => {
  if (window.__docReaderBootstrapped) return;
  window.__docReaderBootstrapped = true;

  let sessionModule = null;
  let starting = false;

  async function loadSession() {
    if (sessionModule) return sessionModule;
    sessionModule = await import(chrome.runtime.getURL('src/session.js'));
    return sessionModule;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'startSession') return false;
    if (starting) {
      sendResponse({ ok: true, already: true });
      return false;
    }
    starting = true;
    loadSession()
      .then((module) => module.startSession())
      .catch((error) => console.error('[cadence] failed to start session:', error))
      .finally(() => {
        starting = false;
      });
    sendResponse({ ok: true });
    return false;
  });
})();
