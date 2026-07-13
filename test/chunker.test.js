import { test } from 'node:test';
import assert from 'node:assert/strict';

import './helpers.js';
import { buildParagraph, lineOf, LINE_H } from './helpers.js';
import { planChunks } from '../extension/src/reveal/chunker.js';

const breakLines = (para) => [...planChunks(para)].map(lineOf).sort((a, b) => a - b);

test('a paragraph shorter than the target prints whole', () => {
  assert.deepEqual(breakLines(buildParagraph(5, { sentenceEnds: [2] })), []);
  assert.deepEqual(breakLines(buildParagraph(7, { sentenceEnds: [3] })), []);
});

test('a paragraph with no sentence end prints whole, however long', () => {
  assert.deepEqual(breakLines(buildParagraph(10)), []);
  assert.deepEqual(breakLines(buildParagraph(30)), []);
});

test('finishes the sentence: breaks at the first sentence end at/after the target', () => {
  assert.deepEqual(breakLines(buildParagraph(14, { sentenceEnds: [9] })), [10]);
});

test('breaks at the target when a sentence ended within the target line', () => {
  assert.deepEqual(breakLines(buildParagraph(14, { sentenceEnds: [6, 13] })), [7]);
});

test('a sentence end before the target is skipped (we are mid next sentence)', () => {
  assert.deepEqual(breakLines(buildParagraph(20, { sentenceEnds: [3, 11] })), [12]);
});

test('a tiny trailing remainder merges into the previous chunk', () => {
  assert.deepEqual(breakLines(buildParagraph(9, { sentenceEnds: [6] })), []);
});

test('multiple chunks across a long paragraph, each ending on a sentence', () => {
  assert.deepEqual(breakLines(buildParagraph(24, { sentenceEnds: [6, 13, 20] })), [7, 14, 21]);
});

test('breaks at the next sentence char even when it starts mid-line', () => {
  const para = document.createElement('p');
  para.className = 'dr-para';
  const add = (text, line) => {
    for (const ch of text) {
      const span = document.createElement('span');
      span.className = 'dr-char';
      span.textContent = ch;
      Object.defineProperty(span, 'offsetTop', { value: line * LINE_H, configurable: true });
      para.appendChild(span);
    }
  };
  for (let l = 0; l < 8; l++) add('filler text', l);
  add('end. Start more', 8);
  for (let l = 9; l < 14; l++) add('more filler', l);

  const boundary = [...planChunks(para)];
  assert.equal(boundary.length, 1, 'one break');
  assert.equal(boundary[0].textContent, 'S', 'breaks at the start of the next sentence');
  assert.equal(lineOf(boundary[0]), 8, 'on the same line as the sentence end');
});

const paraFromLines = (lines) => {
  const para = document.createElement('p');
  para.className = 'dr-para';
  lines.forEach((text, line) => {
    for (const ch of text) {
      const span = document.createElement('span');
      span.className = 'dr-char';
      span.textContent = ch;
      Object.defineProperty(span, 'offsetTop', { value: line * LINE_H, configurable: true });
      para.appendChild(span);
    }
  });
  return para;
};

const filler = (n, text = 'filler words here') => Array.from({ length: n }, () => text);

test('does not break at an abbreviation period (etc., et al.)', () => {
  const lines = filler(12);
  lines[8] = 'text with etc. and more here';
  lines[9] = 'work by Smith et al. showed that';
  // no real sentence end anywhere → no chunk break
  assert.deepEqual(breakLines(paraFromLines(lines)), []);
});

test('still breaks at a real sentence end', () => {
  const lines = filler(12);
  lines[8] = 'the idea ends right here. A new';
  assert.deepEqual(breakLines(paraFromLines(lines)), [8]);
});
