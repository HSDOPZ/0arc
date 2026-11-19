import {
  createEncryptedBackupFile,
  decryptEncryptedBackupFile,
  VaultBackupPayload,
} from './encryptedBackup';
import { getVaultItem, removeVaultItem, setVaultItem } from './vaultStorage';

export const MONGO_SYNC_CONFIG_KEY = '0arc_sync_server_config';

export interface MongoSyncConfig {
  syncServerUrl: string;
  mongoUri: string;
  dbName: string;
  collectionName: string;
  vaultId: string;
  passphrase: string;
  autoSync: boolean;
  connected: boolean;
  lastSyncedAt: string | null;
}

export interface MongoTestResult {
  ok: boolean;
  exists: boolean;
  updatedAt: string | null;
  encrypted: boolean;
  counts: {
    tools?: number;
    notes?: number;
    media?: number;
    passwords?: number;
  } | null;
}

export function isTauriEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    '__TAURI_INTERNALS__' in window ||
    '__TAURI__' in window ||
    window.location.protocol === 'tauri:' ||
    window.location.hostname === 'tauri.localhost'
  );
}

export function getDefaultSyncServerUrl(): string {
  if (typeof window === 'undefined') return '';
  if (isTauriEnvironment()) return '';
  const { protocol, origin } = window.location;
  if (protocol === 'http:' || protocol === 'https:') {
    return origin;
  }
  return '';
}

function generateDefaultVaultId(): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `vault-${hex}`;
}

export function createInitialMongoSyncConfig(): MongoSyncConfig {
  return {
    syncServerUrl: getDefaultSyncServerUrl(),
    mongoUri: '',
    dbName: 'zeroarc',
    collectionName: 'vaults',
    vaultId: generateDefaultVaultId(),
    passphrase: '',
    autoSync: false,
    connected: false,
    lastSyncedAt: null,
  };
}

export async function loadMongoSyncConfig(): Promise<MongoSyncConfig> {
  const fallback = createInitialMongoSyncConfig();
  try {
    const raw = await getVaultItem(MONGO_SYNC_CONFIG_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<MongoSyncConfig>;
    return {
      syncServerUrl:
        typeof parsed.syncServerUrl === 'string' && parsed.syncServerUrl.trim()
          ? parsed.syncServerUrl.trim()
          : fallback.syncServerUrl,
      mongoUri: typeof parsed.mongoUri === 'string' ? parsed.mongoUri : '',
      dbName: typeof parsed.dbName === 'string' && parsed.dbName.trim() ? parsed.dbName.trim() : 'zeroarc',
      collectionName:
        typeof parsed.collectionName === 'string' && parsed.collectionName.trim()
          ? parsed.collectionName.trim()
          : 'vaults',
      vaultId: typeof parsed.vaultId === 'string' && parsed.vaultId.trim() ? parsed.vaultId.trim() : fallback.vaultId,
      passphrase: typeof parsed.passphrase === 'string' ? parsed.passphrase : '',
      autoSync: Boolean(parsed.autoSync),
      connected: Boolean(parsed.connected),
      lastSyncedAt: typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : null,
    };
  } catch {
    return fallback;
  }
}

export async function saveMongoSyncConfig(config: MongoSyncConfig): Promise<void> {
  await setVaultItem(MONGO_SYNC_CONFIG_KEY, JSON.stringify(config));
}

export async function clearMongoSyncConfig(): Promise<void> {
  await removeVaultItem(MONGO_SYNC_CONFIG_KEY);
}

function buildApiBase(syncServerUrl: string): string {
  const trimmed = syncServerUrl.trim().replace(/\/+$/, '');
  if (trimmed) {
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      throw new Error('Sync Server URL must start with http:// or https://');
    }
    return trimmed;
  }
  const fallback = getDefaultSyncServerUrl();
  if (!fallback) {
    throw new Error(
      'Enter a 0arc Sync Server URL (e.g. https://your-0arc-server.com) to bridge MongoDB from the native app.'
    );
  }
  return fallback;
}

