import { toPlainMessage } from '../errors/plainMessage';
import {
  type AuditEntry,
  type CalendarEvent,
  type InboxItem,
  type Result,
  type Settings,
  createDefaultSettings,
} from '../types';
import { exportDocument } from './export';
import { importDocument } from './import';
import {
  type AtomicSnapshotVault,
  DB_NAME,
  DB_VERSION,
  type ImportError,
  type OAuthTokenRecord,
  SETTINGS_LS_KEY,
  STORE_NAMES,
  type StoreError,
  type Vault,
  type VaultSnapshot,
} from './schema';

type InMemoryDatabase = {
  hasSettings: boolean;
  settings: Settings;
  items: InboxItem[];
  events: Map<string, CalendarEvent>;
  audit: AuditEntry[];
  blobs: Map<string, Uint8Array>;
  oauthTokens: Map<string, OAuthTokenRecord>;
};

const memoryDatabases = new Map<string, InMemoryDatabase>();

function getOrCreateMemoryDb(dbName: string): InMemoryDatabase {
  let db = memoryDatabases.get(dbName);
  if (!db) {
    db = {
      hasSettings: false,
      settings: createDefaultSettings(),
      items: [],
      events: new Map(),
      audit: [],
      blobs: new Map(),
      oauthTokens: new Map(),
    };
    memoryDatabases.set(dbName, db);
  }
  return db;
}

function cloneValue<T>(val: T): T {
  if (val instanceof Uint8Array) {
    return new Uint8Array(val) as unknown as T;
  }
  return structuredClone(val);
}

function makeStoreError(
  err: unknown,
  action: string,
  code: StoreError['code'] = 'tx-failed'
): StoreError {
  return {
    code,
    message: toPlainMessage(err, action),
  };
}

function openBrowserIndexedDB(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(dbName, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAMES.items)) {
        db.createObjectStore(STORE_NAMES.items, { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.events)) {
        db.createObjectStore(STORE_NAMES.events, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.audit)) {
        db.createObjectStore(STORE_NAMES.audit, { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.blobs)) {
        db.createObjectStore(STORE_NAMES.blobs);
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.meta)) {
        db.createObjectStore(STORE_NAMES.meta);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Could not open storage'));
  });
}

