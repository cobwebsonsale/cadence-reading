import { installRaf } from './helpers.js'; // jsdom globals + rAF control
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchInlineMarkdown, matchBlockShortcut } from '../extension/src/notes/markdown.js';
import { createNotesPanel } from '../extension/src/notes/panel.js';
import {
  hrefFromKey,
  noteEntriesFromStore,
  positionKey,
  loadPosition,
  savePosition,
  deleteNotes,
  clearAllNotes,
} from '../extension/src/notes/storage.js';

const makePanel = () => {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const contentEl = document.createElement('div');
  mount.appendChild(contentEl);
  const panel = createNotesPanel({ mount, contentEl, storageKey: 'dr-notes:test' });
  return { mount, contentEl, panel };
};

test('hrefFromKey unwraps only note-prefixed keys', () => {
  assert.equal(hrefFromKey('dr-notes:https://docs.google.com/x'), 'https://docs.google.com/x');
  assert.equal(hrefFromKey('charsPerSec'), null);
  assert.equal(hrefFromKey(null), null);
});

test('noteEntriesFromStore lists note pages with card counts and sizes, sorted', () => {
  const store = {
    charsPerSec: 40,
    'dr-notes:https://b.example/doc': JSON.stringify({ title: 'Budget', cards: [{ id: 'c0' }, { id: 'c1' }] }),
    'dr-notes:https://a.example/doc': JSON.stringify({ title: 'Agenda', cards: [{ id: 'c0' }] }),
    'dr-notes:https://c.example/broken': 'not json',
  };
  const entries = noteEntriesFromStore(store);
  assert.deepEqual(
    entries.map((e) => e.href),
    ['https://a.example/doc', 'https://b.example/doc', 'https://c.example/broken'],
    'only note keys, sorted by href'
  );
  assert.equal(entries[0].cards, 1);
  assert.equal(entries[0].title, 'Agenda', 'exposes the stored document title');
  assert.equal(entries[1].cards, 2);
  assert.equal(entries[1].title, 'Budget');
  assert.equal(entries[2].cards, 0, 'unparseable value counts as zero cards');
  assert.equal(entries[2].title, '', 'missing/unparseable title falls back to empty');
  assert.ok(entries[0].bytes > 0);
  assert.equal(entries[0].key, 'dr-notes:https://a.example/doc');
});

test('noteEntriesFromStore tolerates an empty or missing store', () => {
  assert.deepEqual(noteEntriesFromStore(), []);
  assert.deepEqual(noteEntriesFromStore({}), []);
});

test('positionKey strips the hash and is distinct from the notes key', () => {
  assert.equal(positionKey('https://x.io/doc#frag'), 'dr-pos:https://x.io/doc');
  assert.notEqual(positionKey('https://x.io/doc'), 'dr-notes:https://x.io/doc');
});

test('savePosition/loadPosition round-trip the reveal index per page', async () => {
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: async (k) => (k === null ? { ...store } : { [k]: store[k] }),
        set: async (obj) => Object.assign(store, obj),
        remove: async () => {},
      },
    },
  };
  try {
    await savePosition('https://x.io/doc', 1234);
    assert.equal(store['dr-pos:https://x.io/doc'], 1234, 'saved under the position key');
    assert.equal(await loadPosition('https://x.io/doc'), 1234, 'restores the saved index');
    assert.equal(await loadPosition('https://x.io/other'), 0, 'unseen page starts at 0');
  } finally {
    delete globalThis.chrome;
  }
});

test('deleteNotes also removes the page reveal position', async () => {
  const removed = [];
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
        remove: async (keys) => removed.push(...(Array.isArray(keys) ? keys : [keys])),
      },
    },
  };
  try {
    await deleteNotes('dr-notes:https://x.io/doc');
    assert.deepEqual(removed.sort(), ['dr-notes:https://x.io/doc', 'dr-pos:https://x.io/doc']);
  } finally {
    delete globalThis.chrome;
  }
});

test('clearAllNotes clears both notes and reveal-position keys, leaving settings', async () => {
  const store = {
    charsPerSec: 40,
    'dr-notes:a': '{}',
    'dr-pos:a': '10',
    'dr-notes:b': '{}',
  };
  const removed = [];
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ ...store }),
        set: async () => {},
        remove: async (keys) => removed.push(...keys),
      },
    },
  };
  try {
    await clearAllNotes();
    assert.deepEqual(removed.sort(), ['dr-notes:a', 'dr-notes:b', 'dr-pos:a']);
  } finally {
    delete globalThis.chrome;
  }
});

