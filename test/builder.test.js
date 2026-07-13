import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildDocument, reconcileChips } from '../extension/src/render/builder.js';

const build = (doc, settings = {}) => {
  const mount = document.createElement('div');
  buildDocument(doc, { mount, settings });
  return mount;
};
const textRun = (content, textStyle) => ({ textRun: { content, textStyle } });
const para = (elements, paragraphStyle, bullet) => ({ paragraph: { elements, paragraphStyle, bullet } });
const docWith = (content, extra = {}) => ({ body: { content }, ...extra });

test('builds a paragraph of char spans and skips newlines', () => {
  const mount = build(docWith([para([textRun('Hi\n')])]));
  const p = mount.querySelector('p.dr-para');
  assert.equal(p.getAttribute('data-paragraph-index'), '0');
  assert.equal(mount.querySelectorAll('.dr-char').length, 2);
});

test('named styles map to heading tags', () => {
  assert.ok(build(docWith([para([textRun('T')], { namedStyleType: 'HEADING_2' })])).querySelector('h2.dr-para'));
  assert.ok(build(docWith([para([textRun('T')], { namedStyleType: 'TITLE' })])).querySelector('h1.dr-para'));
});

test('linked text runs are wrapped in an anchor', () => {
  const mount = build(docWith([para([textRun('x', { link: { url: 'https://x.io' } })])]));
  const a = mount.querySelector('a.dr-link');
  assert.equal(a.getAttribute('href'), 'https://x.io');
  assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(a.querySelector('.dr-char').textContent, 'x');
});

test('vertical tab / form feed become line breaks', () => {
  const mount = build(docWith([para([textRun('ab')])]));
  assert.equal(mount.querySelectorAll('br').length, 1);
  assert.equal(mount.querySelectorAll('.dr-char').length, 2);
});

test('an empty paragraph is dropped to keep the reader concise', () => {
  const mount = build(docWith([para([])]));
  assert.equal(mount.querySelector('.dr-para'), null, 'no blank line is rendered');
});

test('section breaks and horizontal rules render markers', () => {
  assert.ok(build(docWith([{ sectionBreak: {} }])).querySelector('.dr-section-break'));
  const mount = build(docWith([para([{ horizontalRule: {} }, { footnoteReference: { footnoteNumber: '1' } }])]));
  assert.ok(mount.querySelector('.dr-hr'));
  assert.equal(mount.querySelector('sup.dr-footnote-ref')?.textContent, '1');
});

test('a numbered list item renders an instant bullet with the glyph', () => {
  const lists = { L1: { listProperties: { nestingLevels: [{ glyphType: 'DECIMAL', glyphFormat: '%0.' }] } } };
  const mount = build(docWith([para([textRun('item')], {}, { listId: 'L1', nestingLevel: 0 })], { lists }));
  const item = mount.querySelector('p.dr-list-item');
  assert.ok(item);
  const bullet = item.querySelector('.dr-bullet');
  assert.equal(bullet.getAttribute('data-instant'), 'true');
  assert.equal(bullet.textContent, '1. ');
});

test('resolves content from the tabs model when present', () => {
  const doc = { tabs: [{ documentTab: { body: { content: [para([textRun('T')])] } } }] };
  assert.equal(build(doc).querySelectorAll('.dr-char').length, 1);
});

test('builds a table with cell content', () => {
  const table = { table: { tableRows: [{ tableCells: [{ content: [para([textRun('C')])] }] }] } };
  const mount = build(docWith([table]));
  assert.ok(mount.querySelector('table.dr-table td.dr-cell'));
  assert.equal(mount.querySelector('td.dr-cell .dr-char').textContent, 'C');
});

test('an explicit-width table takes its column total; cells get their widths', () => {
  const table = {
    table: {
      tableStyle: { tableColumnProperties: [{ width: { magnitude: 72 } }, { width: { magnitude: 144 } }] },
      tableRows: [{ tableCells: [{ content: [para([textRun('A')])] }, { content: [para([textRun('B')])] }] }],
    },
  };
  const mount = build(docWith([table]));
  const tableEl = mount.querySelector('table.dr-table');
  assert.equal(tableEl.style.width, '288px', '72pt + 144pt = 216pt → 288px total');
  const cells = mount.querySelectorAll('td.dr-cell');
  assert.equal(cells[0].style.width, '96px');
  assert.equal(cells[1].style.width, '192px');
});

