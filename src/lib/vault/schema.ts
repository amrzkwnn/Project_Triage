export * from '../types';

import type {
  AuditEntry,
  CalendarEvent,
  InboxItem,
  Result,
  Settings,
} from '../types';

export const DB_NAME = 'bersama';
export const DB_VERSION = 1;
export const SCHEMA_VERSION = 1;

export const STORE_NAMES = {
  items: 'items',
  events: 'events',
  audit: 'audit',
  blobs: 'blobs',
  meta: 'meta',
} as const;

export const SETTINGS_LS_KEY = 'bersama_settings_v1';
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export type StoreError = {
  code: 'unavailable' | 'quota' | 'tx-failed';
  message: string;
};

export type ImportError = {
  reason:
    | 'too-large'
    | 'malformed-json'
    | 'missing-version'
    | 'unsupported-version'
    | 'missing-field'
    | 'store-error';
  field?: string;
  message: string;
};

export type OAuthTokenRecord = {
  id: string;
  account: string;
  provider: string;
  token: string;
};

export interface Vault {
  getSettings(): Promise<Result<Settings, StoreError>>;
  saveSettings(next: Settings): Promise<Result<void, StoreError>>;
  putItem(item: InboxItem): Promise<Result<void, StoreError>>;
  listItems(): Promise<Result<InboxItem[], StoreError>>;
  deleteItem?(id: string): Promise<Result<void, StoreError>>;
  putEvent(e: CalendarEvent): Promise<Result<void, StoreError>>;
  listEvents(): Promise<Result<CalendarEvent[], StoreError>>;
  deleteEvent(id: string): Promise<Result<void, StoreError>>;
  appendAudit(e: AuditEntry): Promise<Result<void, StoreError>>;
  listAudit(): Promise<Result<AuditEntry[], StoreError>>;
  putBlob(id: string, bytes: Uint8Array): Promise<Result<void, StoreError>>;
  getBlob(id: string): Promise<Result<Uint8Array | undefined, StoreError>>;
  listBlobs(): Promise<Result<Record<string, Uint8Array>, StoreError>>;
  saveOAuthToken(rec: OAuthTokenRecord): Promise<Result<void, StoreError>>;
  listOAuthTokens(): Promise<Result<OAuthTokenRecord[], StoreError>>;
  deleteOAuthToken?(id: string): Promise<Result<void, StoreError>>;
  exportAll(): Promise<Result<string, StoreError>>;
  importAll(text: string): Promise<Result<void, ImportError>>;
  eraseAll(): Promise<Result<void, StoreError>>;
}

export type VaultSnapshot = {
  settings: Settings;
  items: InboxItem[];
  events: CalendarEvent[];
  audit: AuditEntry[];
  blobs: Record<string, Uint8Array>;
};

export interface AtomicSnapshotVault extends Vault {
  __replaceSnapshot(
    snapshot: VaultSnapshot
  ): Promise<Result<void, StoreError>>;
}