test('matchInlineMarkdown converts bold, italic, code, and links', () => {
  assert.deepEqual(matchInlineMarkdown('a **bold**'), { start: 2, raw: '**bold**', tag: 'strong', text: 'bold' });
  assert.deepEqual(matchInlineMarkdown('an _em_'), { start: 3, raw: '_em_', tag: 'em', text: 'em' });
  assert.deepEqual(matchInlineMarkdown('use `code`'), { start: 4, raw: '`code`', tag: 'code', text: 'code' });
  assert.deepEqual(matchInlineMarkdown('see [site](https://x.io)'), {
    start: 4,
    raw: '[site](https://x.io)',
    tag: 'a',
    text: 'site',
    href: 'https://x.io',
  });
});

test('matchInlineMarkdown prefers bold over italic and needs a closing token at the caret', () => {
  assert.equal(matchInlineMarkdown('**bd**').tag, 'strong');
  assert.equal(matchInlineMarkdown('*half'), null); // no closing star yet
  assert.equal(matchInlineMarkdown('a * b *'), null); // space after opening star is not italic
});

test('matchInlineMarkdown ignores intra-word underscores', () => {
  assert.equal(matchInlineMarkdown('file_name_here'), null);
});

test('matchBlockShortcut detects headings and lists (but not rules)', () => {
  assert.deepEqual(matchBlockShortcut('# '.padEnd(2) + 'x').type, 'h1');
  assert.equal(matchBlockShortcut('### Heading').type, 'h3');
  assert.equal(matchBlockShortcut('- item').type, 'ul');
  assert.equal(matchBlockShortcut('* item').type, 'ul');
  assert.equal(matchBlockShortcut('1. item').type, 'ol');
  assert.equal(matchBlockShortcut('---'), null);
  assert.equal(matchBlockShortcut('***'), null);
  assert.equal(matchBlockShortcut('just text'), null);
});

const mousedown = (el, opts) => el.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, ...opts }));
const click = (el, opts) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, ...opts }));

test('createNotesPanel builds a collapsed panel with a cards container and toolbar', () => {
  const { mount, panel } = makePanel();
  assert.ok(mount.querySelector('.dr-notes-cards'));
  assert.equal(mount.querySelectorAll('.dr-notes-tool').length, 8);
  assert.equal(panel.isOpen(), false);
  panel.destroy();
});

test('toggle opens and closes the panel', () => {
  const { panel } = makePanel();
  panel.toggle();
  assert.equal(panel.isOpen(), true);
  panel.toggle();
  assert.equal(panel.isOpen(), false);
  panel.destroy();
});

test('snipping creates a snippet card with a quote and an editable note beneath', () => {
  const { mount, panel } = makePanel();
  panel.addSnippet('  first   snippet  ');
  const card = mount.querySelector('.dr-notes-card.dr-card-snippet');
  assert.ok(card, 'a snippet card exists');
  assert.equal(card.querySelector('.dr-card-quote').textContent, 'first snippet');
  assert.equal(card.querySelector('.dr-card-quote').getAttribute('contenteditable'), null, 'quote is not editable');
  assert.equal(card.querySelector('.dr-card-note').getAttribute('contenteditable'), 'true', 'note is editable');
  assert.equal(panel.isOpen(), true);
  panel.destroy();
});

test('the model tracks snippet cards with quote and (empty) note', () => {
  const { panel } = makePanel();
  panel.addSnippet('a');
  panel.addSnippet('b');
  const cards = panel.getModel().cards;
  assert.equal(cards.length, 2);
  assert.deepEqual(
    cards.map((c) => [c.kind, c.quote, c.note]),
    [['snippet', 'a', ''], ['snippet', 'b', '']]
  );
  panel.destroy();
});

test('a gap + on an empty panel adds a free note card', () => {
  const { mount, panel } = makePanel();
  mousedown(mount.querySelector('.dr-notes-gap-add'));
  assert.equal(mount.querySelectorAll('.dr-notes-card.dr-card-note').length, 1);
  assert.equal(panel.getModel().cards[0].kind, 'note');
  panel.destroy();
});

test('a gap + inserts a note card at that position', () => {
  const { mount, panel } = makePanel();
  panel.addSnippet('snip');
  // the first gap sits before the snippet card
  mousedown(mount.querySelector('.dr-notes-gap .dr-notes-gap-add'));
  assert.deepEqual(panel.getModel().cards.map((c) => c.kind), ['note', 'snippet']);
  panel.destroy();
});

