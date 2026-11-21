import {
  ALL_CHANNELS,
  type AuditEntry,
  type CalendarEvent,
  type InboxItem,
  type Result,
  type Settings,
} from '../types';
import {
  type AtomicSnapshotVault,
  type ImportError,
  MAX_IMPORT_BYTES,
  SCHEMA_VERSION,
  type Vault,
  type VaultSnapshot,
} from './schema';

export function base64ToBytes(b64: string): Uint8Array | null {
  if (typeof b64 !== 'string') return null;
  const trimmed = b64.trim();
  if (trimmed.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(trimmed)) {
    return null;
  }
  try {
    const binary = atob(trimmed);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidSettings(value: unknown): value is Settings {
  if (!isPlainObject(value)) return false;
  if (!isPlainObject(value.channels)) return false;
  for (const ch of ALL_CHANNELS) {
    if (typeof value.channels[ch] !== 'boolean') return false;
  }
  if (typeof value.allowAiReading !== 'boolean') return false;
  if (typeof value.caregiverShareEnabled !== 'boolean') return false;
  if (typeof value.pushEnabled !== 'boolean') return false;
  if (
    typeof value.reminderLead !== 'string' ||
    !['15m', '30m', '1h', '2h', '1d'].includes(value.reminderLead)
  ) {
    return false;
  }
  if (!isPlainObject(value.checklist)) return false;
  if (!Array.isArray(value.familyMembers)) return false;
  return true;
}

function isValidItems(value: unknown): value is InboxItem[] {
  if (!Array.isArray(value)) return false;
  for (const item of value) {
    if (!isPlainObject(item)) return false;
    if (typeof item.id !== 'string') return false;
    if (
      typeof item.source !== 'string' ||
      !ALL_CHANNELS.includes(item.source as (typeof ALL_CHANNELS)[number])
    ) {
      return false;
    }
    if (typeof item.text !== 'string') return false;
    if (!Array.isArray(item.attachments)) return false;
    if (typeof item.receivedAt !== 'string') return false;
    if (typeof item.group !== 'string') return false;
    if (typeof item.priority !== 'string') return false;
    if (typeof item.tier !== 'number') return false;
    if (typeof item.confidence !== 'number') return false;
    if (typeof item.status !== 'string') return false;
  }
  return true;
}

function isValidEvents(value: unknown): value is CalendarEvent[] {
  if (!Array.isArray(value)) return false;
  for (const ev of value) {
    if (!isPlainObject(ev)) return false;
    if (typeof ev.id !== 'string') return false;
    if (typeof ev.title !== 'string') return false;
    if (typeof ev.date !== 'string') return false;
    if (typeof ev.category !== 'string') return false;
    if (typeof ev.createdAt !== 'string') return false;
  }
  return true;
}

function isValidAudit(value: unknown): value is AuditEntry[] {
  if (!Array.isArray(value)) return false;
  for (const entry of value) {
    if (!isPlainObject(entry)) return false;
    if (typeof entry.id !== 'string') return false;
    if (typeof entry.at !== 'string') return false;
    if (entry.kind !== 'ai-read' && entry.kind !== 'family-share') return false;
    if (typeof entry.description !== 'string') return false;
  }
  return true;
}

function hasAtomicSnapshotReplace(
  vault: Vault
): vault is AtomicSnapshotVault {
  return (
    typeof (vault as AtomicSnapshotVault).__replaceSnapshot === 'function'
  );
}

export async function importDocument(
  vault: Vault,
  text: string
): Promise<Result<void, ImportError>> {
  if (typeof text !== 'string') {
    return {
      ok: false,
      error: {
        reason: 'malformed-json',
        message: 'We could not read that backup file. Please choose a valid file.',
      },
    };
  }

  // Check UTF-8 byte size BEFORE parsing JSON
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > MAX_IMPORT_BYTES) {
    return {
      ok: false,
      error: {
        reason: 'too-large',
        message:
          'This backup file is over 10 MB and could not be opened. Please choose a smaller file.',
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: {
        reason: 'malformed-json',
        message:
          'This backup file is not valid and could not be read. Please choose another file.',
      },
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      error: {
        reason: 'malformed-json',
        message:
          'This backup file is not valid and could not be read. Please choose another file.',
      },
    };
  }

  if (
    !('schemaVersion' in parsed) ||
    parsed.schemaVersion === undefined ||
    parsed.schemaVersion === null
  ) {
    return {
      ok: false,
      error: {
        reason: 'missing-version',
        field: 'schemaVersion',
        message:
          'This backup file is missing its version number and could not be imported.',
      },
    };
  }

  if (
    typeof parsed.schemaVersion !== 'number' ||
    !Number.isInteger(parsed.schemaVersion) ||
    parsed.schemaVersion !== SCHEMA_VERSION
  ) {
    return {
      ok: false,
      error: {
        reason: 'unsupported-version',
        field: 'schemaVersion',
        message:
          'This backup file was made with a different version and cannot be opened here.',
      },
    };
  }

  if (!('settings' in parsed) || !isValidSettings(parsed.settings)) {
    return {
      ok: false,
      error: {
        reason: 'missing-field',
        field: 'settings',
        message:
          'This backup file is missing your settings and could not be imported.',
      },
    };
  }

  if (!('items' in parsed) || !isValidItems(parsed.items)) {
    return {
      ok: false,
      error: {
        reason: 'missing-field',
        field: 'items',
        message:
          'This backup file is missing your inbox messages and could not be imported.',
      },
    };
  }

  if (!('events' in parsed) || !isValidEvents(parsed.events)) {
    return {
      ok: false,
      error: {
        reason: 'missing-field',
        field: 'events',
        message:
          'This backup file is missing your calendar events and could not be imported.',
      },
    };
  }

  if (!('audit' in parsed) || !isValidAudit(parsed.audit)) {
    return {
      ok: false,
      error: {
        reason: 'missing-field',
        field: 'audit',
        message:
          'This backup file is missing your activity log and could not be imported.',
      },
    };
  }

  const decodedBlobs: Record<string, Uint8Array> = {};
  if ('blobs' in parsed && parsed.blobs !== undefined) {
    if (!isPlainObject(parsed.blobs)) {
      return {
        ok: false,
        error: {
          reason: 'missing-field',
          field: 'blobs',
          message:
            'This backup file has unreadable photo data and could not be imported.',
        },
      };
    }
    for (const [blobId, b64Val] of Object.entries(parsed.blobs)) {
      if (typeof b64Val !== 'string') {
        return {
          ok: false,
          error: {
            reason: 'missing-field',
            field: 'blobs',
            message:
              'This backup file has unreadable photo data and could not be imported.',
          },
        };
      }
      const bytes = base64ToBytes(b64Val);
      if (!bytes) {
        return {
          ok: false,
          error: {
            reason: 'missing-field',
            field: 'blobs',
            message:
              'This backup file has unreadable photo data and could not be imported.',
          },
        };
      }
      decodedBlobs[blobId] = bytes;
    }
  }

  const snapshot: VaultSnapshot = {
    settings: parsed.settings,
    items: parsed.items,
    events: parsed.events,
    audit: parsed.audit,
    blobs: decodedBlobs,
  };

  if (hasAtomicSnapshotReplace(vault)) {
    const replaceRes = await vault.__replaceSnapshot(snapshot);
    if (!replaceRes.ok) {
      return {
        ok: false,
        error: {
          reason: 'store-error',
          message: replaceRes.error.message,
        },
      };
    }
    return { ok: true, value: undefined };
  }

  // Fallback for custom Vault implementations without __replaceSnapshot
  const eraseRes = await vault.eraseAll();
  if (!eraseRes.ok) {
    return {
      ok: false,
      error: { reason: 'store-error', message: eraseRes.error.message },
    };
  }
  const saveSettingsRes = await vault.saveSettings(snapshot.settings);
  if (!saveSettingsRes.ok) {
    return {
      ok: false,
      error: { reason: 'store-error', message: saveSettingsRes.error.message },
    };
  }
  for (const item of snapshot.items) {
    const r = await vault.putItem(item);
    if (!r.ok) {
      return { ok: false, error: { reason: 'store-error', message: r.error.message } };
    }
  }
  for (const ev of snapshot.events) {
    const r = await vault.putEvent(ev);
    if (!r.ok) {
      return { ok: false, error: { reason: 'store-error', message: r.error.message } };
    }
  }
  for (const entry of snapshot.audit) {
    const r = await vault.appendAudit(entry);
    if (!r.ok) {
      return { ok: false, error: { reason: 'store-error', message: r.error.message } };
    }
  }
  for (const [id, bytes] of Object.entries(snapshot.blobs)) {
    const r = await vault.putBlob(id, bytes);
    if (!r.ok) {
      return { ok: false, error: { reason: 'store-error', message: r.error.message } };
    }
  }

  return { ok: true, value: undefined };
}
