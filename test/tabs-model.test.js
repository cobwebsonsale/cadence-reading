import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  listTabs,
  resolveTabContent,
  resolveTabId,
  tabTitle,
} from '../extension/src/render/tabs-model.js';

const bodyOf = (text) => ({ body: { content: [{ paragraph: { elements: [{ textRun: { content: text } }] } }] } });

const doc = {
  tabs: [
    { tabProperties: { tabId: 't.0', title: 'Overview' }, documentTab: bodyOf('overview') },
    {
      tabProperties: { tabId: 't.1', title: 'Details' },
      documentTab: bodyOf('details'),
      childTabs: [{ tabProperties: { tabId: 't.2', title: 'Methods' }, documentTab: bodyOf('methods') }],
    },
  ],
};

const textOf = (model) => model.content[0].paragraph.elements[0].textRun.content;

test('listTabs flattens nested tabs with nesting levels', () => {
  assert.deepEqual(listTabs(doc), [
    { tabId: 't.0', title: 'Overview', level: 0 },
    { tabId: 't.1', title: 'Details', level: 0 },
    { tabId: 't.2', title: 'Methods', level: 1 },
  ]);
});

test('listTabs is empty for a doc with no tabs', () => {
  assert.deepEqual(listTabs({ body: { content: [] } }), []);
});

test('resolveTabContent selects the requested tab, including a nested one', () => {
  assert.equal(textOf(resolveTabContent(doc, 't.1')), 'details');
  assert.equal(textOf(resolveTabContent(doc, 't.2')), 'methods');
});

test('resolveTabContent falls back to the first tab with a body', () => {
  assert.equal(textOf(resolveTabContent(doc, null)), 'overview');
  assert.equal(textOf(resolveTabContent(doc, 'nonexistent')), 'overview');
});

test('resolveTabContent reads a legacy (tab-less) doc', () => {
  assert.equal(textOf(resolveTabContent(bodyOf('plain'), null)), 'plain');
});

test('resolveTabId returns the resolved id (requested or fallback)', () => {
  assert.equal(resolveTabId(doc, 't.2'), 't.2');
  assert.equal(resolveTabId(doc, null), 't.0');
  assert.equal(resolveTabId(bodyOf('plain'), null), null);
});

test('tabTitle returns the resolved tab title', () => {
  assert.equal(tabTitle(doc, 't.1'), 'Details');
  assert.equal(tabTitle(doc, null), 'Overview');
});
