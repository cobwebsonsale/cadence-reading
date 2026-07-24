import {
  loadSettings,
  saveSettings,
  DEFAULTS,
  LIMITS,
  clampSpeed,
  clampLineHeight,
  clampContentWidth,
} from '../src/settings.js';
import { resolveTheme } from '../src/overlay.js';
import { listStoredPages, deleteStoredPage, clearAllNotes } from '../src/notes/storage.js';

const speed = document.getElementById('charsPerSec');
const speedVal = document.getElementById('speedVal');
const fontFamily = document.getElementById('fontFamily');
const focusMode = document.getElementById('focusMode');
const bionicMode = document.getElementById('bionicMode');
const commentsVisible = document.getElementById('commentsVisible');
const contentWidth = document.getElementById('contentWidth');
const contentWidthVal = document.getElementById('contentWidthVal');
const lineHeight = document.getElementById('lineHeight');
const lineHeightVal = document.getElementById('lineHeightVal');
const paperBg = document.getElementById('paperBg');
const paperBgVal = document.getElementById('paperBgVal');
const paperBgHint = document.getElementById('paperBgHint');
const paperFg = document.getElementById('paperFg');
const paperFgVal = document.getElementById('paperFgVal');
const paperFgHint = document.getElementById('paperFgHint');
const preview = document.getElementById('previewPaper');
const statusEl = document.getElementById('status');

const DEFAULT_READER_FONT = 'Georgia, "Iowan Old Style", Charter, Cambria, serif';

// The two pickers edit whichever theme is active; both palettes are held here.
const paper = { light: { bg: '', fg: '' }, dark: { bg: '', fg: '' } };
let activeTheme = 'light';

const themeSetting = () => radioValue('theme') || DEFAULTS.theme;

function loadPickersForTheme() {
  activeTheme = resolveTheme(themeSetting());
  paperBg.value = paper[activeTheme].bg;
  paperFg.value = paper[activeTheme].fg;
  paperBgHint.textContent = `The reading surface · ${activeTheme} mode`;
  paperFgHint.textContent = `The ink · ${activeTheme} mode`;
}

function reflectPreview() {
  preview.style.setProperty('--dr-reader-leading', lineHeight.value);
  preview.style.lineHeight = lineHeight.value;
  preview.style.width = `${(contentWidth.value / LIMITS.maxContentWidth) * 100}%`;
  preview.style.backgroundColor = paperBg.value;
  preview.style.color = paperFg.value;
  preview.style.fontFamily = fontFamily.value.trim() || DEFAULT_READER_FONT;
  contentWidthVal.textContent = contentWidth.value;
  lineHeightVal.textContent = Number(lineHeight.value).toFixed(2);
  paperBgVal.textContent = paperBg.value;
  paperFgVal.textContent = paperFg.value;
}

const radioValue = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;
const setRadio = (name, value) => {
  const r = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (r) r.checked = true;
};

async function init() {
  const settings = await loadSettings();
  speed.value = settings.charsPerSec;
  speedVal.textContent = settings.charsPerSec;
  setRadio('theme', settings.theme);
  focusMode.checked = settings.focusMode;
  bionicMode.checked = settings.bionicMode;
  commentsVisible.checked = settings.commentsVisible;
  fontFamily.value = settings.fontFamily;
  contentWidth.value = settings.contentWidth;
  lineHeight.value = settings.lineHeight;
  paper.light = { bg: settings.paperBg, fg: settings.paperFg };
  paper.dark = { bg: settings.paperBgDark, fg: settings.paperFgDark };
  loadPickersForTheme();
  reflectPreview();

  speed.addEventListener('input', () => (speedVal.textContent = speed.value));
  for (const c of [contentWidth, lineHeight, fontFamily]) {
    c.addEventListener('input', reflectPreview);
  }
  const onPaperInput = () => {
    paper[activeTheme] = { bg: paperBg.value, fg: paperFg.value };
    reflectPreview();
  };
  paperBg.addEventListener('input', onPaperInput);
  paperFg.addEventListener('input', onPaperInput);
  for (const r of document.querySelectorAll('input[name="theme"]')) {
    r.addEventListener('change', () => {
      loadPickersForTheme();
      reflectPreview();
    });
  }
  const controls = [
    speed,
    focusMode,
    bionicMode,
    commentsVisible,
    fontFamily,
    contentWidth,
    lineHeight,
    paperBg,
    paperFg,
    ...document.querySelectorAll('input[name="theme"]'),
  ];
  for (const c of controls) c.addEventListener('change', persist);
}

