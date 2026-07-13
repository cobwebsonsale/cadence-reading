import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createNotesPanel } from '../extension/src/notes/panel.js';
import { mapSpans, spansToDisplay } from '../extension/src/notes/snip.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

// A reader whose content spans an intro paragraph and a list item (the bullet is a
// single two-character span, as the builder emits it).
function makeListReader() {
  const stage = document.createElement('div');
  stage.className = 'dr-stage';
  document.body.appendChild(stage);
  const content = document.createElement('div');
  stage.appendChild(content);
  const spans = [];
  const addPara = (index, isList, text) => {
    const p = document.createElement('p');
    p.className = isList ? 'dr-para dr-list-item' : 'dr-para';
    p.setAttribute('data-paragraph-index', String(index));
    if (isList) {
      const b = document.createElement('span');
      b.className = 'dr-char dr-bullet';
      b.setAttribute('data-revealed', 'true');
      b.textContent = '● ';
      p.appendChild(b);
      spans.push(b);
    }
    for (const ch of text) {
      const s = document.createElement('span');
      s.className = 'dr-char';
      s.setAttribute('data-revealed', 'true');
      s.textContent = ch;
      p.appendChild(s);
      spans.push(s);
    }
    content.appendChild(p);
  };
  addPara(0, false, 'Intro:');
  addPara(1, true, 'Item');
  return { content, spans };
}

// A reader content element: one paragraph of revealed single-char spans.
function makeReader(text) {
  const stage = document.createElement('div');
  stage.className = 'dr-stage';
  document.body.appendChild(stage);
  const content = document.createElement('div');
  stage.appendChild(content);
  const para = document.createElement('p');
  para.className = 'dr-para';
  para.setAttribute('data-paragraph-index', '0');
  const spans = [];
  for (const ch of text) {
    const s = document.createElement('span');
    s.className = 'dr-char';
    s.setAttribute('data-revealed', 'true');
    s.textContent = ch;
    para.appendChild(s);
    spans.push(s);
  }
  content.appendChild(para);
  return { content, spans, stage };
}

test('snip -> annotate -> persist -> reload re-loads the model and re-anchors the highlight', async () => {
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: async (k) => (k === null ? { ...store } : { [k]: store[k] }),
        set: async (obj) => Object.assign(store, obj),
        remove: async (keys) => [].concat(keys).forEach((k) => delete store[k]),
      },
    },
  };
  const key = 'dr-notes:e2e';

  try {
    // --- session 1: snip a phrase and annotate it ---
    const { content, spans } = makeReader('hello world');
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const panel = createNotesPanel({ mount, contentEl: content, storageKey: key, title: 'My Doc' });

    panel.addSnippet('hello', null, { spans: spans.slice(0, 5), para: 0, quote: 'hello' });

    let model = panel.getModel();
    assert.equal(model.cards.length, 1);
    assert.equal(model.cards[0].kind, 'snippet');
    assert.equal(model.cards[0].quote, 'hello');
    // source text got highlighted in the reader
    assert.equal(content.querySelectorAll('.dr-snip-source').length, 5);

    // type a note into the snippet's note field
    const note = mount.querySelector('.dr-card-note');
    note.textContent = 'my note';
    note.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.ok(panel.getModel().cards[0].note.includes('my note'));

    // destroy flushes the model + title to storage and clears the reader highlight
    panel.destroy();
    assert.equal(content.querySelectorAll('.dr-snip-source').length, 0, 'destroy cleaned reader tags');
    const saved = JSON.parse(store[key]);
    assert.equal(saved.title, 'My Doc', 'title persisted');
    assert.equal(saved.cards[0].quote, 'hello');
    mount.remove();

    // --- session 2: a fresh panel on the same reader reloads and re-anchors ---
    const mount2 = document.createElement('div');
    document.body.appendChild(mount2);
    const panel2 = createNotesPanel({ mount: mount2, contentEl: content, storageKey: key, title: '' });
    await tick(); // let loadNotes resolve

    const model2 = panel2.getModel();
    assert.equal(model2.cards.length, 1, 'card reloaded from storage');
    assert.ok(model2.cards[0].note.includes('my note'), 'note text survived the round-trip');
    assert.equal(content.querySelectorAll('.dr-snip-source').length, 5, 're-anchored the highlight on reload');

    panel2.destroy();
    mount2.remove();
  } finally {
    delete globalThis.chrome;
  }
});

test('a snippet spanning a paragraph and a list item re-anchors across both on reload', async () => {
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: async (k) => (k === null ? { ...store } : { [k]: store[k] }),
        set: async (obj) => Object.assign(store, obj),
        remove: async (keys) => [].concat(keys).forEach((k) => delete store[k]),
      },
    },
  };
  const key = 'dr-notes:multi';
  try {
    const { content, spans } = makeListReader();
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const panel = createNotesPanel({ mount, contentEl: content, storageKey: key });

    // Snip the whole intro + list item (as the floating Snip button would).
    panel.addSnippet(spansToDisplay(spans), null, { spans, para: 0, quote: mapSpans(spans).text });

    // The card keeps the list item on its own line (not run together).
    assert.match(panel.getModel().cards[0].quote, /Intro:\n• Item/);
    assert.equal(content.querySelectorAll('.dr-snip-source').length, spans.length);

    panel.destroy();
    assert.equal(content.querySelectorAll('.dr-snip-source').length, 0);
    mount.remove();

    // Reload: the highlight must be restored across both paragraphs (the bug: it wasn't).
    const mount2 = document.createElement('div');
    document.body.appendChild(mount2);
    const panel2 = createNotesPanel({ mount: mount2, contentEl: content, storageKey: key });
    await tick();
    assert.equal(
      content.querySelectorAll('.dr-snip-source').length,
      spans.length,
      're-anchored the multi-paragraph highlight on reload'
    );
    panel2.destroy();
    mount2.remove();
  } finally {
    delete globalThis.chrome;
  }
});
