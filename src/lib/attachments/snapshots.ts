/** Small async abstraction so tests can use deterministic in-memory storage. */
export interface AttachmentSnapshotStore {
  save(snapshotId: string, content: string): Promise<void>;
  load(snapshotId: string): Promise<string | undefined>;
  remove(snapshotId: string): Promise<void>;
  clear(): Promise<void>;
  keys?(): Promise<string[]>;
}

export const MAX_SNAPSHOT_STORAGE_BYTES = 50 * 1024 * 1024; // 50MB

export class MemoryAttachmentSnapshotStore implements AttachmentSnapshotStore {
  private readonly snapshots = new Map<string, string>();

  async save(snapshotId: string, content: string): Promise<void> {
    this.snapshots.set(snapshotId, content);
  }

  async load(snapshotId: string): Promise<string | undefined> {
    return this.snapshots.get(snapshotId);
  }

  async remove(snapshotId: string): Promise<void> {
    this.snapshots.delete(snapshotId);
  }

  async clear(): Promise<void> {
    this.snapshots.clear();
  }

  async keys(): Promise<string[]> {
    return Array.from(this.snapshots.keys());
  }
}

const DATABASE = "nanoforge-attachments";
const STORE = "snapshots";

class IndexedDbAttachmentSnapshotStore implements AttachmentSnapshotStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open attachment storage"));
    });
    return this.dbPromise;
  }

  async save(snapshotId: string, content: string): Promise<void> {
    const db = await this.open();
    await transaction(db, "readwrite", (store) => store.put(content, snapshotId));
  }

  async load(snapshotId: string): Promise<string | undefined> {
    const db = await this.open();
    return transaction(db, "readonly", (store) => store.get(snapshotId)) as Promise<string | undefined>;
  }

  async remove(snapshotId: string): Promise<void> {
    const db = await this.open();
    await transaction(db, "readwrite", (store) => store.delete(snapshotId));
  }

  async clear(): Promise<void> {
    const db = await this.open();
    await transaction(db, "readwrite", (store) => store.clear());
  }

  async keys(): Promise<string[]> {
    const db = await this.open();
    return transaction(db, "readonly", (store) => store.getAllKeys()) as Promise<string[]>;
  }
}

function transaction(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = operation(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Attachment storage operation failed"));
    tx.onerror = () => reject(tx.error ?? new Error("Attachment storage transaction failed"));
  });
}

let defaultStore: AttachmentSnapshotStore | undefined;

export function getAttachmentSnapshotStore(): AttachmentSnapshotStore {
  if (defaultStore) return defaultStore;
  defaultStore = typeof indexedDB === "undefined" ? new MemoryAttachmentSnapshotStore() : new IndexedDbAttachmentSnapshotStore();
  return defaultStore;
}