function createIdbVault(
  dbName: string,
  storage: Storage | undefined,
  shouldFailWrite: (() => boolean) | undefined
): AtomicSnapshotVault {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const getDb = () => {
    if (!dbPromise) {
      dbPromise = openBrowserIndexedDB(dbName);
    }
    return dbPromise;
  };

  const checkFail = (action: string): Result<void, StoreError> | null => {
    if (shouldFailWrite?.()) {
      return {
        ok: false,
        error: makeStoreError(new Error('Simulated write failure'), action),
      };
    }
    return null;
  };

  const vault: AtomicSnapshotVault = {
    async getSettings() {
      try {
        const db = await getDb();
        const stored = await new Promise<Settings | undefined>(
          (resolve, reject) => {
            const tx = db.transaction(STORE_NAMES.meta, 'readonly');
            const req = tx.objectStore(STORE_NAMES.meta).get('settings');
            req.onsuccess = () => resolve(req.result as Settings | undefined);
            req.onerror = () => reject(req.error);
          }
        );
        if (stored) {
          return { ok: true, value: cloneValue(stored) };
        }
        const lsRaw = storage?.getItem(SETTINGS_LS_KEY);
        if (lsRaw) {
          try {
            return { ok: true, value: JSON.parse(lsRaw) as Settings };
          } catch {
            // Fall through to default settings
          }
        }
        return { ok: true, value: createDefaultSettings() };
      } catch (err) {
        return {
          ok: false,
          error: makeStoreError(err, 'load your settings', 'unavailable'),
        };
      }
    },

    async saveSettings(next: Settings) {
      const fail = checkFail('save your settings');
      if (fail) return fail;
      const cloned = cloneValue(next);
      const serialized = JSON.stringify(cloned);
      const previousLs = storage ? storage.getItem(SETTINGS_LS_KEY) : null;
      try {
        if (storage) {
          storage.setItem(SETTINGS_LS_KEY, serialized);
        }
        const db = await getDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAMES.meta, 'readwrite');
          tx.objectStore(STORE_NAMES.meta).put(cloned, 'settings');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
        });
        return { ok: true, value: undefined };
      } catch (err) {
        if (storage) {
          try {
            if (previousLs === null) {
              storage.removeItem(SETTINGS_LS_KEY);
            } else {
              storage.setItem(SETTINGS_LS_KEY, previousLs);
            }
          } catch {
            // Ignore rollback errors
          }
        }
        return { ok: false, error: makeStoreError(err, 'save your settings') };
      }
    },

    async putItem(item: InboxItem) {
      const fail = checkFail('save that message');
      if (fail) return fail;
      const cloned = cloneValue(item);
      try {
        const db = await getDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAMES.items, 'readwrite');
          // Auto-increment key keeps both items on identifier collision (Property 22)
          tx.objectStore(STORE_NAMES.items).add(cloned);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
        });
        return { ok: true, value: undefined };
      } catch (err) {
        return { ok: false, error: makeStoreError(err, 'save that message') };
      }
    },

    async listItems() {
      try {
        const db = await getDb();
        const items = await new Promise<InboxItem[]>((resolve, reject) => {
          const tx = db.transaction(STORE_NAMES.items, 'readonly');
          const req = tx.objectStore(STORE_NAMES.items).getAll();
          req.onsuccess = () => resolve((req.result as InboxItem[]) ?? []);
          req.onerror = () => reject(req.error);
        });
        return { ok: true, value: items.map((i) => cloneValue(i)) };
      } catch (err) {
        return {
          ok: false,
          error: makeStoreError(err, 'load your messages', 'unavailable'),
        };
      }
    },

    async putEvent(e: CalendarEvent) {
      const fail = checkFail('save that event');
      if (fail) return fail;
      const cloned = cloneValue(e);
      try {
        const db = await getDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAMES.events, 'readwrite');
          tx.objectStore(STORE_NAMES.events).put(cloned);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
        });
        return { ok: true, value: undefined };
      } catch (err) {
        return { ok: false, error: makeStoreError(err, 'save that event') };
      }
    },

    async listEvents() {
      try {
        const db = await getDb();
        const events = await new Promise<CalendarEvent[]>((resolve, reject) => {
          const tx = db.transaction(STORE_NAMES.events, 'readonly');
          const req = tx.objectStore(STORE_NAMES.events).getAll();
          req.onsuccess = () => resolve((req.result as CalendarEvent[]) ?? []);
          req.onerror = () => reject(req.error);
        });
        return { ok: true, value: events.map((ev) => cloneValue(ev)) };
      } catch (err) {
        return {
          ok: false,
          error: makeStoreError(err, 'load your calendar', 'unavailable'),
        };
      }
    },

    async deleteEvent(id: string) {
      const fail = checkFail('delete that event');
      if (fail) return fail;
      try {
        const db = await getDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAMES.events, 'readwrite');
          tx.objectStore(STORE_NAMES.events).delete(id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
        });
        return { ok: true, value: undefined };
      } catch (err) {
        return { ok: false, error: makeStoreError(err, 'delete that event') };
      }
    },

    async appendAudit(e: AuditEntry) {
      const fail = checkFail('record that activity');
      if (fail) return fail;
      const cloned = cloneValue(e);
      try {
        const db = await getDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAMES.audit, 'readwrite');
          tx.objectStore(STORE_NAMES.audit).add(cloned);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
        });
        return { ok: true, value: undefined };
      } catch (err) {
        return {
          ok: false,
          error: makeStoreError(err, 'record that activity'),
        };
      }
    },

    async listAudit() {
      try {
        const db = await getDb();
        const entries = await new Promise<AuditEntry[]>((resolve, reject) => {
          const tx = db.transaction(STORE_NAMES.audit, 'readonly');
          const req = tx.objectStore(STORE_NAMES.audit).getAll();
          req.onsuccess = () => resolve((req.result as AuditEntry[]) ?? []);
          req.onerror = () => reject(req.error);
        });
        return { ok: true, value: entries.map((entry) => cloneValue(entry)) };
      } catch (err) {
        return {
          ok: false,
          error: makeStoreError(err, 'load your activity log', 'unavailable'),
        };
      }
    },

    async putBlob(id: string, bytes: Uint8Array) {
      const fail = checkFail('save that photo');
      if (fail) return fail;
      const cloned = cloneValue(bytes);
      try {
        const db = await getDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAMES.blobs, 'readwrite');
          tx.objectStore(STORE_NAMES.blobs).put(cloned, id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
        });
        return { ok: true, value: undefined };
      } catch (err) {
        return { ok: false, error: makeStoreError(err, 'save that photo') };
      }
    },

    async getBlob(id: string) {
      try {
        const db = await getDb();
        const bytes = await new Promise<Uint8Array | undefined>(
          (resolve, reject) => {
            const tx = db.transaction(STORE_NAMES.blobs, 'readonly');
            const req = tx.objectStore(STORE_NAMES.blobs).get(id);
            req.onsuccess = () =>
              resolve(req.result as Uint8Array | undefined);
            req.onerror = () => reject(req.error);
          }
        );
        return { ok: true, value: bytes ? cloneValue(bytes) : undefined };
      } catch (err) {
        return {
          ok: false,
          error: makeStoreError(err, 'load that photo', 'unavailable'),
        };
      }
    },

    async listBlobs() {
      try {
        const db = await getDb();
        const map = await new Promise<Record<string, Uint8Array>>(
          (resolve, reject) => {
            const tx = db.transaction(STORE_NAMES.blobs, 'readonly');
            const store = tx.objectStore(STORE_NAMES.blobs);
            const out: Record<string, Uint8Array> = {};
            const req = store.openCursor();
            req.onsuccess = () => {
              const cursor = req.result;
              if (cursor) {
                out[String(cursor.key)] = cloneValue(
                  cursor.value as Uint8Array
                );
                cursor.continue();
              } else {
                resolve(out);
              }
            };
            req.onerror = () => reject(req.error);
          }
        );
        return { ok: true, value: map };
      } catch (err) {
        return {
          ok: false,
          error: makeStoreError(err, 'load your photos', 'unavailable'),
        };
      }
    },

    async saveOAuthToken(rec: OAuthTokenRecord) {
      const fail = checkFail('save your account connection');
      if (fail) return fail;
      const cloned = cloneValue(rec);
      try {
        const db = await getDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAMES.meta, 'readwrite');
          const store = tx.objectStore(STORE_NAMES.meta);
          const getReq = store.get('oauthTokens');
          getReq.onsuccess = () => {
            const existing =
              (getReq.result as Record<string, OAuthTokenRecord> | undefined) ??
              {};
            existing[cloned.id] = cloned;
            store.put(existing, 'oauthTokens');
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
        });
        return { ok: true, value: undefined };
      } catch (err) {
        return {
          ok: false,
          error: makeStoreError(err, 'save your account connection'),
        };
      }
    },

    async listOAuthTokens() {
      try {
        const db = await getDb();
        const map = await new Promise<
          Record<string, OAuthTokenRecord> | undefined
        >((resolve, reject) => {
          const tx = db.transaction(STORE_NAMES.meta, 'readonly');
          const req = tx.objectStore(STORE_NAMES.meta).get('oauthTokens');
          req.onsuccess = () =>
            resolve(
              req.result as Record<string, OAuthTokenRecord> | undefined
            );
          req.onerror = () => reject(req.error);
        });
        const list = map ? Object.values(map).map((r) => cloneValue(r)) : [];
        return { ok: true, value: list };
      } catch (err) {
        return {
          ok: false,
          error: makeStoreError(
            err,
            'load your connected accounts',
            'unavailable'
          ),
        };
      }
    },

    async exportAll() {
      return exportDocument(vault);
    },

    async importAll(text: string): Promise<Result<void, ImportError>> {
      return importDocument(vault, text);
    },

    async eraseAll() {
      const fail = checkFail('erase your data');
      if (fail) return fail;
      const previousLs = storage ? storage.getItem(SETTINGS_LS_KEY) : null;
      try {
        if (storage) {
          storage.removeItem(SETTINGS_LS_KEY);
        }
        const db = await getDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(
            [
              STORE_NAMES.items,
              STORE_NAMES.events,
              STORE_NAMES.audit,
              STORE_NAMES.blobs,
              STORE_NAMES.meta,
            ],
            'readwrite'
          );
          tx.objectStore(STORE_NAMES.items).clear();
          tx.objectStore(STORE_NAMES.events).clear();
          tx.objectStore(STORE_NAMES.audit).clear();
          tx.objectStore(STORE_NAMES.blobs).clear();
          tx.objectStore(STORE_NAMES.meta).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
        });
        return { ok: true, value: undefined };
      } catch (err) {
        if (storage && previousLs !== null) {
          try {
            storage.setItem(SETTINGS_LS_KEY, previousLs);
          } catch {
            // Ignore rollback error
          }
        }
        return { ok: false, error: makeStoreError(err, 'erase your data') };
      }
    },

    async __replaceSnapshot(snapshot: VaultSnapshot) {
      const fail = checkFail('import your backup file');
      if (fail) return fail;
      const clonedSettings = cloneValue(snapshot.settings);
      const serializedSettings = JSON.stringify(clonedSettings);
      const previousLs = storage ? storage.getItem(SETTINGS_LS_KEY) : null;
      try {
        if (storage) {
          storage.setItem(SETTINGS_LS_KEY, serializedSettings);
        }
        const db = await getDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(
            [
              STORE_NAMES.items,
              STORE_NAMES.events,
              STORE_NAMES.audit,
              STORE_NAMES.blobs,
              STORE_NAMES.meta,
            ],
            'readwrite'
          );
          const itemsStore = tx.objectStore(STORE_NAMES.items);
          const eventsStore = tx.objectStore(STORE_NAMES.events);
          const auditStore = tx.objectStore(STORE_NAMES.audit);
          const blobsStore = tx.objectStore(STORE_NAMES.blobs);
          const metaStore = tx.objectStore(STORE_NAMES.meta);

          itemsStore.clear();
          eventsStore.clear();
          auditStore.clear();
          blobsStore.clear();

          metaStore.put(clonedSettings, 'settings');
          for (const item of snapshot.items) {
            itemsStore.add(cloneValue(item));
          }
          for (const ev of snapshot.events) {
            eventsStore.put(cloneValue(ev));
          }
          for (const entry of snapshot.audit) {
            auditStore.add(cloneValue(entry));
          }
          for (const [id, bytes] of Object.entries(snapshot.blobs)) {
            blobsStore.put(cloneValue(bytes), id);
          }

          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
        });
        return { ok: true, value: undefined };
      } catch (err) {
        if (storage) {
          try {
            if (previousLs === null) {
              storage.removeItem(SETTINGS_LS_KEY);
            } else {
              storage.setItem(SETTINGS_LS_KEY, previousLs);
            }
          } catch {
            // Ignore rollback error
          }
        }
        return {
          ok: false,
          error: makeStoreError(err, 'import your backup file'),
        };
      }
    },
  };

  return vault;
}