test('an evenly-distributed table gets no inline width (fills the paper, wraps)', () => {
  const table = {
    table: {
      tableStyle: { tableColumnProperties: [{ widthType: 'EVENLY_DISTRIBUTED' }, { widthType: 'EVENLY_DISTRIBUTED' }] },
      tableRows: [{ tableCells: [{ content: [para([textRun('A')])] }, { content: [para([textRun('B')])] }] }],
    },
  };
  const mount = build(docWith([table]));
  assert.equal(mount.querySelector('table.dr-table').style.width, '');
  assert.equal(mount.querySelector('td.dr-cell').style.width, '');
});

test('a leading soft line break is dropped (no stray empty line)', () => {
  const mount = build(docWith([para([textRun('Hello')])]));
  const p = mount.querySelector('.dr-para');
  assert.notEqual(p.firstElementChild?.tagName, 'BR', 'no leading <br>');
  assert.equal(p.textContent.trim(), 'Hello');
});

test('a soft line break between text lines is kept', () => {
  const mount = build(docWith([para([textRun('ab')])]));
  assert.equal(mount.querySelectorAll('.dr-para br').length, 1);
});

test('builds an inline image object', () => {
  const doc = docWith([para([{ inlineObjectElement: { inlineObjectId: 'obj1' } }])], {
    inlineObjects: { obj1: { inlineObjectProperties: { embeddedObject: { imageProperties: { contentUri: 'https://img' } } } } },
  });
  const obj = build(doc).querySelector('.dr-inline-object.dr-char');
  assert.equal(obj.getAttribute('data-instant'), 'true');
  assert.equal(obj.querySelector('img').getAttribute('src'), 'https://img');
});

test('a dropped blank between paragraphs marks a break, not a tight join', () => {
  const mount = build(docWith([para([textRun('a')]), para([textRun('')]), para([textRun('b')])]));
  const paras = [...mount.querySelectorAll('.dr-para')];
  assert.equal(paras.length, 2, 'the blank paragraph is dropped');
  assert.ok(paras[0].classList.contains('dr-break-after'));
  assert.ok(!paras[0].classList.contains('dr-tight'));
});

test('two plain paragraphs with no blank between them join tightly', () => {
  const mount = build(docWith([para([textRun('a')]), para([textRun('b')])]));
  const first = mount.querySelector('.dr-para');
  assert.ok(first.classList.contains('dr-tight'));
  assert.ok(!first.classList.contains('dr-break-after'));
});

test('authored paragraph spacing (no blank line) is a break, not a tight run', () => {
  const mount = build(
    docWith([
      para([textRun('a')], { spaceBelow: { magnitude: 12 } }),
      para([textRun('b')], { spaceAbove: { magnitude: 12 } }),
    ])
  );
  const first = mount.querySelector('.dr-para');
  assert.ok(first.classList.contains('dr-break-after'), 'a visible gap breaks the run');
  assert.ok(!first.classList.contains('dr-tight'));
});

test('a short, larger-than-body paragraph is treated as a heading', () => {
  const mount = build(
    docWith([
      para([textRun('This is ordinary body text that sets the dominant size.', { fontSize: { magnitude: 11 } })]),
      para([textRun('A Section Title', { fontSize: { magnitude: 18 } })]),
    ])
  );
  const h = mount.querySelector('h2.dr-para');
  assert.ok(h && /A Section Title/.test(h.textContent), 'larger short line reads as a heading');
});

test('a short all-bold paragraph is treated as a heading', () => {
  const mount = build(
    docWith([
      para([textRun('Ordinary body text that sets the dominant body size here.', { fontSize: { magnitude: 11 } })]),
      para([textRun('Overview', { fontSize: { magnitude: 12 }, bold: true })]),
    ])
  );
  assert.ok(mount.querySelector('h4.dr-para'), 'a bold short line reads as a heading');
});

test('a long body sentence is not mistaken for a heading', () => {
  const mount = build(
    docWith([para([textRun('This is a normal body sentence, at body size, that should stay a paragraph.')])])
  );
  assert.ok(mount.querySelector('p.dr-para'));
  assert.equal(mount.querySelector('h2, h3, h4'), null);
});

