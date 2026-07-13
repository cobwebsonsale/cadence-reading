import './helpers.js'; // jsdom globals
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeNode, anchorComments } from '../extension/src/render/comments.js';

// Build a content root of one-char .dr-char spans spelling `text`.
const contentOf = (text) => {
  const root = document.createElement('div');
  for (const ch of text) {
    const s = document.createElement('span');
    s.className = 'dr-char';
    s.textContent = ch;
    root.appendChild(s);
  }
  return root;
};
const comment = (id, value) => ({ id, quotedFileContent: value == null ? undefined : { value } });
const commentedText = (root) =>
  [...root.querySelectorAll('.dr-char.dr-commented')].map((s) => s.textContent).join('');

// Build a detached container from untrusted HTML, sanitize it, return resulting HTML/text.
const clean = (html) => {
  const div = document.createElement('div');
  div.innerHTML = html;
  sanitizeNode(div);
  return div;
};

test('keeps allowlisted formatting tags and their text', () => {
  const div = clean('<p>hi <b>bold</b> <i>it</i> <code>x</code></p>');
  assert.equal(div.querySelector('b')?.textContent, 'bold');
  assert.equal(div.querySelector('i')?.textContent, 'it');
  assert.equal(div.querySelector('code')?.textContent, 'x');
});

test('drops <script> entirely, including its text', () => {
  const div = clean('a<script>alert(1)</script>b');
  assert.equal(div.querySelector('script'), null);
  assert.equal(div.textContent, 'ab');
});

test('unwraps disallowed tags but preserves their text content', () => {
  const div = clean('<object data="evil">keep <b>me</b></object>');
  assert.equal(div.querySelector('object'), null);
  assert.equal(div.querySelector('b')?.textContent, 'me');
  assert.equal(div.textContent.replace(/\s+/g, ' ').trim(), 'keep me');
});

test('strips event handlers and style attributes on allowed tags', () => {
  const div = clean('<p onclick="x()" style="color:red" class="c">t</p>');
  const p = div.querySelector('p');
  assert.equal(p.hasAttribute('onclick'), false);
  assert.equal(p.hasAttribute('style'), false);
  assert.equal(p.hasAttribute('class'), false);
  assert.equal(p.textContent, 't');
});

test('keeps safe http/mailto links but drops javascript: and data: hrefs', () => {
  const ok = clean('<a href="https://example.com">go</a>').querySelector('a');
  assert.equal(ok.getAttribute('href'), 'https://example.com');
  assert.equal(ok.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(ok.getAttribute('target'), '_blank');

  const js = clean('<a href="javascript:alert(1)">x</a>').querySelector('a');
  assert.equal(js.hasAttribute('href'), false);
  assert.equal(js.textContent, 'x'); // text survives

  const data = clean('<a href="data:text/html,<script>">x</a>').querySelector('a');
  assert.equal(data.hasAttribute('href'), false);
});

test('removes onerror-style handlers on unwrapped/embedded content', () => {
  const div = clean('<img src="x" onerror="alert(1)">');
  // img is not allowlisted → unwrapped away entirely (no attributes leak through)
  assert.equal(div.querySelector('img'), null);
  assert.equal(div.innerHTML.includes('onerror'), false);
});

test('handles nested disallowed + code tags', () => {
  const div = clean('<form><object><script>bad()</script>text</object></form>');
  assert.equal(div.querySelector('form'), null);
  assert.equal(div.querySelector('object'), null);
  assert.equal(div.querySelector('script'), null);
  assert.equal(div.textContent, 'text');
});

test('anchorComments highlights the quoted span range and tags the start span', () => {
  const root = contentOf('Hello world');
  const records = anchorComments(root, [comment('c1', 'world')]);
  assert.equal(commentedText(root), 'world');
  const start = root.querySelector('[data-comment-end]');
  assert.equal(start.textContent, 'w', 'trigger tag on the first quoted char');
  assert.equal(start.getAttribute('data-comment-end').split(',').includes('c1'), true);
  assert.equal(records.get('c1').endSpanIndex, 6);
});

test('anchorComments leaves a missing or unmatched (stale) quote unanchored', () => {
  const root = contentOf('abc');
  anchorComments(root, [comment('c1', 'zzz'), comment('c2', null)]);
  // Neither can be placed, so nothing is tagged — they don't dump at the document start.
  assert.equal(root.querySelector('[data-comment-end]'), null);
});

test('anchorComments resolves duplicate quotes in document order', () => {
  const root = contentOf('ab cd ab');
  anchorComments(root, [comment('c1', 'ab'), comment('c2', 'ab')]);
  const spans = [...root.querySelectorAll('.dr-char')];
  assert.ok(spans[0].hasAttribute('data-comment-end'), 'first "ab" starts at index 0');
  assert.ok(spans[6].hasAttribute('data-comment-end'), 'second "ab" starts at index 6');
});
