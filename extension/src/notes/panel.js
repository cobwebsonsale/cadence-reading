import { loadNotes, saveNotes } from './storage.js';
import { el } from '../dom.js';
import { parseModel, createModelHistory } from './model.js';
import { createSnipButton, mapSpans } from './snip.js';
import { icon } from './icons.js';
import {
  clearEmptyInline,
  applyInlineMarkdown,
  applyBlockShortcut,
  blankBlock,
  keepCaretInView,
  currentLink,
  selectContents,
  safeExec,
  safeQueryState,
  placeCaretAtEnd,
  noteCaretOffset,
  setNoteCaret,
} from './editing.js';

const SAVE_DEBOUNCE = 500;
const COMMIT_DEBOUNCE = 350;

// B/I/U stay as styled letters (a universal convention); the rest use icons.
const TOOLS = [
  { cmd: 'bold', label: 'B', title: 'Bold', style: 'font-weight:700' },
  { cmd: 'italic', label: 'I', title: 'Italic', style: 'font-style:italic' },
  { cmd: 'underline', label: 'U', title: 'Underline', style: 'text-decoration:underline' },
  { cmd: 'insertUnorderedList', icon: 'bulletList', title: 'Bulleted list' },
  { cmd: 'insertOrderedList', icon: 'numberedList', title: 'Numbered list' },
  { cmd: 'createLink', icon: 'link', title: 'Link' },
];

