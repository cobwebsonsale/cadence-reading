import { matchInlineMarkdown, matchBlockShortcut } from './markdown.js';

export function clearEmptyInline(note, cmd) {
  const tags = { bold: ['B', 'STRONG'], italic: ['I', 'EM'], underline: ['U'] }[cmd];
  if (!tags) return;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
  let node = sel.anchorNode;
  while (node && node !== note) {
    if (node.nodeType === 1 && tags.includes(node.tagName) && !node.textContent) {
      const parent = node.parentNode;
      const first = node.firstChild;
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      node.remove();
      const range = document.createRange();
      if (first) range.setStartBefore(first);
      else range.setStart(parent, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    node = node.parentNode;
  }
}

export function applyInlineMarkdown(editor) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
  const node = sel.anchorNode;
  if (!node || node.nodeType !== 3 || !editor.contains(node)) return;
  const offset = sel.anchorOffset;
  const match = matchInlineMarkdown(node.textContent.slice(0, offset));
  if (!match) return;

  const after = node.textContent.slice(offset);
  node.textContent = node.textContent.slice(0, match.start);

  const built = buildInline(match);
  node.after(built);
  const tail = document.createTextNode(after);
  built.after(tail);

  const range = document.createRange();
  range.setStart(tail, 0);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function buildInline(match) {
  if (match.tag === 'a') {
    const a = document.createElement('a');
    a.href = match.href;
    a.textContent = match.text;
    return a;
  }
  const node = document.createElement(match.tag);
  node.textContent = match.text;
  return node;
}

export function applyBlockShortcut(editor) {
  const block = currentBlock(editor);
  if (!block || block.tagName === 'LI') return;
  const shortcut = matchBlockShortcut(block.textContent);
  if (!shortcut) return;

  const rest = block.textContent.slice(shortcut.strip || 0);
  if (shortcut.type === 'ul' || shortcut.type === 'ol') {
    const list = document.createElement(shortcut.type);
    const li = document.createElement('li');
    li.textContent = rest;
    list.appendChild(li);
    block.replaceWith(list);
    placeCaretAtEnd(li);
  } else {
    const heading = document.createElement(shortcut.type);
    heading.textContent = rest;
    block.replaceWith(heading);
    placeCaretAtEnd(heading);
  }
}

function currentBlock(editor) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let node = sel.anchorNode;
  if (node === editor) return editor.children[Math.min(editor.children.length - 1, sel.anchorOffset)] || null;
  while (node && node.parentNode !== editor) node = node.parentNode;
  return node && node !== editor ? node : null;
}

export function blankBlock() {
  const p = document.createElement('p');
  p.appendChild(document.createElement('br'));
  return p;
}

export function keepCaretInView(scrollEl) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  let rect = sel.getRangeAt(0).getBoundingClientRect();
  if (!rect.height) {
    const node = sel.anchorNode;
    rect = (node && (node.nodeType === 1 ? node : node.parentElement))?.getBoundingClientRect();
  }
  if (!rect || !rect.height) return;
  const box = scrollEl.getBoundingClientRect();
  const topMargin = 12;
  const bottomMargin = 56;
  if (rect.bottom > box.bottom - bottomMargin) scrollEl.scrollTop += rect.bottom - box.bottom + bottomMargin;
  else if (rect.top < box.top + topMargin) scrollEl.scrollTop -= box.top + topMargin - rect.top;
}

export function currentLink(editor) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let node = sel.anchorNode;
  if (!node || !editor.contains(node)) return null;
  if (node.nodeType === 3) node = node.parentElement;
  return node?.closest?.('a[href]') || null;
}

export function selectContents(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

export function safeExec(cmd, value) {
  try {
    return document.execCommand(cmd, false, value);
  } catch {
    return false;
  }
}

export function safeQueryState(cmd) {
  try {
    return document.queryCommandState(cmd);
  } catch {
    return false;
  }
}

export function placeCaretAtEnd(node) {
  node.focus?.();
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

export function noteCaretOffset(note) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!note.contains(range.endContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(note);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString().length;
}

export function setNoteCaret(note, offset) {
  if (offset == null) return placeCaretAtEnd(note);
  note.focus?.();
  const walker = document.createTreeWalker(note, window.NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node;
  while ((node = walker.nextNode())) {
    if (remaining <= node.textContent.length) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    remaining -= node.textContent.length;
  }
  placeCaretAtEnd(note);
}
