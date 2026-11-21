import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import type { InboxItemDraft } from '@/lib/types';

export const RELAY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const AES_ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export type RelayEnvelope = {
  id: string;
  seniorId: string;
  ivHex: string;
  authTagHex: string;
  ciphertextHex: string;
  createdAtMs: number;
  expiresAtMs: number;
};

export type PulledRelayItem = {
  id: string;
  draft: InboxItemDraft;
  createdAtMs: number;
};

export type RelayStoreOptions = {
  key?: Uint8Array;
  ttlMs?: number;
};

function getProcessEnv(): Record<string, string | undefined> {
  const g = globalThis as {
    process?: { env?: Record<string, string | undefined> };
  };
  return g.process?.env ?? {};
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const len = hex.length / 2;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function resolveEncryptionKey(explicitKey?: Uint8Array): Uint8Array {
  if (explicitKey !== undefined) {
    if (!(explicitKey instanceof Uint8Array) || explicitKey.length !== KEY_BYTES) {
      throw new Error('Relay encryption key must be a 32-byte Uint8Array.');
    }
    return new Uint8Array(explicitKey);
  }

  const envKey = getProcessEnv().RELAY_ENCRYPTION_KEY;
  if (typeof envKey === 'string' && envKey.length > 0) {
    return new Uint8Array(createHash('sha256').update(envKey, 'utf8').digest());
  }

  return new Uint8Array(randomBytes(KEY_BYTES));
}

export class EncryptedRelayStore {
  private readonly key: Uint8Array;
  private readonly ttlMs: number;
  private readonly records = new Map<string, RelayEnvelope>();

  constructor(opts?: RelayStoreOptions) {
    this.key = resolveEncryptionKey(opts?.key);
    this.ttlMs =
      opts?.ttlMs !== undefined &&
      Number.isFinite(opts.ttlMs) &&
      opts.ttlMs > 0
        ? opts.ttlMs
        : RELAY_TTL_MS;
  }

  enqueue(
    seniorIdFromToken: string,
    draft: InboxItemDraft,
    nowMs: number = Date.now()
  ): RelayEnvelope {
    const id = randomUUID();
    const iv = randomBytes(IV_BYTES);
    const aad = textEncoder.encode(`${seniorIdFromToken}:${id}`);

    const cipher = createCipheriv(AES_ALGORITHM, this.key, iv);
    cipher.setAAD(aad);

    const plaintext = textEncoder.encode(JSON.stringify(draft));
    const encrypted = concatBytes(cipher.update(plaintext), cipher.final());
    const authTag = cipher.getAuthTag();

    const envelope: RelayEnvelope = {
      id,
      seniorId: seniorIdFromToken,
      ivHex: bytesToHex(iv),
      authTagHex: bytesToHex(authTag),
      ciphertextHex: bytesToHex(encrypted),
      createdAtMs: nowMs,
      expiresAtMs: nowMs + this.ttlMs,
    };

    this.records.set(id, envelope);
    return { ...envelope };
  }

  pull(
    seniorIdFromToken: string,
    nowMs: number = Date.now()
  ): PulledRelayItem[] {
    const results: PulledRelayItem[] = [];

    for (const [id, envelope] of this.records.entries()) {
      if (envelope.expiresAtMs <= nowMs) {
        this.records.delete(id);
        continue;
      }

      if (envelope.seniorId !== seniorIdFromToken) {
        continue;
      }

      const iv = hexToBytes(envelope.ivHex);
      const authTag = hexToBytes(envelope.authTagHex);
      const ciphertext = hexToBytes(envelope.ciphertextHex);
      const aad = textEncoder.encode(`${envelope.seniorId}:${envelope.id}`);

      const decipher = createDecipheriv(AES_ALGORITHM, this.key, iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(authTag);

      const decryptedBytes = concatBytes(
        decipher.update(ciphertext),
        decipher.final()
      );
      const decrypted = textDecoder.decode(decryptedBytes);

      const draft = JSON.parse(decrypted) as InboxItemDraft;
      results.push({
        id: envelope.id,
        draft,
        createdAtMs: envelope.createdAtMs,
      });
    }

    results.sort((a, b) => a.createdAtMs - b.createdAtMs);
    return results;
  }

  ack(seniorIdFromToken: string, ids: readonly string[]): number {
    let deleted = 0;
    for (const id of ids) {
      if (typeof id !== 'string' || id.length === 0) {
        continue;
      }
      const existing = this.records.get(id);
      if (existing !== undefined && existing.seniorId === seniorIdFromToken) {
        this.records.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }

  inspectStoredEnvelopes(): readonly RelayEnvelope[] {
    return Array.from(this.records.values(), (env) => ({ ...env }));
  }

  clear(): void {
    this.records.clear();
  }
}

export function createRelayStore(opts?: RelayStoreOptions): EncryptedRelayStore {
  return new EncryptedRelayStore(opts);
}
