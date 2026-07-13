import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { listFiles } from '../extension/src/api/drive.js';

function mockFetch(impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = original;
  };
}

// listFiles issues two queries (owned/shared-drive + shared-with-me); serve each.
function serveTwoQueries(urls) {
  return async (url) => {
    urls.push(String(url));
    const shared = String(url).includes('sharedWithMe');
    const files = shared
      ? [{ id: 'shared1', name: 'Shared Doc', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2024-01-02T00:00:00Z' }]
      : [{ id: 'own1', name: 'My Doc', mimeType: 'application/pdf', modifiedTime: '2024-01-03T00:00:00Z' }];
    return { ok: true, json: async () => ({ files }) };
  };
}

test('listFiles merges owned and shared-with-me results, newest first', async () => {
  const urls = [];
  const restore = mockFetch(serveTwoQueries(urls));
  try {
    const files = await listFiles('', 'tok');
    assert.deepEqual(files.map((f) => f.id), ['own1', 'shared1']); // sorted by modifiedTime desc
    assert.equal(urls.length, 2);
    assert.ok(
      urls.some((u) => new URL(u).searchParams.get('q').includes('sharedWithMe=true')),
      'one query is sharedWithMe'
    );
    assert.ok(urls.some((u) => new URL(u).searchParams.get('corpora') === 'allDrives'), 'one query spans all drives');
    for (const u of urls) {
      const q = new URL(u).searchParams.get('q');
      assert.match(q, /application\/vnd\.google-apps\.document/);
      assert.match(q, /application\/pdf/);
      assert.match(q, /trashed=false/);
    }
  } finally {
    restore();
  }
});

test('listFiles dedupes a file returned by both queries', async () => {
  const restore = mockFetch(async () => ({
    ok: true,
    json: async () => ({ files: [{ id: 'dup', name: 'Doc', modifiedTime: '2024-01-01T00:00:00Z' }] }),
  }));
  try {
    const files = await listFiles('', 'tok');
    assert.deepEqual(files.map((f) => f.id), ['dup']);
  } finally {
    restore();
  }
});

test('listFiles adds an escaped name filter to both queries when searching', async () => {
  const urls = [];
  const restore = mockFetch(async (url) => {
    urls.push(String(url));
    return { ok: true, json: async () => ({}) };
  });
  try {
    await listFiles("O'Brien", 'tok');
    assert.equal(urls.length, 2);
    for (const u of urls) {
      assert.ok(new URL(u).searchParams.get('q').includes("name contains 'O\\'Brien'"), u);
    }
  } finally {
    restore();
  }
});

test('listFiles throws with status on a Drive error', async () => {
  const restore = mockFetch(async () => ({ ok: false, status: 403, text: async () => 'denied' }));
  try {
    await assert.rejects(() => listFiles('', 'tok'), (err) => err.status === 403);
  } finally {
    restore();
  }
});
