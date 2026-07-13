import './helpers.js'; // sets up global document (jsdom)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildBlock } from '../extension/src/pdf/pdf-builder.js';

const run = (text, extra = {}) => ({ text, bold: false, italic: false, ...extra });
const render = (block) => {
  const mount = document.createElement('div');
  const el = buildBlock(block, 0);
  if (el) mount.appendChild(el);
  return mount;
};

test('buildBlock renders an undecodable glyph run as an inline image', () => {
  const mount = render({
    kind: 'paragraph',
    runs: [run('P '), run('□', { glyph: { dataURL: 'data:image/png;base64,AAAA' } }), run(' .05')],
  });

  const img = mount.querySelector('.dr-char.dr-glyph .dr-glyph-img');
  assert.ok(img, 'glyph rendered as an image');
  assert.equal(img.getAttribute('src'), 'data:image/png;base64,AAAA');
  // still one .dr-char per surrounding character
  assert.equal(mount.querySelectorAll('.dr-char').length, 'P '.length + 1 + ' .05'.length);
});

test('buildBlock wraps scripted runs in sup/sub with their chars still revealable', () => {
  const mount = render({
    kind: 'paragraph',
    runs: [run('D'), run('j', { script: 'sub' }), run('NF', { script: 'super' })],
  });

  assert.equal(mount.querySelector('sub')?.textContent, 'j');
  assert.equal(mount.querySelector('sup')?.textContent, 'NF');
  // every character remains a .dr-char so the reveal walker still steps through it
  assert.equal(mount.querySelectorAll('.dr-char').length, 'DjNF'.length);
  assert.equal(mount.querySelector('sub').querySelectorAll('.dr-char').length, 1);
});

test('buildBlock falls back to a box when the glyph image is unavailable', () => {
  const mount = render({ kind: 'paragraph', runs: [run('□', { glyph: {} })] });

  const span = mount.querySelector('.dr-char.dr-glyph');
  assert.ok(span);
  assert.equal(span.querySelector('img'), null);
  assert.equal(span.textContent, '□');
});
