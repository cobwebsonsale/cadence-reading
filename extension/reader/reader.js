import { startSessionWithSource } from '../src/session.js';
import { localPdfSource, detectSource } from '../src/sources.js';
import { loadPosition, savePosition, saveDocEntry, listDocEntries, deleteDocEntry, positionKey } from '../src/notes/storage.js';
import { listDriveFiles } from '../src/rpc.js';
import * as persist from './persist.js';

const dropZone = document.getElementById('drop');
const fileInput = document.getElementById('file');
const errorEl = document.getElementById('error');
const loadingName = document.getElementById('loadingName');
const urlForm = document.getElementById('url-form');
const urlInput = document.getElementById('url-input');
const libraryEl = document.getElementById('library');
const libraryListEl = document.getElementById('library-list');
const driveBrowseBtn = document.getElementById('drive-browse');
const driveModal = document.getElementById('drive-modal');
const driveClose = document.getElementById('drive-close');
const driveSearch = document.getElementById('drive-search');
const driveList = document.getElementById('drive-list');

let activePosKey = null;
let positionCleared = false;

function setError(message) {
  errorEl.textContent = message || '';
}

function setLoading(name) {
  if (name) loadingName.textContent = `Opening ${name}…`;
  dropZone.classList.toggle('loading', !!name);
}

// Local files have no durable URL; key the reveal position by name so it survives across tabs.
const localPdfHref = (name) => `localpdf:${name || ''}`;

function runSession(bytes, name, startIndex) {
  const href = localPdfHref(name);
  activePosKey = positionKey(href);
  positionCleared = false;
  const onPosition = (index, done) => { if (!positionCleared) savePosition(href, done ? 0 : index); };
  const onPrepared = (title) => saveDocEntry(href, { title: title || name, type: 'localpdf' });
  return startSessionWithSource(localPdfSource(bytes, name), { startIndex, onPosition, onPrepared });
}

async function openFile(file) {
  setError('');
  if (!file) return;

  const looksLikePdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  if (!looksLikePdf) {
    setError('That doesn’t look like a PDF.');
    return;
  }

  setLoading(file.name);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    persist.saveDoc({ name: file.name, bytes });
    await runSession(bytes, file.name, await loadPosition(localPdfHref(file.name)));
  } catch (error) {
    setLoading(null);
    console.error('[cadence] failed to open local PDF:', error);
    setError(`Couldn’t open this PDF: ${error?.message || error}`);
  }
}

// Open a Google Doc / Drive PDF by pasted link, keying reveal position by the URL.
async function openUrl(rawUrl) {
  setError('');
  const url = (rawUrl || '').trim();
  if (!url) return;

  const source = detectSource(url);
  if (!source) {
    setError('Paste a Google Doc or Google Drive PDF link.');
    return;
  }

  // Reflect the opened doc in the page URL so a reload re-opens the same document.
  const params = new URLSearchParams(location.search);
  if (params.get('url') !== url) {
    params.set('url', url);
    history.replaceState(null, '', `${location.pathname}?${params}`);
  }

  setLoading(source.type === 'docs' ? 'document' : 'PDF');
  try {
    activePosKey = positionKey(url);
    positionCleared = false;
    const onPosition = (index, done) => { if (!positionCleared) savePosition(url, done ? 0 : index); };
    const onPrepared = (title) => saveDocEntry(url, { title, type: source.type });
    await startSessionWithSource(source, { startIndex: await loadPosition(url), onPosition, onPrepared });
  } catch (error) {
    setLoading(null);
    console.error('[cadence] failed to open link:', error);
    setError(`Couldn’t open that link: ${error?.message || error}`);
  }
}

const LIBRARY_ICONS = {
  docs: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/>',
  pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  localpdf: '<rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 14V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v9"/><path d="M7 17.5h.01"/>',
};

function prettyTitle(id) {
  try {
    const u = new URL(id);
    return `${u.hostname}${u.pathname}`.replace(/\/edit.*$/, '');
  } catch {
    return id.replace(/^localpdf:/, '');
  }
}

function relativeTime(ms) {
  if (!ms) return '';
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const units = [
    ['m', 60],
    ['h', 60],
    ['d', 24],
    ['mo', 30],
  ];
  let value = s;
  let label = 's';
  for (const [nextLabel, size] of units) {
    if (value < size) break;
    value = Math.floor(value / size);
    label = nextLabel;
  }
  return `${value}${label} ago`;
}

