// buno — local storage adapter.
// Same API surface as the prototype's `window.storage` (the Claude-artifact host
// API), so App's load/save logic is untouched. Small values (the board JSON) go
// to localStorage; attachment dataURLs go to IndexedDB — they exceed
// localStorage's ~5MB quota quickly.
// This module is the Stage-A half of the data seam; remote.ts (Supabase)
// replaces it in Stage C behind the same interface.

import { APREFIX } from "../lib/constants";

const DB_NAME = "buno-local";
const STORE = "kv";

let dbP: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbP) dbP = new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    // open() can hang indefinitely if another tab holds a versionchange
    // (or in some private-browsing modes). Never let asset I/O freeze the
    // whole app — fall through to a rejection so callers degrade gracefully.
    r.onblocked = () => rej(new Error("indexeddb blocked"));
    setTimeout(() => rej(new Error("indexeddb open timeout")), 5000);
  }).catch((e) => { dbP = null; throw e; }); // let a later call retry a fresh open
  return dbP;
}
function tx(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<any> {
  return db().then((d) => new Promise((res, rej) => {
    const req = run(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  }));
}

const isAsset = (key: string) => key.startsWith(APREFIX);

export const storage = {
  async get(key: string): Promise<{ value: string } | null> {
    if (isAsset(key)) {
      const v = await tx("readonly", (s) => s.get(key));
      return v == null ? null : { value: v as string };
    }
    const v = localStorage.getItem(key);
    return v == null ? null : { value: v };
  },
  async set(key: string, value: string): Promise<void> {
    if (isAsset(key)) { await tx("readwrite", (s) => s.put(value, key)); return; }
    localStorage.setItem(key, value);
  },
  async delete(key: string): Promise<void> {
    if (isAsset(key)) { await tx("readwrite", (s) => s.delete(key)); return; }
    localStorage.removeItem(key);
  },
  async list(prefix: string): Promise<{ keys: string[] }> {
    if (isAsset(prefix)) {
      const all: string[] = await tx("readonly", (s) => s.getAllKeys()) as string[];
      return { keys: all.filter((k) => String(k).startsWith(prefix)).map(String) };
    }
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    return { keys };
  },
};