async function postSyncApi<T>(
  syncServerUrl: string,
  endpoint: '/api/sync/test' | '/api/sync/push' | '/api/sync/pull',
  body: Record<string, unknown>
): Promise<T> {
  const base = buildApiBase(syncServerUrl);
  let res: Response;
  try {
    res = await fetch(`${base}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      `Could not reach Sync Server at ${base}. Verify the URL and ensure the server is running.`
    );
  }

  let data: (T & { ok?: boolean; error?: string }) | null = null;
  try {
    data = (await res.json()) as T & { ok?: boolean; error?: string };
  } catch {
    throw new Error(`Sync Server returned an invalid response (HTTP ${res.status}).`);
  }

  if (!res.ok || !data || data.ok === false) {
    throw new Error(data?.error || `Sync request failed (HTTP ${res.status}).`);
  }

  return data;
}

export async function testMongoSyncConnection(config: MongoSyncConfig): Promise<MongoTestResult> {
  return postSyncApi<MongoTestResult>(config.syncServerUrl, '/api/sync/test', {
    mongoUri: config.mongoUri.trim(),
    dbName: config.dbName.trim() || 'zeroarc',
    collectionName: config.collectionName.trim() || 'vaults',
    vaultId: config.vaultId.trim(),
  });
}

export async function pushVaultToMongo(
  config: MongoSyncConfig,
  payload: VaultBackupPayload
): Promise<{ updatedAt: string }> {
  const counts = {
    tools: payload.tools.length,
    notes: payload.notes.length,
    media: payload.media.length,
    passwords: payload.passwords?.length ?? (payload.passwordVault?.cipherRaw ? 1 : 0),
  };

  let document: Record<string, unknown>;
  const passphrase = config.passphrase.trim();
  if (passphrase) {
    if (passphrase.length < 4) {
      throw new Error('Sync encryption passphrase must be at least 4 characters (or leave empty).');
    }
    const encryptedEnvelope = await createEncryptedBackupFile(payload, passphrase);
    document = {
      encrypted: true,
      envelope: encryptedEnvelope,
      counts,
    };
  } else {
    document = {
      encrypted: false,
      payload,
      counts,
    };
  }

  const res = await postSyncApi<{ ok: true; updatedAt: string }>(
    config.syncServerUrl,
    '/api/sync/push',
    {
      mongoUri: config.mongoUri.trim(),
      dbName: config.dbName.trim() || 'zeroarc',
      collectionName: config.collectionName.trim() || 'vaults',
      vaultId: config.vaultId.trim(),
      document,
    }
  );

  return { updatedAt: res.updatedAt };
}

export async function pullVaultFromMongo(
  config: MongoSyncConfig
): Promise<{ found: boolean; updatedAt: string | null; payload: VaultBackupPayload | null }> {
  const res = await postSyncApi<{
    ok: true;
    found: boolean;
    document: {
      encrypted?: boolean;
      envelope?: string;
      payload?: VaultBackupPayload;
      updatedAt?: string;
    } | null;
  }>(config.syncServerUrl, '/api/sync/pull', {
    mongoUri: config.mongoUri.trim(),
    dbName: config.dbName.trim() || 'zeroarc',
    collectionName: config.collectionName.trim() || 'vaults',
    vaultId: config.vaultId.trim(),
  });

  if (!res.found || !res.document) {
    return { found: false, updatedAt: null, payload: null };
  }

  const doc = res.document;
  if (doc.encrypted && typeof doc.envelope === 'string') {
    const passphrase = config.passphrase.trim();
    if (!passphrase) {
      throw new Error('This MongoDB vault is encrypted. Enter its Sync Encryption Passphrase to pull.');
    }
    const payload = await decryptEncryptedBackupFile(doc.envelope, passphrase);
    return {
      found: true,
      updatedAt: doc.updatedAt ?? null,
      payload,
    };
  }

  if (doc.payload && typeof doc.payload === 'object') {
    return {
      found: true,
      updatedAt: doc.updatedAt ?? null,
      payload: doc.payload,
    };
  }

  throw new Error('Remote MongoDB document does not contain a recognized 0arc vault payload.');
}