async function renderLibrary() {
  const entries = await listDocEntries();
  libraryEl.hidden = entries.length === 0;
  libraryListEl.replaceChildren();
  for (const entry of entries) {
    const local = entry.type === 'localpdf';
    const row = document.createElement('li');
    row.className = local ? 'library-row is-local' : 'library-row';
    row.innerHTML =
      `<svg class="library-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LIBRARY_ICONS[entry.type] || LIBRARY_ICONS.docs}</svg>` +
      `<div class="library-main"><div class="library-name"></div><div class="library-meta"></div></div>` +
      `<button class="library-del" type="button" title="Forget" aria-label="Forget this document">&times;</button>`;
    row.querySelector('.library-name').textContent = entry.title || prettyTitle(entry.id);

    const meta = [];
    if (entry.inProgress) meta.push('<span class="resume">Resume</span>');
    if (local) meta.push('local PDF');
    if (entry.notes) meta.push(`${entry.notes} note${entry.notes === 1 ? '' : 's'}`);
    if (entry.at) meta.push(relativeTime(entry.at));
    row.querySelector('.library-meta').innerHTML = meta.join(' · ');

    row.addEventListener('click', (e) => {
      if (e.target.closest('.library-del')) return;
      if (local) setError('Drop this PDF again to reopen it.');
      else openUrl(entry.id);
    });
    row.querySelector('.library-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteDocEntry(entry.id);
      renderLibrary();
    });
    libraryListEl.appendChild(row);
  }
}

urlForm.addEventListener('submit', (e) => {
  e.preventDefault();
  openUrl(urlInput.value);
});

// A ?url= param opens that document; otherwise restore the last local PDF for this tab.
const initialUrl = new URLSearchParams(location.search).get('url');
if (initialUrl) {
  openUrl(initialUrl);
} else {
  const restored = persist.loadDoc();
  if (restored) {
    runSession(restored.bytes, restored.name, await loadPosition(localPdfHref(restored.name)));
  }
}

fileInput.addEventListener('change', () => openFile(fileInput.files[0]));
fileInput.addEventListener('click', () => {
  fileInput.value = '';
});

dropZone.addEventListener('click', (e) => {
  if (e.target.tagName !== 'LABEL') fileInput.click();
});

for (const eventName of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropZone.classList.add('over');
  });
}
for (const eventName of ['dragleave', 'dragend']) {
  dropZone.addEventListener(eventName, () => dropZone.classList.remove('over'));
}
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('over');
  openFile(e.dataTransfer?.files?.[0]);
});

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

const DRIVE_DOC_MIME = 'application/vnd.google-apps.document';
const DRIVE_ITEM_ICONS = {
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/>',
  pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
};

const driveUrl = (file) =>
  file.mimeType === DRIVE_DOC_MIME
    ? `https://docs.google.com/document/d/${file.id}/edit`
    : `https://drive.google.com/file/d/${file.id}/view`;

function driveStatus(text, isError) {
  driveList.replaceChildren();
  const p = document.createElement('div');
  p.className = isError ? 'drive-status is-error' : 'drive-status';
  p.textContent = text;
  driveList.appendChild(p);
}

function renderDriveFiles(files) {
  if (!files.length) return driveStatus('No matching Docs or PDFs.');
  driveList.replaceChildren();
  for (const file of files) {
    const isDoc = file.mimeType === DRIVE_DOC_MIME;
    const row = document.createElement('div');
    row.className = 'drive-item';
    row.innerHTML =
      `<svg class="drive-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${isDoc ? DRIVE_ITEM_ICONS.doc : DRIVE_ITEM_ICONS.pdf}</svg>` +
      `<div class="drive-item-main"><div class="drive-item-name"></div><div class="drive-item-meta"></div></div>`;
    row.querySelector('.drive-item-name').textContent = file.name || 'Untitled';
    const meta = [isDoc ? 'Doc' : 'PDF'];
    const at = file.modifiedTime ? Date.parse(file.modifiedTime) : 0;
    if (at) meta.push(relativeTime(at));
    row.querySelector('.drive-item-meta').textContent = meta.join(' · ');
    row.addEventListener('click', () => {
      closeDriveModal();
      openUrl(driveUrl(file));
    });
    driveList.appendChild(row);
  }
}

let driveReqId = 0;
async function loadDriveFiles(query) {
  const reqId = ++driveReqId;
  driveStatus('Loading…');
  try {
    const files = await listDriveFiles(query);
    if (reqId === driveReqId) renderDriveFiles(files);
  } catch (error) {
    if (reqId === driveReqId) driveStatus(`Couldn't reach Drive: ${error?.message || error}`, true);
  }
}

let driveSearchTimer = 0;
function openDriveModal() {
  driveModal.hidden = false;
  driveSearch.value = '';
  driveSearch.focus();
  loadDriveFiles('');
}
function closeDriveModal() {
  driveModal.hidden = true;
  clearTimeout(driveSearchTimer);
}

driveBrowseBtn.addEventListener('click', openDriveModal);
driveClose.addEventListener('click', closeDriveModal);
driveModal.addEventListener('click', (e) => {
  if (e.target === driveModal) closeDriveModal();
});
driveSearch.addEventListener('input', () => {
  clearTimeout(driveSearchTimer);
  driveSearchTimer = setTimeout(() => loadDriveFiles(driveSearch.value.trim()), 250);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !driveModal.hidden) closeDriveModal();
});

renderLibrary();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') renderLibrary();
});
window.addEventListener('focus', renderLibrary);

chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== 'local') return;
  if (activePosKey && changes[activePosKey]?.newValue === undefined && activePosKey in changes) {
    positionCleared = true;
  }
  if (Object.values(changes).some((c) => c.newValue === undefined)) renderLibrary();
});