test('a left-indented paragraph keeps its indent', () => {
  const mount = build(docWith([para([textRun('Quoted line')], { indentStart: { magnitude: 36 } })]));
  assert.equal(mount.querySelector('.dr-para').style.marginInlineStart, '48px');
});

test('a first-line indent renders and marks a paragraph break', () => {
  const mount = build(
    docWith([
      para([textRun('First paragraph.')]),
      para([textRun('Second paragraph.')], { indentFirstLine: { magnitude: 36 } }),
    ])
  );
  const paras = [...mount.querySelectorAll('.dr-para')];
  assert.equal(paras[1].style.textIndent, '48px');
  assert.ok(paras[0].classList.contains('dr-break-after'), 'first-line indent delimits a new paragraph');
});

test('consecutive same-list items collapse their spacing and group (like Google)', () => {
  const listStyle = { lists: { L1: { listProperties: { nestingLevels: [{ glyphSymbol: '•' }] } } } };
  // Each item reports 12pt spacing, but Google collapses it between same-list items.
  const item = (t) =>
    para([textRun(t)], { spaceAbove: { magnitude: 12 }, spaceBelow: { magnitude: 12 } }, { listId: 'L1', nestingLevel: 0 });
  const items = [...build(docWith([item('One'), item('Two'), item('Three')], listStyle)).querySelectorAll('.dr-list-item')];
  assert.equal(items.length, 3);
  assert.ok(items[0].classList.contains('dr-tight'), 'items group, not break');
  assert.ok(!items[0].classList.contains('dr-break-after'));
  assert.equal(items[0].style.marginBottom, '', 'the invented between-item gap is collapsed');
});

test('a paragraph before a list still breaks into it', () => {
  const listStyle = { lists: { L1: { listProperties: { nestingLevels: [{ glyphSymbol: '•' }] } } } };
  const item = (t) =>
    para([textRun(t)], { spaceAbove: { magnitude: 12 }, spaceBelow: { magnitude: 12 } }, { listId: 'L1', nestingLevel: 0 });
  const paras = [
    ...build(docWith([para([textRun('Intro:')], { spaceBelow: { magnitude: 12 } }), item('One'), item('Two')], listStyle)).querySelectorAll('.dr-para'),
  ];
  assert.ok(paras[0].classList.contains('dr-break-after'), 'the gap before the list is kept');
  assert.ok(paras[1].classList.contains('dr-tight'), 'items within the list group');
});

test('paragraph index increments across blocks', () => {
  const mount = build(docWith([para([textRun('a')]), para([textRun('b')])]));
  const indices = [...mount.querySelectorAll('.dr-para')].map((p) => p.getAttribute('data-paragraph-index'));
  assert.deepEqual(indices, ['0', '1']);
});

test('reconcileChips fills a bare label paragraph from the text export', () => {
  const mount = build(docWith([para([textRun('Status of this document: ')])]));
  reconcileChips(mount, 'Author: Yuki\nStatus of this document: Ready for Review\n');
  assert.ok(mount.querySelector('.dr-para').textContent.includes('Ready for Review'));
});

test('reconcileChips restores a dropped leading chip from the text export', () => {
  const mount = build(docWith([para([textRun(' : Team')])]));
  reconcileChips(mount, 'Person : Team\n');
  const cell = mount.querySelector('.dr-para');
  assert.equal(cell.textContent.replace(/\s+/g, ' ').trim(), 'Person : Team');
  assert.equal(cell.querySelector('.dr-chip')?.textContent, 'Person');
});

test('reconcileChips leaves an intentional leading colon (no dropped chip) alone', () => {
  const mount = build(docWith([para([textRun(': Team')])]));
  reconcileChips(mount, ': Team\n');
  assert.equal(mount.querySelector('.dr-chip'), null);
});

test('reconcileChips leaves paragraphs without a matching label alone', () => {
  const mount = build(docWith([para([textRun('Just a sentence.')])]));
  const before = mount.querySelector('.dr-para').textContent;
  reconcileChips(mount, 'Status: Ready\n');
  assert.equal(mount.querySelector('.dr-para').textContent, before);
});