let statusTimer = 0;
async function persist() {
  const charsPerSec = clampSpeed(Number(speed.value) || DEFAULTS.charsPerSec);
  const patch = {
    charsPerSec,
    theme: radioValue('theme') || DEFAULTS.theme,
    focusMode: focusMode.checked,
    bionicMode: bionicMode.checked,
    commentsVisible: commentsVisible.checked,
    fontFamily: fontFamily.value.trim(),
    contentWidth: clampContentWidth(Number(contentWidth.value) || DEFAULTS.contentWidth),
    lineHeight: clampLineHeight(Number(lineHeight.value) || DEFAULTS.lineHeight),
    paperBg: paper.light.bg,
    paperFg: paper.light.fg,
    paperBgDark: paper.dark.bg,
    paperFgDark: paper.dark.fg,
  };
  speed.value = charsPerSec;
  speedVal.textContent = charsPerSec;
  await saveSettings(patch);
  statusEl.textContent = 'Saved';
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (statusEl.textContent = ''), 1500);
}

const dataEls = {
  list: document.getElementById('pageList'),
  summary: document.getElementById('dataSummary'),
  clearAll: document.getElementById('clearAll'),
  dialog: document.getElementById('confirmClear'),
  confirmText: document.getElementById('confirmText'),
  confirmCancel: document.getElementById('confirmCancel'),
  confirmOk: document.getElementById('confirmOk'),
};

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function pageRow(entry) {
  const li = document.createElement('li');
  li.className = 'page-item';

  const main = document.createElement('div');
  main.className = 'page-main';
  const link = /^https?:/.test(entry.href);
  const href = document.createElement(link ? 'a' : 'span');
  href.className = 'page-href';
  href.textContent = entry.title || entry.href;
  href.title = entry.href;
  if (link) {
    href.href = entry.href;
    href.target = '_blank';
    href.rel = 'noopener noreferrer';
  }
  const meta = document.createElement('div');
  meta.className = 'page-meta';
  const parts = [];
  if (entry.cards) parts.push(plural(entry.cards, 'card'));
  if (entry.hasPosition) parts.push('reading position');
  parts.push(formatBytes(entry.bytes));
  meta.textContent = parts.join(' · ');
  main.append(href, meta);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'danger';
  del.textContent = 'Delete';
  del.addEventListener('click', async () => {
    await deleteStoredPage(entry.id);
    renderPageList();
  });

  li.append(main, del);
  return li;
}

async function renderPageList() {
  const entries = await listStoredPages();
  dataEls.list.replaceChildren(...entries.map(pageRow));
  const totalBytes = entries.reduce((sum, e) => sum + e.bytes, 0);
  dataEls.summary.textContent = entries.length
    ? `(${plural(entries.length, 'page')}, ${formatBytes(totalBytes)})`
    : '(empty)';
  dataEls.clearAll.disabled = entries.length === 0;
}

function initData() {
  dataEls.clearAll.addEventListener('click', async () => {
    const entries = await listStoredPages();
    dataEls.confirmText.textContent = `Delete all stored data for ${plural(entries.length, 'page')}? This cannot be undone.`;
    dataEls.dialog.showModal();
  });
  dataEls.confirmCancel.addEventListener('click', () => dataEls.dialog.close());
  dataEls.confirmOk.addEventListener('click', async () => {
    dataEls.dialog.close();
    await clearAllNotes();
    renderPageList();
  });
  renderPageList();
}

init();
initData();
