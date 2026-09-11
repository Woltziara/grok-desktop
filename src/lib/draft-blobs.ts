/**
 * Draft attachment bytes live in IndexedDB, separate from the JSON draft
 * record, so a large paste is not truncated by localStorage quotas.
 */

const DB_NAME = "grok-desktop-draft-blobs";
const STORE = "files";

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("这台环境不能分开保存附件数据"));
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error || new Error("无法打开草稿附件存储"));
  });
}

export async function putDraftBlob(id: string, blob: Blob): Promise<void> {
  const key = String(id || "");
  if (!key) throw new Error("missing blob id");
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("保存附件失败"));
      tx.objectStore(STORE).put(blob, key);
    });
  } finally {
    db.close();
  }
}

export async function getDraftBlob(id: string): Promise<Blob | null> {
  const key = String(id || "");
  if (!key) return null;
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const value = req.result;
        resolve(value instanceof Blob ? value : null);
      };
      req.onerror = () => reject(req.error || new Error("读取附件失败"));
    });
  } finally {
    db.close();
  }
}

export async function deleteDraftBlob(id: string): Promise<void> {
  const key = String(id || "");
  if (!key) return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("删除附件失败"));
      tx.objectStore(STORE).delete(key);
    });
  } finally {
    db.close();
  }
}
