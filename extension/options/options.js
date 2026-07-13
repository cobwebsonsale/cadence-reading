import { loadSettings, saveSettings, DEFAULTS, clampSpeed } from '../src/settings.js';
import { listStoredPages, deleteStoredPage, clearAllNotes } from '../src/notes/storage.js';

const speed = document.getElementById('charsPerSec');
const speedVal = document.getElementById('speedVal');
const showResolved = document.getElementById('showResolvedComments');
const fontFamily = document.getElementById('fontFamily');
const statusEl = document.getElementById('status');

const radioValue = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;
const setRadio = (name, value) => {
  const r = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (r) r.checked = true;
};

async function init() {
  const settings = await loadSettings();
  speed.value = settings.charsPerSec;
  speedVal.textContent = settings.charsPerSec;
  setRadio('pauseAt', settings.pauseAt);
  setRadio('theme', settings.theme);
  showResolved.checked = settings.showResolvedComments;
  fontFamily.value = settings.fontFamily;

  speed.addEventListener('input', () => (speedVal.textContent = speed.value));
  const controls = [
    speed,
    showResolved,
    fontFamily,
    ...document.querySelectorAll('input[name="pauseAt"], input[name="theme"]'),
  ];
  for (const c of controls) c.addEventListener('change', persist);
}

let statusTimer = 0;
async function persist() {
  const charsPerSec = clampSpeed(Number(speed.value) || DEFAULTS.charsPerSec);
  const patch = {
    charsPerSec,
    pauseAt: radioValue('pauseAt') || DEFAULTS.pauseAt,
    theme: radioValue('theme') || DEFAULTS.theme,
    showResolvedComments: showResolved.checked,
    fontFamily: fontFamily.value.trim(),
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
