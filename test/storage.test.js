import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  saveDocEntry,
  listDocEntries,
  deleteDocEntry,
  deleteNotes,
  clearAllNotes,
  listStoredPages,
  deleteStoredPage,
} from '../extension/src/notes/storage.js';

function withStore(store, fn) {
  globalThis.chrome = {
    storage: {
      local: {
        get: async (k) => (k === null ? { ...store } : { [k]: store[k] }),
        set: async (obj) => Object.assign(store, obj),
        remove: async (keys) => [].concat(keys).forEach((k) => delete store[k]),
      },
    },
  };
  return Promise.resolve(fn()).finally(() => delete globalThis.chrome);
}

const readerNotesKey = (url) =>
  `dr-notes:chrome-extension://ext/reader/reader.html?url=${encodeURIComponent(url)}`;
const DOC = 'https://docs.google.com/document/d/abc/edit';

test('saveDocEntry records a document that listDocEntries returns', async () => {
  const store = {};
  await withStore(store, async () => {
    await saveDocEntry(DOC, { title: 'My Doc', type: 'docs' });
    const entries = await listDocEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, DOC);
    assert.equal(entries[0].title, 'My Doc');
    assert.equal(entries[0].type, 'docs');
    assert.equal(entries[0].inProgress, false);
    assert.equal(entries[0].notes, 0);
  });
});

test('listDocEntries joins in-progress position and note count', async () => {
  const store = {};
  await withStore(store, async () => {
    await saveDocEntry(DOC, { title: 'Doc', type: 'docs' });
    store[`dr-pos:${DOC}`] = 42;
    store[readerNotesKey(DOC)] = JSON.stringify({ title: 'Doc', cards: [{}, {}] });
    const [entry] = await listDocEntries();
    assert.equal(entry.inProgress, true);
    assert.equal(entry.notes, 2);
  });
});

test('listDocEntries falls back to the notes title when no doc title was stored', async () => {
  const store = {};
  await withStore(store, async () => {
    await saveDocEntry(DOC, { type: 'docs' }); // no title
    store[readerNotesKey(DOC)] = JSON.stringify({ title: 'Titled by notes', cards: [] });
    const [entry] = await listDocEntries();
    assert.equal(entry.title, 'Titled by notes');
  });
});

test('listDocEntries sorts most-recent first', async () => {
  const store = {
    'dr-doc:a': JSON.stringify({ title: 'A', type: 'docs', at: 100 }),
    'dr-doc:b': JSON.stringify({ title: 'B', type: 'docs', at: 300 }),
    'dr-doc:c': JSON.stringify({ title: 'C', type: 'docs', at: 200 }),
  };
  await withStore(store, async () => {
    const ids = (await listDocEntries()).map((e) => e.id);
    assert.deepEqual(ids, ['b', 'c', 'a']);
  });
});

test('deleteDocEntry removes the entry, its position, and its notes', async () => {
  const store = {};
  await withStore(store, async () => {
    await saveDocEntry(DOC, { title: 'Doc', type: 'docs' });
    store[`dr-pos:${DOC}`] = 42;
    store[readerNotesKey(DOC)] = JSON.stringify({ cards: [{}] });
    await deleteDocEntry(DOC);
    assert.equal((await listDocEntries()).length, 0);
    assert.equal(store[`dr-pos:${DOC}`], undefined);
    assert.equal(store[readerNotesKey(DOC)], undefined);
  });
});

test('deleteNotes removes the position keyed by the doc url, not the reader href', async () => {
  const store = {};
  await withStore(store, async () => {
    store[readerNotesKey(DOC)] = JSON.stringify({ cards: [{}] });
    store[`dr-pos:${DOC}`] = 42;
    await deleteNotes(readerNotesKey(DOC));
    assert.equal(store[readerNotesKey(DOC)], undefined);
    assert.equal(store[`dr-pos:${DOC}`], undefined);
  });
});

test('listStoredPages lists a page that has only a saved position', async () => {
  const store = { [`dr-pos:${DOC}`]: 500 };
  await withStore(store, async () => {
    const pages = await listStoredPages();
    assert.equal(pages.length, 1);
    assert.equal(pages[0].id, DOC);
    assert.equal(pages[0].hasPosition, true);
    assert.equal(pages[0].cards, 0);
  });
});

test('listStoredPages merges notes, position, and doc entry into one page', async () => {
  const store = {
    [readerNotesKey(DOC)]: JSON.stringify({ title: 'Doc', cards: [{}, {}] }),
    [`dr-pos:${DOC}`]: 12,
    [`dr-doc:${DOC}`]: JSON.stringify({ title: 'Doc' }),
  };
  await withStore(store, async () => {
    const pages = await listStoredPages();
    assert.equal(pages.length, 1);
    assert.equal(pages[0].cards, 2);
    assert.equal(pages[0].hasPosition, true);
    assert.equal(pages[0].href, readerNotesKey(DOC).slice('dr-notes:'.length));
  });
});

test('deleteStoredPage removes notes, position, and doc entry for a position-only page too', async () => {
  const store = { 'dr-pos:localpdf:report.pdf': 7 };
  await withStore(store, async () => {
    await deleteStoredPage('localpdf:report.pdf');
    assert.deepEqual(await listStoredPages(), []);
  });
});

test('clearAllNotes wipes notes, positions, and doc entries', async () => {
  const store = {
    [readerNotesKey(DOC)]: JSON.stringify({ cards: [{}] }),
    [`dr-pos:${DOC}`]: 99,
    [`dr-doc:${DOC}`]: JSON.stringify({ title: 'Doc' }),
    'dr-pos:localpdf:report.pdf': 7,
    unrelated: 'keep',
  };
  await withStore(store, async () => {
    await clearAllNotes();
    assert.equal(store[readerNotesKey(DOC)], undefined);
    assert.equal(store[`dr-pos:${DOC}`], undefined);
    assert.equal(store[`dr-doc:${DOC}`], undefined);
    assert.equal(store['dr-pos:localpdf:report.pdf'], undefined);
    assert.equal(store.unrelated, 'keep');
  });
});