test('deleting a card needs a confirm click, and resets on outside click', () => {
  const { mount, contentEl, panel } = makePanel();
  panel.addSnippet('gone');
  const del = mount.querySelector('.dr-card-del');

  click(del); // first click arms
  assert.ok(del.classList.contains('dr-armed'));
  assert.equal(mount.querySelectorAll('.dr-notes-card').length, 1, 'not deleted yet');

  // an outside click resets the confirm state
  contentEl.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(mount.querySelector('.dr-card-del').classList.contains('dr-armed'), false);

  click(mount.querySelector('.dr-card-del')); // arm again
  click(mount.querySelector('.dr-card-del')); // confirm
  assert.equal(mount.querySelectorAll('.dr-notes-card').length, 0);
  assert.equal(panel.getModel().cards.length, 0);
  panel.destroy();
});

test('undo removes a snipped card and redo restores it', () => {
  const { mount, panel } = makePanel();
  const cards = () => mount.querySelectorAll('.dr-notes-card').length;
  const key = (opts) =>
    mount.querySelector('.dr-notes-cards').dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, ...opts }));

  panel.addSnippet('hello');
  assert.equal(cards(), 1);
  key({ key: 'z', metaKey: true });
  assert.equal(cards(), 0, 'undo removed the card');
  key({ key: 'z', metaKey: true, shiftKey: true });
  assert.equal(cards(), 1, 'redo restored the card');
  panel.destroy();
});

test('the toolbar undo/redo buttons revert and restore a change', () => {
  const { mount, panel } = makePanel();
  const cards = () => mount.querySelectorAll('.dr-notes-card').length;
  const tools = mount.querySelectorAll('.dr-notes-tool');
  const [undoBtn, redoBtn] = tools;
  const down = (el) => el.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));

  panel.addSnippet('hello');
  assert.equal(cards(), 1);
  down(undoBtn);
  assert.equal(cards(), 0, 'undo button removed the card');
  down(redoBtn);
  assert.equal(cards(), 1, 'redo button restored the card');
  panel.destroy();
});

test('a snippet links to its source text both ways', () => {
  const { mount, contentEl, panel } = makePanel();
  const para = document.createElement('p');
  para.className = 'dr-para';
  para.setAttribute('data-paragraph-index', '0');
  const spans = [...'hello'].map((ch) => {
    const s = document.createElement('span');
    s.className = 'dr-char';
    s.setAttribute('data-revealed', 'true');
    s.textContent = ch;
    para.appendChild(s);
    return s;
  });
  contentEl.appendChild(para);

  panel.addSnippet('hello', null, { spans, para: 0, quote: 'hello' });
  assert.equal(contentEl.querySelectorAll('.dr-snip-source').length, 5, 'source spans highlighted');
  const id = panel.getModel().cards[0].id;
  assert.equal(spans[0].dataset.snippetId, id);
  assert.deepEqual(panel.getModel().cards[0].anchor, { para: 0, quote: 'hello' });

  click(spans[0]); // doc → card
  assert.ok(mount.querySelector('.dr-notes-card').classList.contains('dr-card-flash'));

  click(mount.querySelector('.dr-card-quote')); // card → doc
  assert.ok(spans[0].classList.contains('dr-snip-flash'));

  panel.destroy();
  assert.equal(contentEl.querySelectorAll('.dr-snip-source').length, 0, 'highlights cleared on destroy');
});

test('the snip button hides when the selection scrolls out of the reader viewport', () => {
  const { mount, contentEl, panel } = makePanel();
  const stage = document.createElement('div');
  stage.className = 'dr-stage';
  stage.getBoundingClientRect = () => ({ top: 100, bottom: 500, left: 0, right: 400, width: 400, height: 400 });
  stage.appendChild(contentEl);
  mount.appendChild(stage);

  const para = document.createElement('p');
  para.className = 'dr-para';
  para.setAttribute('data-paragraph-index', '0');
  const inView = () => ({ top: 200, bottom: 220, left: 10, right: 40, width: 30, height: 20 });
  const spans = [...'hello'].map((ch) => {
    const s = document.createElement('span');
    s.className = 'dr-char';
    s.setAttribute('data-revealed', 'true');
    s.textContent = ch;
    s.getBoundingClientRect = inView;
    para.appendChild(s);
    return s;
  });
  contentEl.appendChild(para);

  const range = document.createRange();
  range.setStartBefore(spans[0]);
  range.setEndAfter(spans[spans.length - 1]);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const snipBtn = mount.querySelector('.dr-snip-btn');
  panel.addSnippetFromSelection();
  assert.equal(snipBtn.hidden, false, 'button shows for an in-view selection');

  const raf = installRaf();
  const scroll = () => {
    document.dispatchEvent(new window.Event('scroll', { bubbles: true }));
    raf.frame(0);
  };

  // scroll the selection above the viewport
  for (const s of spans) s.getBoundingClientRect = () => ({ top: -50, bottom: -30, left: 10, right: 40, width: 30, height: 20 });
  scroll();
  assert.equal(snipBtn.hidden, true, 'button hides once the selection scrolls out of view');

  // scroll it back into view
  for (const s of spans) s.getBoundingClientRect = inView;
  scroll();
  assert.equal(snipBtn.hidden, false, 'button reappears when the selection returns to view');

  raf.restore();
  panel.destroy();
});

