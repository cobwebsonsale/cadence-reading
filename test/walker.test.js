import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSteps, buildBlockSteps, trimTrailingPauses } from '../extension/src/reveal/walker.js';

const charEl = (ch, attrs = {}) => {
  const s = document.createElement('span');
  s.className = 'dr-char';
  s.textContent = ch;
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  return s;
};
const para = (text, idx = 0) => {
  const p = document.createElement('p');
  p.className = 'dr-para';
  p.setAttribute('data-paragraph-index', String(idx));
  for (const ch of text) p.appendChild(charEl(ch));
  return p;
};
const heading = (text) => {
  const h = document.createElement('h2');
  h.className = 'dr-para';
  for (const ch of text) h.appendChild(charEl(ch));
  return h;
};
const blank = () => {
  const p = document.createElement('p');
  p.className = 'dr-para';
  const filler = charEl(' ', { 'data-instant': 'true' });
  filler.classList.add('dr-empty');
  p.appendChild(filler);
  return p;
};
const sectionBreak = () => {
  const d = document.createElement('div');
  d.className = 'dr-section-break';
  return d;
};
const root = (...blocks) => {
  const r = document.createElement('div');
  for (const b of blocks) r.appendChild(b);
  return r;
};

test('buildSteps emits a char step per .dr-char and trims the trailing pause', () => {
  const steps = buildSteps(root(para('ab')));
  assert.deepEqual(steps.map((s) => s.kind), ['char', 'char']);
  assert.equal(steps[0].el.textContent, 'a');
});

test('buildSteps groups adjacent paragraphs into one unit (no pause between lines)', () => {
  const steps = buildSteps(root(para('ab', 0), para('cd', 1)));
  assert.deepEqual(steps.map((s) => s.kind), ['char', 'char', 'char', 'char']);
});

test('buildSteps pauses after a paragraph marked with a dropped-blank break', () => {
  const first = para('ab', 0);
  first.classList.add('dr-break-after');
  const steps = buildSteps(root(first, para('cd', 1)));
  assert.deepEqual(steps.map((s) => s.kind), ['char', 'char', 'pause', 'char', 'char']);
});

test('buildSteps pauses before and after a heading', () => {
  const steps = buildSteps(root(para('ab'), heading('H'), para('cd')));
  assert.deepEqual(steps.map((s) => s.kind), ['char', 'char', 'pause', 'char', 'pause', 'char', 'char']);
});

test('buildSteps pauses at a blank line without stopping on the blank itself', () => {
  const steps = buildSteps(root(para('ab'), blank(), para('cd')));
  assert.deepEqual(steps.map((s) => s.kind), ['char', 'char', 'pause', 'char', 'char', 'char']);
});

test('pauseAt "section" suppresses paragraph pauses but keeps section breaks', () => {
  const steps = buildSteps(root(para('a'), sectionBreak(), para('b')), { pauseAt: 'section' });
  assert.deepEqual(steps.map((s) => s.kind), ['char', 'pause', 'char']);
  assert.equal(steps[1].boundary, 'section');
});

test('a section break merges into and upgrades an adjacent paragraph pause', () => {
  const steps = buildSteps(root(para('a'), sectionBreak(), para('b')), { pauseAt: 'paragraph' });
  assert.deepEqual(steps.map((s) => s.kind), ['char', 'pause', 'char']);
  assert.equal(steps[1].boundary, 'section', 'paragraph pause upgraded to section');
});

test('data-instant is carried onto the char step', () => {
  const p = document.createElement('p');
  p.className = 'dr-para';
  p.appendChild(charEl('x', { 'data-instant': 'true' }));
  const steps = buildSteps(root(p));
  assert.equal(steps[0].instant, true);
});

test('data-comment-end emits a comment step per id, after the char', () => {
  const p = document.createElement('p');
  p.className = 'dr-para';
  p.appendChild(charEl('x', { 'data-comment-end': 'c1,c2' }));
  const steps = buildSteps(root(p));
  assert.deepEqual(steps.map((s) => s.kind), ['char', 'comment', 'comment']);
  assert.deepEqual([steps[1].commentId, steps[2].commentId], ['c1', 'c2']);
});

test('buildBlockSteps keeps the block trailing pause (for incremental build)', () => {
  const steps = buildBlockSteps(para('a'));
  assert.deepEqual(steps.map((s) => s.kind), ['char', 'pause']);
});

test('trimTrailingPauses removes only trailing pauses', () => {
  const steps = [{ kind: 'char' }, { kind: 'pause' }, { kind: 'pause' }];
  trimTrailingPauses(steps);
  assert.deepEqual(steps.map((s) => s.kind), ['char']);
});
