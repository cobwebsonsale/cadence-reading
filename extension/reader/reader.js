import { startSessionWithSource } from '../src/session.js';
import { localPdfSource, detectSource } from '../src/sources.js';
import { loadPosition, savePosition, saveDocEntry, listDocEntries, deleteDocEntry, positionKey, DOC_PREFIX } from '../src/notes/storage.js';
import { parseDocRef, synthesizeUrl, DRIVE_DOC_MIME, DRIVE_PDF_MIME } from '../src/gdocs.js';
import * as persist from './persist.js';
import { handlesSupported, saveHandle, loadHandle, deleteHandle, ensureReadPermission } from './handles.js';
import { openPicker } from './picker.js';
import { loadSettings, onSettingsChanged } from '../src/settings.js';

async function applyPageTheme() {
  const { theme } = await loadSettings();
  document.documentElement.dataset.theme = theme;
}
applyPageTheme();
onSettingsChanged((patch) => {
  if ('theme' in patch) applyPageTheme();
});

const dropZone = document.getElementById('drop');
const fileInput = document.getElementById('file');
const errorEl = document.getElementById('error');
const loadingName = document.getElementById('loadingName');
const libraryEl = document.getElementById('library');
const libraryListEl = document.getElementById('library-list');
const driveOpenBtn = document.getElementById('drive-open');
const driveOpenLabel = document.getElementById('drive-open-label');
const driveHint = document.getElementById('drive-hint');

let activePosKey = null;
let positionCleared = false;

let errorTimer = 0;
function setError(message) {
  errorEl.textContent = message || '';
  clearTimeout(errorTimer);
  if (message) errorTimer = setTimeout(() => (errorEl.textContent = ''), 6000);
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
  return startSessionWithSource(localPdfSource(bytes, name), {
    startIndex,
    onPosition,
    onPrepared,
    onEnd: returnToLanding,
  });
}

async function openFile(file, handle) {
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
    if (handle) await saveHandle(localPdfHref(file.name), handle);
    await runSession(bytes, file.name, await loadPosition(localPdfHref(file.name)));
  } catch (error) {
    console.error('[cadence] failed to open local PDF:', error);
    setError(`Couldn’t open this PDF: ${error?.message || error}`);
  } finally {
    setLoading(null);
  }
}

async function reopenLocal(entry) {
  setError('');
  const handle = await loadHandle(entry.id);
  if (!handle) {
    setError('Open this PDF once more to relink it, then it’ll reopen from here.');
    return;
  }
  try {
    if (!(await ensureReadPermission(handle))) {
      setError('Reading this PDF needs permission — click again to allow.');
      return;
    }
    const file = await handle.getFile();
    await openFile(file, handle);
  } catch (error) {
    console.error('[cadence] failed to reopen local PDF:', error);
    setError('Couldn’t reopen this PDF — it may have moved or been deleted.');
  }
}

async function chooseFile() {
  if (!('showOpenFilePicker' in window)) {
    fileInput.click();
    return;
  }
  let handle;
  try {
    [handle] = await window.showOpenFilePicker({
      types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
      multiple: false,
    });
  } catch {
    return;
  }
  openFile(await handle.getFile(), handle);
}

async function openUrl(rawUrl) {
  setError('');
  const raw = (rawUrl || '').trim();
  if (!raw) return;

  const ref = parseDocRef(raw);
  const mime = ref && ref.kind === 'pdf' ? DRIVE_PDF_MIME : DRIVE_DOC_MIME;
  const url = ref ? synthesizeUrl(ref.fileId, mime, ref.tabId) : raw;

  const source = detectSource(url);
  if (!source) {
    setError('That link isn’t a Google Doc or Drive PDF.');
    return;
  }

  reflectUrl(url);

  let docUrl = url;
  activePosKey = positionKey(url);
  positionCleared = false;

  const onPosition = (index, done) => { if (!positionCleared) savePosition(docUrl, done ? 0 : index); };
  const onSwitchTab = ref?.kind === 'doc' ? (tabId) => goToDocTab(ref.fileId, tabId) : null;

  const onResolved = ({ keyTabId, title }) => {
    if (!ref) return 0;
    const canonical = synthesizeUrl(ref.fileId, mime, keyTabId);
    docUrl = canonical;
    activePosKey = positionKey(canonical);
    reflectUrl(canonical);
    saveDocEntry(canonical, { title, type: source.type });
    return loadPosition(canonical);
  };

  setLoading(source.type === 'docs' ? 'document' : 'PDF');
  try {
    await startSessionWithSource(source, {
      startIndex: 0,
      onPosition,
      onResolved,
      onSwitchTab,
      onEnd: returnToLanding,
    });
  } catch (error) {
    console.error('[cadence] failed to open document:', error);
    if (error?.status === 403 || error?.status === 404) {
      setError('Access to this document was lost — use “Open from Google Drive” to grant it again.');
    } else {
      setError(`Couldn’t open that document: ${error?.message || error}`);
    }
  } finally {
    setLoading(null);
  }
}

