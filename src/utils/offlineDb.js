const DB_NAME  = "kuditrack_offline";
const DB_VER   = 2;
const OPS_STORE = "pending_ops";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      // Remove old version store if it exists
      if (db.objectStoreNames.contains("transactions")) {
        db.deleteObjectStore("transactions");
      }
      if (!db.objectStoreNames.contains(OPS_STORE)) {
        const s = db.createObjectStore(OPS_STORE, { keyPath: "local_id" });
        s.createIndex("status",  "status",  { unique: false });
        s.createIndex("user_id", "user_id", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function savePendingOp({ local_id, table, data, user_id }) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OPS_STORE, "readwrite");
    tx.objectStore(OPS_STORE).put({
      local_id, table, data, user_id,
      status:      "pending",
      supabase_id: null,
      created_at:  Date.now(),
    });
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

export async function getPendingOps(userId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(OPS_STORE, "readonly");
    const req = tx.objectStore(OPS_STORE).getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      resolve(all.filter(op => (!userId || op.user_id === userId) && op.status === "pending"));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingCount(userId) {
  const ops = await getPendingOps(userId);
  return ops.length;
}

export async function markOpSynced(localId, supabaseId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(OPS_STORE, "readwrite");
    const store = tx.objectStore(OPS_STORE);
    const get   = store.get(localId);
    get.onsuccess = () => {
      const rec = get.result;
      if (rec) store.put({ ...rec, status: "synced", supabase_id: supabaseId });
    };
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}
