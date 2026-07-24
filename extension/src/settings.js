export const DEFAULTS = Object.freeze({
  charsPerSec: 150,
  pauseAt: 'paragraph',
  commentsVisible: false,
  focusMode: true,
  bionicMode: false,
  theme: 'auto',
  fontFamily: '',
  lineHeight: 1.65,
  contentWidth: 900,
  paperBg: '#f6f0e3',
  paperFg: '#463f36',
  paperBgDark: '#24211c',
  paperFgDark: '#ddd6c8',
});

export const LIMITS = Object.freeze({
  minCharsPerSec: 5,
  maxCharsPerSec: 300,
  speedStep: 10,
  minLineHeight: 1.2,
  maxLineHeight: 2.2,
  lineHeightStep: 0.05,
  minContentWidth: 520,
  maxContentWidth: 1100,
  contentWidthStep: 20,
});

const clampRange = (value, min, max) => Math.max(min, Math.min(max, value));

export function clampLineHeight(value) {
  return clampRange(value, LIMITS.minLineHeight, LIMITS.maxLineHeight);
}

export function clampContentWidth(value) {
  return clampRange(value, LIMITS.minContentWidth, LIMITS.maxContentWidth);
}

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
