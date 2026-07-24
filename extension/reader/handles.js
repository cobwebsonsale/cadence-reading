const DB_NAME = 'cadence-handles';
const STORE = 'handles';

export function handlesSupported() {
  return (
    typeof indexedDB !== 'undefined' &&
    typeof window !== 'undefined' &&
    'FileSystemFileHandle' in window
  );
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function withDb(fn, fallback) {
  if (!handlesSupported()) return fallback;
  let db;
  try {
    db = await openDb();
    return await fn(db);
  } catch {
    return fallback;
  } finally {
    db?.close();
  }
}

export function saveHandle(id, handle) {
  if (!id || !handle) return Promise.resolve();
  return withDb(async (db) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, id);
    await txDone(tx);
  });
}

export function loadHandle(id) {
  return withDb(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      }),
    null
  );
}

export function deleteHandle(id) {
  return withDb(async (db) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
  });
}

export async function ensureReadPermission(handle) {
  const opts = { mode: 'read' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}
