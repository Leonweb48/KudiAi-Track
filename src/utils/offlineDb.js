/**
 * KudiTrack AI — IndexedDB offline storage
 * Stores transactions locally when offline; syncs when back online.
 */

const DB_NAME  = "kuditrack_db";
const DB_VER   = 1;
const STORE    = "transactions";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "local_id" });
        store.createIndex("synced", "synced", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function saveTransactionOffline(tx) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tran = db.transaction(STORE, "readwrite");
    tran.objectStore(STORE).put({ ...tx, synced: false });
    tran.oncomplete = resolve;
    tran.onerror    = () => reject(tran.error);
  });
}

export async function getPendingTransactions() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tran  = db.transaction(STORE, "readonly");
    const idx   = tran.objectStore(STORE).index("synced");
    const req   = idx.getAll(false);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function markTransactionSynced(localId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tran  = db.transaction(STORE, "readwrite");
    const store = tran.objectStore(STORE);
    const get   = store.get(localId);
    get.onsuccess = () => {
      const record = get.result;
      if (record) store.put({ ...record, synced: true });
    };
    tran.oncomplete = resolve;
    tran.onerror    = () => reject(tran.error);
  });
}
