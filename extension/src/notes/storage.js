// Per-document notes persist in chrome.storage.local (larger, device-local, unlike synced settings).
const PREFIX = 'dr-notes:';
const POSITION_PREFIX = 'dr-pos:';
const DOC_PREFIX = 'dr-doc:';

// Run fn with chrome.storage.local, swallowing absence/errors and returning fallback.
async function withLocal(fn, fallback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return fallback;
  try {
    return await fn(chrome.storage.local);
  } catch {
    return fallback;
  }
}

export function positionKey(href) {
  return POSITION_PREFIX + String(href || '').split('#')[0];
}

export function loadPosition(href) {
  return withLocal(async (local) => {
    const key = positionKey(href);
    const stored = await local.get(key);
    return Number(stored[key]) || 0;
  }, 0);
}

export function savePosition(href, index) {
  return withLocal((local) => local.set({ [positionKey(href)]: Math.max(0, Math.floor(index) || 0) }));
}

export function notesKey(href) {
  return PREFIX + String(href || '').split('#')[0];
}

export function saveDocEntry(id, { title, type } = {}) {
  if (!id) return Promise.resolve();
  return withLocal((local) =>
    local.set({ [DOC_PREFIX + id]: JSON.stringify({ title: title || '', type: type || 'docs', at: Date.now() }) })
  );
}

function urlFromNotesHref(href) {
  try {
    return new URL(href).searchParams.get('url');
  } catch {
    return null;
  }
}

export function listDocEntries() {
  return withLocal(async (local) => {
    const store = await local.get(null);

    const notesByUrl = new Map();
    for (const [key, value] of Object.entries(store)) {
      if (!key.startsWith(PREFIX)) continue;
      const url = urlFromNotesHref(key.slice(PREFIX.length));
      if (!url) continue;
      let cards = 0;
      let title = '';
      try {
        const model = JSON.parse(value);
        if (Array.isArray(model?.cards)) cards = model.cards.length;
        if (typeof model?.title === 'string') title = model.title;
      } catch {
        void 0;
      }
      notesByUrl.set(url, { cards, title });
    }

    const entries = [];
    for (const [key, value] of Object.entries(store)) {
      if (!key.startsWith(DOC_PREFIX)) continue;
      const id = key.slice(DOC_PREFIX.length);
      let meta = {};
      try {
        meta = JSON.parse(value) || {};
      } catch {
        void 0;
      }
      const note = notesByUrl.get(id);
      entries.push({
        id,
        title: meta.title || note?.title || id,
        type: meta.type || 'docs',
        at: meta.at || 0,
        notes: note?.cards || 0,
        inProgress: (Number(store[POSITION_PREFIX + id]) || 0) > 0,
      });
    }
    return entries.sort((a, b) => b.at - a.at);
  }, []);
}

export function deleteDocEntry(id) {
  return withLocal(async (local) => {
    const store = await local.get(null);
    const keys = [DOC_PREFIX + id, POSITION_PREFIX + id];
    for (const key of Object.keys(store)) {
      if (key.startsWith(PREFIX) && urlFromNotesHref(key.slice(PREFIX.length)) === id) keys.push(key);
    }
    await local.remove(keys);
  });
}

export function loadNotes(key) {
  return withLocal(async (local) => {
    const stored = await local.get(key);
    return stored[key] || '';
  }, '');
}

export function saveNotes(key, html) {
  return withLocal((local) => local.set({ [key]: html }));
}

export function hrefFromKey(key) {
  return typeof key === 'string' && key.startsWith(PREFIX) ? key.slice(PREFIX.length) : null;
}

export function noteEntriesFromStore(store) {
  const entries = [];
  for (const [key, value] of Object.entries(store || {})) {
    const href = hrefFromKey(key);
    if (href == null) continue;
    let cards = 0;
    let title = '';
    try {
      const model = JSON.parse(value);
      if (Array.isArray(model?.cards)) cards = model.cards.length;
      if (typeof model?.title === 'string') title = model.title;
    } catch {
      void 0;
    }
    entries.push({ key, href, title, cards, bytes: key.length + String(value ?? '').length });
  }
  return entries.sort((a, b) => a.href.localeCompare(b.href));
}

export function listNoteEntries() {
  return withLocal(async (local) => noteEntriesFromStore(await local.get(null)), []);
}

export function deleteNotes(key) {
  return withLocal((local) => {
    const href = hrefFromKey(key);
    const id = href != null ? urlFromNotesHref(href) || href : null;
    return local.remove(id != null ? [key, positionKey(id)] : [key]);
  });
}

function pageIdOfNotesHref(href) {
  return urlFromNotesHref(href) || href;
}

export function listStoredPages() {
  return withLocal(async (local) => {
    const store = await local.get(null);
    const pages = new Map();
    const ensure = (id) => {
      if (!pages.has(id)) pages.set(id, { id, href: id, title: '', cards: 0, hasPosition: false, bytes: 0 });
      return pages.get(id);
    };
    for (const [key, value] of Object.entries(store)) {
      const size = key.length + String(value ?? '').length;
      if (key.startsWith(PREFIX)) {
        const href = key.slice(PREFIX.length);
        const page = ensure(pageIdOfNotesHref(href));
        page.href = href;
        page.bytes += size;
        try {
          const model = JSON.parse(value);
          if (Array.isArray(model?.cards)) page.cards = model.cards.length;
          if (typeof model?.title === 'string' && model.title) page.title = model.title;
        } catch {
          void 0;
        }
      } else if (key.startsWith(POSITION_PREFIX)) {
        const page = ensure(key.slice(POSITION_PREFIX.length));
        page.bytes += size;
        page.hasPosition = true;
      } else if (key.startsWith(DOC_PREFIX)) {
        const page = ensure(key.slice(DOC_PREFIX.length));
        page.bytes += size;
        try {
          const meta = JSON.parse(value);
          if (!page.title && typeof meta?.title === 'string') page.title = meta.title;
        } catch {
          void 0;
        }
      }
    }
    return [...pages.values()].sort((a, b) => (a.title || a.href).localeCompare(b.title || b.href));
  }, []);
}

export function deleteStoredPage(id) {
  return withLocal(async (local) => {
    const store = await local.get(null);
    const keys = [POSITION_PREFIX + id, DOC_PREFIX + id];
    for (const key of Object.keys(store)) {
      if (key.startsWith(PREFIX) && pageIdOfNotesHref(key.slice(PREFIX.length)) === id) keys.push(key);
    }
    await local.remove(keys);
  });
}

export function clearAllNotes() {
  return withLocal(async (local) => {
    const keys = Object.keys(await local.get(null)).filter(
      (k) => k.startsWith(PREFIX) || k.startsWith(POSITION_PREFIX) || k.startsWith(DOC_PREFIX)
    );
    if (keys.length) await local.remove(keys);
  });
}
