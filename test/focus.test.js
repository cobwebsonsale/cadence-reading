import { test } from 'node:test';
import assert from 'node:assert/strict';

import './helpers.js';
import { dispatchWheel } from './helpers.js';
import { createFocus } from '../extension/src/reveal/focus.js';

const span = () => document.createElement('span');

test('setEnabled toggles the dr-focus class on the root', () => {
  const root = document.createElement('div');
  const focus = createFocus(root);
  assert.equal(root.classList.contains('dr-focus'), false);
  focus.setEnabled(true);
  assert.ok(root.classList.contains('dr-focus'));
  focus.setEnabled(false);
  assert.equal(root.classList.contains('dr-focus'), false);
  focus.destroy();
});

test('mark tags chars as the current chunk', () => {
  const root = document.createElement('div');
  const focus = createFocus(root);
  const a = span();
  const b = span();
  focus.mark(a);
  focus.mark(b);
  assert.ok(a.classList.contains('dr-current-chunk'));
  assert.ok(b.classList.contains('dr-current-chunk'));
  focus.destroy();
});

test('startRender ages the trail: current fades back one tier per render, then to the floor', () => {
  const root = document.createElement('div');
  const focus = createFocus(root);
  const a = span();
  focus.mark(a);

  focus.startRender();
  assert.equal(a.classList.contains('dr-current-chunk'), false);
  assert.ok(a.classList.contains('dr-recent-1'), 'ages to recent-1');

  focus.startRender();
  assert.ok(a.classList.contains('dr-recent-2'), 'ages to recent-2');

  focus.startRender();
  assert.equal(a.classList.contains('dr-recent-1'), false);
  assert.equal(a.classList.contains('dr-recent-2'), false, 'drops to the floor');
  focus.destroy();
});

test('reset clears every trail tier', () => {
  const root = document.createElement('div');
  const focus = createFocus(root);
  const a = span();
  const b = span();
  focus.mark(a);
  focus.startRender();
  focus.mark(b);
  assert.ok(a.classList.contains('dr-recent-1'));
  assert.ok(b.classList.contains('dr-current-chunk'));

  focus.reset();
  assert.equal(a.className, '');
  assert.equal(b.className, '');
  focus.destroy();
});

test('scroll-up suspends dimming while focus is enabled', () => {
  const root = document.createElement('div');
  const focus = createFocus(root);
  focus.setEnabled(true);

  dispatchWheel(-10);
  assert.ok(root.classList.contains('dr-focus-suspend'));
  focus.destroy();
});

test('the next render clears the scroll-up suspend (re-fades)', () => {
  const root = document.createElement('div');
  const focus = createFocus(root);
  focus.setEnabled(true);
  dispatchWheel(-10);
  assert.ok(root.classList.contains('dr-focus-suspend'));

  focus.startRender();
  assert.equal(root.classList.contains('dr-focus-suspend'), false);
  focus.destroy();
});

test('scroll in either direction suspends while enabled, but not while disabled', () => {
  const root = document.createElement('div');
  const focus = createFocus(root);

  focus.setEnabled(true);
  dispatchWheel(10);
  assert.ok(root.classList.contains('dr-focus-suspend'), 'scroll-down suspends');

  focus.setEnabled(false);
  dispatchWheel(-10);
  assert.equal(root.classList.contains('dr-focus-suspend'), false, 'disabled: no suspend');
  focus.destroy();
});

test('disabling focus clears both focus classes', () => {
  const root = document.createElement('div');
  const focus = createFocus(root);
  focus.setEnabled(true);
  dispatchWheel(-10);
  focus.setEnabled(false);
  assert.equal(root.classList.contains('dr-focus'), false);
  assert.equal(root.classList.contains('dr-focus-suspend'), false);
  focus.destroy();
});

test('destroy removes the wheel listener', () => {
  const root = document.createElement('div');
  const focus = createFocus(root);
  focus.setEnabled(true);
  focus.destroy();
  dispatchWheel(-10);
  assert.equal(root.classList.contains('dr-focus-suspend'), false);
});
