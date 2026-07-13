export const DEFAULTS = Object.freeze({
  charsPerSec: 150,
  pauseAt: 'paragraph',
  showResolvedComments: false,
  theme: 'auto',
  fontFamily: '',
});

export const LIMITS = Object.freeze({
  minCharsPerSec: 5,
  maxCharsPerSec: 300,
  speedStep: 10,
});

export async function loadSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(patch) {
  await chrome.storage.sync.set(patch);
}

export function onSettingsChanged(callback) {
  const listener = (changes, area) => {
    if (area !== 'sync') return;
    const patch = {};
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in DEFAULTS) patch[key] = newValue;
    }
    if (Object.keys(patch).length) callback(patch);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export function clampSpeed(value) {
  return Math.max(LIMITS.minCharsPerSec, Math.min(LIMITS.maxCharsPerSec, value));
}