export function createNotesPanel({ mount, contentEl, storageKey, title: docTitle = '', onOpen }) {
  const root = el('aside', 'dr-notes dr-notes-collapsed');

  const header = el('div', 'dr-notes-header');
  const collapseBtn = el('button', 'dr-notes-collapse');
  collapseBtn.type = 'button';
  collapseBtn.title = 'Collapse notes';
  collapseBtn.innerHTML = icon('chevron');
  const title = el('span', 'dr-notes-title');
  title.textContent = 'Notes';

  const toolbar = el('div', 'dr-notes-toolbar');
  const toolButtons = [];
  const addTool = (content, tip, onDown) => {
    const btn = el('button', 'dr-notes-tool');
    btn.type = 'button';
    btn.title = tip;
    if (content.icon) btn.innerHTML = icon(content.icon);
    else {
      btn.textContent = content.label;
      if (content.style) btn.setAttribute('style', content.style);
    }
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      onDown();
    });
    toolbar.appendChild(btn);
    return btn;
  };
  addTool({ icon: 'undo' }, 'Undo', () => runHistory('undo'));
  addTool({ icon: 'redo' }, 'Redo', () => runHistory('redo'));
  toolbar.appendChild(el('span', 'dr-notes-tool-sep'));
  for (const tool of TOOLS) {
    const btn = addTool(tool, tool.title, () => runCommand(tool.cmd));
    toolButtons.push({ btn, cmd: tool.cmd });
  }

  header.append(collapseBtn, title, toolbar);

  const cardsEl = el('div', 'dr-notes-cards');

  const body = el('div', 'dr-notes-body');
  body.append(cardsEl);
  root.append(header, body);
  mount.appendChild(root);

  let model = { cards: [] };
  let idCounter = 0;
  const byId = (id) => model.cards.find((c) => c.id === id);
  const cardById = (id) => cardsEl.querySelector(`.dr-notes-card[data-id="${id}"]`);
  const noteOf = (id) => cardById(id)?.querySelector('.dr-card-note');

  let armedDel = null;
  let suppressJump = false;
  const disarmDel = () => {
    if (!armedDel) return;
    armedDel.classList.remove('dr-armed');
    armedDel.innerHTML = icon('x');
    armedDel.closest('.dr-notes-card')?.classList.remove('dr-card-arming');
    armedDel = null;
  };

  const refreshEmpty = () => {
    const n = model.cards.length;
    root.classList.toggle('dr-notes-empty', n === 0);
    collapseBtn.dataset.count = String(n);
    collapseBtn.dataset.countLabel = n === 1 ? '1 note' : `${n} notes`;
  };

  let lastCursor = null;
  let pendingCursor = null;
  const serialize = () => JSON.stringify({ title: docTitle || undefined, cards: model.cards, cursor: lastCursor });

  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveNotes(storageKey, serialize()), SAVE_DEBOUNCE);
  };

  const history = createModelHistory(
    () => JSON.stringify(model.cards),
    (snap) => {
      model = { cards: JSON.parse(snap) };
      render();
    }
  );
  let commitTimer = null;
  const commit = () => {
    clearTimeout(commitTimer);
    commitTimer = null;
    history.push();
  };
  const commitSoon = () => {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commit, COMMIT_DEBOUNCE);
  };
  const flush = () => {
    if (commitTimer) commit();
  };
  const runHistory = (dir) => {
    flush();
    history[dir]();
    scheduleSave();
  };

  const nextId = () => `c${idCounter++}`;
  const activeNote = () => document.activeElement?.closest?.('.dr-card-note');
  const rememberCursor = () => {
    const note = activeNote();
    if (!note) return;
    const id = note.closest('.dr-notes-card')?.dataset.id;
    if (id != null) lastCursor = { id, offset: noteCaretOffset(note) };
  };

  function render() {
    disarmDel();
    cardsEl.replaceChildren();
    model.cards.forEach((card, i) => {
      cardsEl.appendChild(buildGap(i));
      cardsEl.appendChild(buildCardEl(card));
    });
    cardsEl.appendChild(buildGap(model.cards.length));
    if (!model.cards.length) cardsEl.appendChild(buildEmptyState());
    refreshEmpty();
  }

  function buildEmptyState() {
    const box = el('div', 'dr-notes-empty-state');
    box.innerHTML =
      `${icon('snip')}<div class="dr-empty-title">No notes yet</div>` +
      `<div class="dr-empty-hint">Select text in the document to snip it, or add a note with the + button.</div>`;
    return box;
  }

  function buildGap(index) {
    const gap = el('div', 'dr-notes-gap');
    const add = el('button', 'dr-notes-gap-add');
    add.type = 'button';
    add.title = 'Insert a note here';
    add.innerHTML = icon('plus');
    add.addEventListener('mousedown', (e) => {
      e.preventDefault();
      insertNoteAt(index);
    });
    gap.appendChild(add);
    return gap;
  }

  function buildCardEl(card) {
    const cardEl = el('div', `dr-notes-card dr-card-${card.kind}`);
    cardEl.dataset.id = card.id;

    const del = el('button', 'dr-card-del');
    del.type = 'button';
    del.title = 'Delete';
    del.innerHTML = icon('x');
    cardEl.appendChild(del);

    if (card.kind === 'snippet') {
      const quote = el('blockquote', 'dr-card-quote');
      quote.textContent = (card.quote || '').replace(/●/g, '•');
      cardEl.appendChild(quote);
    }

    const note = el('div', 'dr-card-note');
    note.setAttribute('contenteditable', 'true');
    note.spellcheck = false;
    note.setAttribute('data-placeholder', card.kind === 'snippet' ? 'Add a note…' : 'Note…');
    if (card.note) note.innerHTML = card.note;
    else note.appendChild(blankBlock());
    cardEl.appendChild(note);
    return cardEl;
  }

  function addSnippet(text, fromRect, anchor) {
    const quote = (text || '').replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').trim();
    if (!quote) return;
    const wasCollapsed = !isOpen();
    open();
    flush();
    const card = {
      id: nextId(),
      kind: 'snippet',
      quote,
      note: '',
      anchor: anchor ? { para: anchor.para, quote: anchor.quote } : null,
    };
    model.cards.push(card);
    render();
    if (anchor?.spans) tagSource(anchor.spans, card.id);
    scheduleSave();
    commit();
    focusNote(card.id);
    cardsEl.scrollTop = cardsEl.scrollHeight;
    if (fromRect)
      flySnippet(fromRect, quote.replace(/\s+/g, ' '), cardById(card.id), root, mount, wasCollapsed ? 210 : 40);
  }

  const tagSource = (spans, id) => {
    for (const s of spans) {
      s.classList.add('dr-snip-source');
      s.dataset.snippetId = id;
    }
  };
  const sourceSpans = (id) => contentEl.querySelectorAll(`.dr-snip-source[data-snippet-id="${id}"]`);
  const jumpToSource = (id) => {
    const spans = sourceSpans(id);
    if (!spans.length || !spans[0].hasAttribute('data-revealed')) return;
    spans[0].scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    flash(spans, 'dr-snip-flash');
  };
  const scrollCardToTop = (cardEl) => {
    cardsEl.scrollTop += cardEl.getBoundingClientRect().top - cardsEl.getBoundingClientRect().top - 8;
  };
  // Consecutive paragraphs from the anchor, enough to cover a multi-paragraph snippet.
  const collectFrom = (para, minChars) => {
    const spans = [];
    let chars = 0;
    for (let p = para; p < para + 16 && chars <= minChars; p++) {
      const paraEl = contentEl.querySelector(`.dr-para[data-paragraph-index="${p}"]`);
      if (!paraEl) break;
      const found = [...paraEl.querySelectorAll('.dr-char')];
      spans.push(...found);
      chars += found.reduce((n, s) => n + s.textContent.length, 0);
    }
    return spans;
  };
  const reanchor = () => {
    for (const card of model.cards) {
      if (card.kind !== 'snippet' || !card.anchor?.quote || sourceSpans(card.id).length) continue;
      const { text, at } = mapSpans(collectFrom(card.anchor.para, card.anchor.quote.length));
      const idx = text.indexOf(card.anchor.quote);
      if (idx < 0) continue;
      const hit = [];
      const seen = new Set();
      for (let i = idx; i < idx + card.anchor.quote.length && i < at.length; i++) {
        if (!seen.has(at[i])) {
          seen.add(at[i]);
          hit.push(at[i]);
        }
      }
      tagSource(hit, card.id);
    }
  };
  const onSourceClick = (e) => {
    if (e.metaKey || e.ctrlKey) return;
    const span = e.target.closest?.('.dr-snip-source');
    if (!span) return;
    const cardEl = cardById(span.dataset.snippetId);
    if (!cardEl) return;
    open();
    scrollCardToTop(cardEl);
    flash([cardEl], 'dr-card-flash');
  };
  contentEl.addEventListener('click', onSourceClick);

  function insertNoteAt(index) {
    open();
    flush();
    const card = { id: nextId(), kind: 'note', note: '' };
    model.cards.splice(index, 0, card);
    render();
    scheduleSave();
    commit();
    focusNote(card.id);
  }

  function deleteCard(id) {
    const i = model.cards.findIndex((c) => c.id === id);
    if (i < 0) return;
    flush();
    for (const s of sourceSpans(id)) {
      s.classList.remove('dr-snip-source');
      delete s.dataset.snippetId;
    }
    model.cards.splice(i, 1);
    render();
    scheduleSave();
    commit();
  }

  function focusNote(id) {
    const note = noteOf(id);
    if (!note) return;
    suppressJump = true;
    placeCaretAtEnd(note);
    suppressJump = false;
  }

  const STATE_CMDS = new Set(['bold', 'italic', 'underline', 'insertUnorderedList', 'insertOrderedList']);
  const updateToolStates = () => {
    const note = activeNote();
    for (const { btn, cmd } of toolButtons) {
      const on = !!note && (cmd === 'createLink' ? !!currentLink(note) : STATE_CMDS.has(cmd) && safeQueryState(cmd));
      btn.classList.toggle('dr-notes-tool-active', on);
    }
  };

  const syncNote = (note) => {
    const cardEl = note.closest('.dr-notes-card');
    const card = cardEl && byId(cardEl.dataset.id);
    if (card) card.note = note.innerHTML;
  };

  const applyLink = () => {
    const note = activeNote();
    if (!note) return;
    note.focus();
    const link = currentLink(note);
    if (link) selectContents(link);
    const url = window.prompt('Link URL', link ? link.getAttribute('href') || '' : '');
    if (url === null) return;
    flush();
    safeExec(url.trim() ? 'createLink' : 'unlink', url.trim() || undefined);
    syncNote(note);
    scheduleSave();
    updateToolStates();
    commit();
  };

  const runCommand = (cmd) => {
    if (cmd === 'createLink') return applyLink();
    const note = activeNote();
    if (!note) return;
    note.focus();
    flush();
    const wasOn = safeQueryState(cmd);
    safeExec(cmd);
    if (wasOn) clearEmptyInline(note, cmd);
    syncNote(note);
    scheduleSave();
    updateToolStates();
    commit();
  };

  cardsEl.addEventListener('input', (e) => {
    const note = e.target.closest?.('.dr-card-note');
    if (!note) return;
    applyInlineMarkdown(note);
    applyBlockShortcut(note);
    if (!note.firstChild) {
      const b = blankBlock();
      note.appendChild(b);
      placeCaretAtEnd(b);
    }
    syncNote(note);
    rememberCursor();
    scheduleSave();
    keepCaretInView(cardsEl);
    updateToolStates();
    commitSoon();
  });

  cardsEl.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      runHistory(e.shiftKey ? 'redo' : 'undo');
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      runHistory('redo');
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      applyLink();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
      const fmt = { b: 'bold', i: 'italic', u: 'underline' }[(e.key || '').toLowerCase()];
      if (fmt && activeNote()) {
        e.preventDefault();
        runCommand(fmt);
      }
    }
  });

  cardsEl.addEventListener('mousedown', (e) => {
    if (e.target.closest?.('hr')) e.preventDefault();
  });

  cardsEl.addEventListener('click', (e) => {
    const link = e.target.closest?.('a[href]');
    if (link && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      window.open(link.href, '_blank', 'noopener,noreferrer');
      return;
    }
    const del = e.target.closest?.('.dr-card-del');
    if (del) {
      const id = del.closest('.dr-notes-card')?.dataset.id;
      if (del === armedDel) {
        disarmDel();
        deleteCard(id);
      } else {
        disarmDel();
        armedDel = del;
        del.classList.add('dr-armed');
        del.textContent = 'Delete';
        del.closest('.dr-notes-card')?.classList.add('dr-card-arming');
      }
      return;
    }
    const quote = e.target.closest?.('.dr-card-quote');
    if (quote) jumpToSource(quote.closest('.dr-notes-card')?.dataset.id);
  });

  cardsEl.addEventListener('focusin', (e) => {
    if (suppressJump) return;
    const note = e.target.closest?.('.dr-card-note');
    const card = note?.closest('.dr-notes-card.dr-card-snippet');
    if (card) jumpToSource(card.dataset.id);
  });

  const isOpen = () => !root.classList.contains('dr-notes-collapsed');
  const setOpen = (o) => {
    root.classList.toggle('dr-notes-collapsed', !o);
    mount.classList.toggle('dr-notes-open', o);
    collapseBtn.title = o ? 'Collapse notes' : 'Open notes';
    if (o) onOpen?.();
  };
  const open = () => {
    setOpen(true);
    reanchor();
    if (pendingCursor) {
      const c = pendingCursor;
      pendingCursor = null;
      const note = noteOf(c.id);
      if (note) setNoteCaret(note, c.offset);
    }
  };
  const toggle = () => setOpen(!isOpen());
  collapseBtn.addEventListener('click', toggle);
  title.addEventListener('click', () => !isOpen() && open());

  const snip = createSnipButton({
    contentEl,
    mount,
    onSnip: (p) =>
      addSnippet(p.text, p.rect, p.spans ? { spans: p.spans, para: p.para, quote: p.quote } : null),
  });
  const onSelectionChange = () => {
    rememberCursor();
    updateToolStates();
  };
  const onModifier = (e) => cardsEl.classList.toggle('dr-linking', !!(e.metaKey || e.ctrlKey));
  const clearModifier = () => cardsEl.classList.remove('dr-linking');
  const onDocDown = (e) => {
    if (armedDel && !armedDel.contains(e.target)) disarmDel();
  };
  document.addEventListener('mousedown', onDocDown, true);
  document.addEventListener('selectionchange', onSelectionChange);
  window.addEventListener('keydown', onModifier, true);
  window.addEventListener('keyup', onModifier, true);
  window.addEventListener('blur', clearModifier);

  try {
    document.execCommand('defaultParagraphSeparator', false, 'p');
  } catch {
    void 0;
  }

  const seedIds = () => {
    idCounter = model.cards.reduce((m, c) => Math.max(m, (parseInt(String(c.id).replace(/\D/g, ''), 10) || 0) + 1), 0);
  };
  seedIds();
  render();
  history.push();
  loadNotes(storageKey).then((raw) => {
    if (!raw || model.cards.length) return;
    const parsed = parseModel(raw);
    model = { cards: parsed.cards };
    lastCursor = parsed.cursor || null;
    pendingCursor = parsed.cursor || null;
    if (!docTitle && parsed.title) docTitle = parsed.title;
    seedIds();
    render();
    reanchor();
    history.reset();
  });

  return {
    root,
    open,
    close: () => setOpen(false),
    toggle,
    isOpen,
    addSnippet,
    addSnippetFromSelection: snip.updateSnip,
    getModel: () => model,
    destroy() {
      clearTimeout(saveTimer);
      clearTimeout(commitTimer);
      saveNotes(storageKey, serialize());
      snip.destroy();
      document.removeEventListener('mousedown', onDocDown, true);
      document.removeEventListener('selectionchange', onSelectionChange);
      window.removeEventListener('keydown', onModifier, true);
      window.removeEventListener('keyup', onModifier, true);
      window.removeEventListener('blur', clearModifier);
      contentEl.removeEventListener('click', onSourceClick);
      for (const s of contentEl.querySelectorAll('.dr-snip-source')) {
        s.classList.remove('dr-snip-source');
        delete s.dataset.snippetId;
      }
      root.remove();
      mount.classList.remove('dr-notes-open');
    },
  };
}

function flash(els, className) {
  for (const el of els) {
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
    setTimeout(() => el.classList.remove(className), 1000);
  }
}

function flySnippet(fromRect, text, targetEl, fallbackEl, mount, delay) {
  const preview = text.length > 60 ? `${text.slice(0, 60).trimEnd()}…` : text;
  const ghost = el('div', 'dr-snip-fly');
  ghost.textContent = `“${preview}”`;
  ghost.style.left = `${fromRect.left}px`;
  ghost.style.top = `${fromRect.top}px`;
  ghost.style.maxWidth = `${Math.min(Math.max(fromRect.width, 160), 300)}px`;
  mount.appendChild(ghost);
  setTimeout(() => {
    const rect = targetEl?.getBoundingClientRect();
    const target = rect && rect.height ? rect : fallbackEl.getBoundingClientRect();
    ghost.style.transform = `translate(${target.left - fromRect.left}px, ${target.top - fromRect.top}px) scale(0.55)`;
    ghost.style.opacity = '0';
  }, delay);
  ghost.addEventListener('transitionend', () => ghost.remove(), { once: true });
  setTimeout(() => ghost.remove(), delay + 1400);
}