function reflectUrl(url) {
  const params = new URLSearchParams(location.search);
  if (params.get('url') === url) return;
  params.set('url', url);
  params.delete('q');
  params.delete('tab');
  history.replaceState(null, '', `${location.pathname}?${params}`);
}

function returnToLanding() {
  activePosKey = null;
  persist.clearDoc();
  const params = new URLSearchParams(location.search);
  if (params.has('url') || params.has('q') || params.has('tab')) {
    params.delete('url');
    params.delete('q');
    params.delete('tab');
    const qs = params.toString();
    history.replaceState(null, '', qs ? `${location.pathname}?${qs}` : location.pathname);
  }
  renderLibrary();
}

function goToDocTab(fileId, tabId) {
  location.search = `?url=${encodeURIComponent(synthesizeUrl(fileId, DRIVE_DOC_MIME, tabId))}`;
}

async function openFromDrive(query) {
  setError('');
  const search = query ? `"${query.replace(/"/g, '')}"` : '';
  let pick;
  try {
    pick = await openPicker({ query: search });
  } catch (error) {
    console.error('[cadence] picker failed:', error);
    setError(`Couldn’t open the Google Picker: ${error?.message || error}`);
    return;
  }
  if (pick) openUrl(synthesizeUrl(pick.fileId, pick.mimeType, null));
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
    const nameEl = row.querySelector('.library-name');
    nameEl.textContent = entry.title || prettyTitle(entry.id);
    nameEl.title = nameEl.textContent;

    const meta = [];
    if (entry.inProgress) meta.push('<span class="resume">Resume</span>');
    if (local) meta.push('local PDF');
    if (entry.notes) meta.push(`${entry.notes} note${entry.notes === 1 ? '' : 's'}`);
    if (entry.at) meta.push(relativeTime(entry.at));
    row.querySelector('.library-meta').innerHTML = meta.join(' · ');

    row.addEventListener('click', (e) => {
      if (e.target.closest('.library-del')) return;
      if (local) reopenLocal(entry);
      else openUrl(entry.id);
    });
    row.querySelector('.library-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteDocEntry(entry.id);
      if (local) await deleteHandle(entry.id);
      renderLibrary();
    });
    libraryListEl.appendChild(row);
  }
}

const bootParams = new URLSearchParams(location.search);
let pendingQuery = bootParams.get('q') || '';
if (pendingQuery) primeDriveButton(pendingQuery);
driveOpenBtn.addEventListener('click', () => {
  const query = pendingQuery;
  if (pendingQuery) {
    pendingQuery = '';
    unprimeDriveButton();
  }
  openFromDrive(query);
});

function primeDriveButton(query) {
  driveOpenLabel.textContent = `Find “${query}” in Drive`;
  driveOpenBtn.classList.add('primed');
  driveHint.replaceChildren(
    'Cadence can’t open a Google Doc directly — pick ',
    Object.assign(document.createElement('strong'), { textContent: `“${query}”` }),
    ' from your Drive to read it.'
  );
  driveHint.hidden = false;
  driveOpenBtn.focus();
}

function unprimeDriveButton() {
  driveOpenLabel.textContent = 'Open from Google Drive';
  driveOpenBtn.classList.remove('primed');
  driveHint.hidden = true;
}

const initialUrl = bootParams.get('url');
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
  if (dropZone.classList.contains('loading')) return;
  e.preventDefault();
  chooseFile();
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
dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('over');
  const fallbackFile = e.dataTransfer?.files?.[0];
  const item = e.dataTransfer?.items?.[0];
  const handlePromise =
    handlesSupported() && item && 'getAsFileSystemHandle' in item ? item.getAsFileSystemHandle() : null;
  let handle = null;
  try {
    handle = handlePromise ? await handlePromise : null;
  } catch {
    handle = null;
  }
  if (handle && handle.kind !== 'file') handle = null;
  openFile(handle ? await handle.getFile() : fallbackFile, handle);
});

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

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
  const docChanged = Object.keys(changes).some((k) => k.startsWith(DOC_PREFIX));
  const anyRemoved = Object.values(changes).some((c) => c.newValue === undefined);
  if (docChanged || anyRemoved) renderLibrary();
});
