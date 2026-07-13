import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { attachInput } from '../extension/src/reveal/input.js';

const recorder = (names) => {
  const calls = {};
  const obj = {};
  for (const n of names) obj[n] = (...args) => (calls[n] ||= []).push(args);
  return { obj, calls };
};
const mockLoop = () => recorder(['advance', 'setBoost', 'rewind', 'goToParagraph', 'setSpeed']);
const mockSession = () => {
  const r = recorder(['toggleComments', 'toggleFocus', 'toggleBionic', 'toggleNotes', 'end']);
  r.obj.settings = { charsPerSec: 100 };
  return r;
};

const press = (k, { target = document.body, ...opts } = {}) =>
  target.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
const release = (k, target = document.body) =>
  target.dispatchEvent(new window.KeyboardEvent('keyup', { key: k, bubbles: true, cancelable: true }));

const withInput = (fn) => {
  const loop = mockLoop();
  const session = mockSession();
  const detach = attachInput(loop.obj, session.obj);
  try {
    fn(loop, session);
  } finally {
    detach();
  }
};

test('a space tap advances one chunk without boosting', () => {
  withInput((loop) => {
    press(' ');
    assert.equal(loop.calls.advance?.length, 1, 'advanced once');
    assert.equal(loop.calls.setBoost, undefined, 'a tap never boosts');
    release(' ');
    assert.deepEqual(loop.calls.setBoost, [[false]], 'keyup only unboosts');
  });
});

test('holding space (auto-repeat) engages boost, not repeated advances', () => {
  withInput((loop) => {
    press(' '); // initial tap
    press(' ', { repeat: true }); // auto-repeat while held
    press(' ', { repeat: true });
    assert.equal(loop.calls.advance?.length, 1, 'only the initial tap advances');
    assert.deepEqual(loop.calls.setBoost, [[true], [true]], 'repeats boost');
    release(' ');
    assert.deepEqual(loop.calls.setBoost, [[true], [true], [false]]);
  });
});

test('arrows map to rewind and paragraph navigation', () => {
  withInput((loop) => {
    press('ArrowLeft');
    press('ArrowDown');
    press('ArrowUp');
    assert.equal(loop.calls.rewind?.length, 1);
    assert.deepEqual(loop.calls.goToParagraph, [[1], [-1]]);
  });
});

test('letter keys toggle reader features', () => {
  withInput((loop, session) => {
    press('c');
    press('F');
    press('b');
    press('n');
    assert.equal(session.calls.toggleComments?.length, 1);
    assert.equal(session.calls.toggleFocus?.length, 1);
    assert.equal(session.calls.toggleBionic?.length, 1);
    assert.equal(session.calls.toggleNotes?.length, 1);
  });
});

test('bracket keys change speed via clampSpeed and persist', () => {
  globalThis.chrome = { storage: { sync: { set: async () => {} } } };
  try {
    withInput((loop, session) => {
      press('[');
      assert.deepEqual(loop.calls.setSpeed, [[90]]);
      assert.equal(session.obj.settings.charsPerSec, 90);
    });
  } finally {
    delete globalThis.chrome;
  }
});

test('Escape ends the session', () => {
  withInput((loop, session) => {
    press('Escape');
    assert.equal(session.calls.end?.length, 1);
  });
});

test('keystrokes in editable targets and with modifiers are ignored', () => {
  withInput((loop) => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    press(' ', { target: input });
    press(' ', { metaKey: true });
    press(' ', { ctrlKey: true });
    input.remove();
    assert.equal(loop.calls.advance, undefined, 'no advance from editable/modifier keys');
  });
});

test('detach removes the listeners', () => {
  const loop = mockLoop();
  const session = mockSession();
  const detach = attachInput(loop.obj, session.obj);
  detach();
  press(' ');
  assert.equal(loop.calls.advance, undefined);
});