test('the snip button anchors to the last text char, not a trailing image', () => {
  const { mount, contentEl, panel } = makePanel();
  const stage = document.createElement('div');
  stage.className = 'dr-stage';
  stage.getBoundingClientRect = () => ({ top: 100, bottom: 500, left: 0, right: 400, width: 400, height: 400 });
  stage.appendChild(contentEl);
  mount.appendChild(stage);

  const para = document.createElement('p');
  para.className = 'dr-para';
  para.setAttribute('data-paragraph-index', '0');
  const mk = (ch, right, cls) => {
    const s = document.createElement('span');
    s.className = `dr-char${cls ? ' ' + cls : ''}`;
    s.setAttribute('data-revealed', 'true');
    s.textContent = ch;
    s.getBoundingClientRect = () => ({ top: 200, bottom: 220, left: right - 8, right, width: 8, height: 20 });
    para.appendChild(s);
    return s;
  };
  const t1 = mk('h', 40);
  const t2 = mk('i', 48);
  const img = mk('', 320, 'dr-inline-object'); // trailing image span, far to the right
  contentEl.appendChild(para);

  const range = document.createRange();
  range.setStartBefore(t1);
  range.setEndAfter(img);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  panel.addSnippetFromSelection();
  const snipBtn = mount.querySelector('.dr-snip-btn');
  assert.equal(snipBtn.hidden, false);
  assert.equal(snipBtn.style.left, `${t2.getBoundingClientRect().right + 2}px`, 'anchored at the last text char, not the image');
  panel.destroy();
});

test('reopening a document restores the notes caret position', async () => {
  const key = 'dr-notes:caret-restore';
  const saved = JSON.stringify({
    cards: [{ id: 'c0', kind: 'note', note: '<p>hello world</p>' }],
    cursor: { id: 'c0', offset: 5 },
  });
  const store = { [key]: saved };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (k) => ({ [k]: store[k] }),
        set: async (obj) => Object.assign(store, obj),
      },
    },
  };
  try {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const contentEl = document.createElement('div');
    mount.appendChild(contentEl);
    const panel = createNotesPanel({ mount, contentEl, storageKey: key });
    await new Promise((resolve) => setTimeout(resolve, 0));
    panel.open();
    const note = mount.querySelector('.dr-card-note');
    const sel = window.getSelection();
    assert.ok(note.contains(sel.anchorNode), 'caret landed inside the restored note');
    assert.equal(sel.anchorOffset, 5, 'caret restored to the saved character offset');
    panel.destroy();
    mount.remove();
  } finally {
    delete globalThis.chrome;
  }
});

test('the notes panel persists the document title alongside its data', async () => {
  const key = 'dr-notes:titled-doc';
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: async (k) => (k === null ? { ...store } : { [k]: store[k] }),
        set: async (obj) => Object.assign(store, obj),
        remove: async () => {},
      },
    },
  };
  try {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const contentEl = document.createElement('div');
    mount.appendChild(contentEl);
    const panel = createNotesPanel({ mount, contentEl, storageKey: key, title: 'Quarterly Report' });
    panel.addSnippet('hello');
    panel.destroy();
    mount.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const saved = JSON.parse(store[key]);
    assert.equal(saved.title, 'Quarterly Report', 'title stored with the notes');
    assert.equal(saved.cards.length, 1);
  } finally {
    delete globalThis.chrome;
  }
});

test('destroy removes the panel from the DOM', () => {
  const { mount, panel } = makePanel();
  panel.destroy();
  assert.equal(mount.querySelector('.dr-notes'), null);
});

test('a link in a note opens only on modifier-click', () => {
  const { mount, panel } = makePanel();
  mousedown(mount.querySelector('.dr-notes-gap-add'));
  const note = mount.querySelector('.dr-card-note');
  const a = document.createElement('a');
  a.href = 'https://example.com/';
  a.textContent = 'link';
  note.appendChild(a);

  const opened = [];
  const original = window.open;
  window.open = (...args) => opened.push(args);
  try {
    click(a);
    assert.equal(opened.length, 0, 'plain click does not open');
    click(a, { metaKey: true });
  } finally {
    window.open = original;
  }
  assert.equal(opened.length, 1, 'modifier-click opens');
  assert.equal(opened[0][0], 'https://example.com/');
  panel.destroy();
});