function createMemoryVault(
  dbName: string,
  storage: Storage | undefined,
  shouldFailWrite: (() => boolean) | undefined
): AtomicSnapshotVault {
  const checkFail = (action: string): Result<void, StoreError> | null => {
    if (shouldFailWrite?.()) {
      return {
        ok: false,
        error: makeStoreError(new Error('Simulated write failure'), action),
      };
    }
    return null;
  };

  const vault: AtomicSnapshotVault = {
    async getSettings() {
      const db = getOrCreateMemoryDb(dbName);
      if (db.hasSettings) {
        return { ok: true, value: cloneValue(db.settings) };
      }
      const lsRaw = storage?.getItem(SETTINGS_LS_KEY);
      if (lsRaw) {
        try {
          const parsed = JSON.parse(lsRaw) as Settings;
          return { ok: true, value: cloneValue(parsed) };
        } catch {
          // Fall through
        }
      }
      return { ok: true, value: createDefaultSettings() };
    },

    async saveSettings(next: Settings) {
      const fail = checkFail('save your settings');
      if (fail) return fail;

      const db = getOrCreateMemoryDb(dbName);
      const cloned = cloneValue(next);
      const serialized = JSON.stringify(cloned);

      try {
        if (storage) {
          storage.setItem(SETTINGS_LS_KEY, serialized);
        }
        db.settings = cloned;
        db.hasSettings = true;
        return { ok: true, value: undefined };
      } catch (err) {
        return {
          ok: false,
          error: makeStoreError(err, 'save your settings', 'quota'),
        };
      }
    },

    async putItem(item: InboxItem) {
      const fail = checkFail('save that message');
      if (fail) return fail;

      const db = getOrCreateMemoryDb(dbName);
      // Property 22: Identifier collision keeps existing item unchanged and stores incoming item as a separate entry
      db.items.push(cloneValue(item));
      return { ok: true, value: undefined };
    },

    async listItems() {
      const db = getOrCreateMemoryDb(dbName);
      return { ok: true, value: db.items.map((item) => cloneValue(item)) };
    },

    async putEvent(e: CalendarEvent) {
      const fail = checkFail('save that event');
      if (fail) return fail;

      const db = getOrCreateMemoryDb(dbName);
      db.events.set(e.id, cloneValue(e));
      return { ok: true, value: undefined };
    },

    async listEvents() {
      const db = getOrCreateMemoryDb(dbName);
      return {
        ok: true,
        value: Array.from(db.events.values()).map((ev) => cloneValue(ev)),
      };
    },

    async deleteEvent(id: string) {
      const fail = checkFail('delete that event');
      if (fail) return fail;

      const db = getOrCreateMemoryDb(dbName);
      db.events.delete(id);
      return { ok: true, value: undefined };
    },

    async appendAudit(e: AuditEntry) {
      const fail = checkFail('record that activity');
      if (fail) return fail;

      const db = getOrCreateMemoryDb(dbName);
      db.audit.push(cloneValue(e));
      return { ok: true, value: undefined };
    },

    async listAudit() {
      const db = getOrCreateMemoryDb(dbName);
      return {
        ok: true,
        value: db.audit.map((entry) => cloneValue(entry)),
      };
    },

    async putBlob(id: string, bytes: Uint8Array) {
      const fail = checkFail('save that photo');
      if (fail) return fail;

      const db = getOrCreateMemoryDb(dbName);
      db.blobs.set(id, cloneValue(bytes));
      return { ok: true, value: undefined };
    },

    async getBlob(id: string) {
      const db = getOrCreateMemoryDb(dbName);
      const found = db.blobs.get(id);
      return {
        ok: true,
        value: found ? cloneValue(found) : undefined,
      };
    },

    async listBlobs() {
      const db = getOrCreateMemoryDb(dbName);
      const out: Record<string, Uint8Array> = {};
      for (const [id, bytes] of db.blobs.entries()) {
        out[id] = cloneValue(bytes);
      }
      return { ok: true, value: out };
    },

    async saveOAuthToken(rec: OAuthTokenRecord) {
      const fail = checkFail('save your account connection');
      if (fail) return fail;

      const db = getOrCreateMemoryDb(dbName);
      db.oauthTokens.set(rec.id, cloneValue(rec));
      return { ok: true, value: undefined };
    },

    async listOAuthTokens() {
      const db = getOrCreateMemoryDb(dbName);
      return {
        ok: true,
        value: Array.from(db.oauthTokens.values()).map((rec) =>
          cloneValue(rec)
        ),
      };
    },

    async exportAll() {
      return exportDocument(vault);
    },

    async importAll(text: string): Promise<Result<void, ImportError>> {
      return importDocument(vault, text);
    },

    async eraseAll() {
      const fail = checkFail('erase your data');
      if (fail) return fail;

      const db = getOrCreateMemoryDb(dbName);
      try {
        if (storage) {
          storage.removeItem(SETTINGS_LS_KEY);
        }
        db.hasSettings = false;
        db.settings = createDefaultSettings();
        db.items = [];
        db.events.clear();
        db.audit = [];
        db.blobs.clear();
        db.oauthTokens.clear();
        return { ok: true, value: undefined };
      } catch (err) {
        return {
          ok: false,
          error: makeStoreError(err, 'erase your data'),
        };
      }
    },

    async __replaceSnapshot(snapshot: VaultSnapshot) {
      const fail = checkFail('import your backup file');
      if (fail) return fail;

      const db = getOrCreateMemoryDb(dbName);
      const nextSettings = cloneValue(snapshot.settings);
      const nextItems = snapshot.items.map((item) => cloneValue(item));
      const nextEvents = new Map<string, CalendarEvent>();
      for (const ev of snapshot.events) {
        nextEvents.set(ev.id, cloneValue(ev));
      }
      const nextAudit = snapshot.audit.map((entry) => cloneValue(entry));
      const nextBlobs = new Map<string, Uint8Array>();
      for (const [id, bytes] of Object.entries(snapshot.blobs)) {
        nextBlobs.set(id, cloneValue(bytes));
      }

      try {
        if (storage) {
          storage.setItem(SETTINGS_LS_KEY, JSON.stringify(nextSettings));
        }
        db.settings = nextSettings;
        db.hasSettings = true;
        db.items = nextItems;
        db.events = nextEvents;
        db.audit = nextAudit;
        db.blobs = nextBlobs;
        return { ok: true, value: undefined };
      } catch (err) {
        return {
          ok: false,
          error: makeStoreError(err, 'import your backup file'),
        };
      }
    },
  };

  return vault;
}

export function createVault(deps?: {
  dbName?: string;
  storage?: Storage;
  shouldFailWrite?: () => boolean;
}): Vault {
  const dbName = deps?.dbName ?? DB_NAME;
  const storage =
    deps?.storage ??
    (typeof globalThis.localStorage !== 'undefined'
      ? globalThis.localStorage
      : undefined);
  const shouldFailWrite = deps?.shouldFailWrite;

  if (typeof globalThis.indexedDB !== 'undefined') {
    return createIdbVault(dbName, storage, shouldFailWrite);
  }

  return createMemoryVault(dbName, storage, shouldFailWrite);
}
