import { test } from 'node:test';
import assert from 'node:assert/strict';

import { clampSpeed, DEFAULTS, LIMITS, loadSettings, saveSettings, onSettingsChanged } from '../extension/src/settings.js';

test('clampSpeed keeps values within limits', () => {
  assert.equal(clampSpeed(1), LIMITS.minCharsPerSec);
  assert.equal(clampSpeed(99999), LIMITS.maxCharsPerSec);
  assert.equal(clampSpeed(100), 100);
});

test('DEFAULTS has the expected shape and is frozen', () => {
  assert.equal(DEFAULTS.pauseAt, 'paragraph');
  assert.equal(DEFAULTS.theme, 'auto');
  assert.ok(Object.isFrozen(DEFAULTS));
});

test('loadSettings merges stored values over defaults; saveSettings writes the patch', async () => {
  const store = {};
  const setCalls = [];
  globalThis.chrome = {
    storage: {
      sync: {
        get: async (defaults) => ({ ...defaults, ...store }),
        set: async (patch) => setCalls.push(patch),
      },
      onChanged: { addListener() {}, removeListener() {} },
    },
  };
  try {
    store.charsPerSec = 40;
    const settings = await loadSettings();
    assert.equal(settings.charsPerSec, 40);
    assert.equal(settings.theme, 'auto', 'unset keys fall back to defaults');

    await saveSettings({ theme: 'dark' });
    assert.deepEqual(setCalls, [{ theme: 'dark' }]);
  } finally {
    delete globalThis.chrome;
  }
});

test('onSettingsChanged only forwards known sync-area keys and unsubscribes', () => {
  let listener = null;
  const patches = [];
  globalThis.chrome = {
    storage: {
      onChanged: {
        addListener: (fn) => (listener = fn),
        removeListener: (fn) => (listener === fn ? (listener = null) : null),
      },
    },
  };
  try {
    const off = onSettingsChanged((patch) => patches.push(patch));
    listener({ charsPerSec: { newValue: 50 }, junkKey: { newValue: 1 } }, 'sync');
    listener({ charsPerSec: { newValue: 60 } }, 'local'); // wrong area, ignored
    assert.deepEqual(patches, [{ charsPerSec: 50 }]);
    off();
    assert.equal(listener, null, 'unsubscribe removed the listener');
  } finally {
    delete globalThis.chrome;
  }
});
