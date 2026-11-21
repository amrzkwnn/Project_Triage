import type { ExportDocument, Result } from '../types';
import { SCHEMA_VERSION, type StoreError, type Vault } from './schema';

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function exportDocument(
  vault: Vault
): Promise<Result<string, StoreError>> {
  const settingsRes = await vault.getSettings();
  if (!settingsRes.ok) return settingsRes;

  const itemsRes = await vault.listItems();
  if (!itemsRes.ok) return itemsRes;

  const eventsRes = await vault.listEvents();
  if (!eventsRes.ok) return eventsRes;

  const auditRes = await vault.listAudit();
  if (!auditRes.ok) return auditRes;

  const blobsRes = await vault.listBlobs();
  if (!blobsRes.ok) return blobsRes;

  const doc: ExportDocument & { blobs?: Record<string, string> } = {
    schemaVersion: SCHEMA_VERSION,
    settings: settingsRes.value,
    items: itemsRes.value,
    events: eventsRes.value,
    audit: auditRes.value,
  };

  const blobEntries = Object.entries(blobsRes.value);
  if (blobEntries.length > 0) {
    const encoded: Record<string, string> = {};
    for (const [id, bytes] of blobEntries.sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      encoded[id] = bytesToBase64(bytes);
    }
    doc.blobs = encoded;
  }

  return {
    ok: true,
    value: JSON.stringify(doc, null, 2),
  };
}
