import type {
  AppSettings,
  MediaItem,
  NoteItem,
  PasswordItem,
  ToolItem,
} from '../types';

export interface EncryptedPasswordVaultBundle {
  cipherRaw: string | null;
  lockRaw: string | null;
  deviceKeyRaw: string | null;
}

export interface VaultBackupPayload {
  version: '2.0.0';
  exportedAt: string;
  tools: ToolItem[];
  notes: NoteItem[];
  media: MediaItem[];
  settings: AppSettings;
  passwords?: PasswordItem[];
  passwordVault?: EncryptedPasswordVaultBundle;
}

export interface Encrypted0arcBackupFile {
  format: '0arc-encrypted-backup';
  v: 1;
  kdf: 'PBKDF2-SHA-512';
  iterations: number;
  comp: 'deflate-raw' | 'none';
  salt: string;
  iv: string;
  ct: string;
}

const BACKUP_ITERATIONS = 600_000;
const BACKUP_AAD = '0arc:backup:v1';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy.buffer;
}

function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function toBase64(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < arr.length; i += chunkSize) {
    binary += String.fromCharCode(...arr.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function randomBytes(length: number): ArrayBuffer {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(bytes);
  return bytes.buffer;
}

async function compressDeflateRaw(data: Uint8Array): Promise<{ bytes: Uint8Array; comp: 'deflate-raw' | 'none' }> {
  if (typeof CompressionStream === 'undefined') {
    return { bytes: data, comp: 'none' };
  }
  try {
    const stream = new Blob([toArrayBuffer(data)])
      .stream()
      .pipeThrough(new CompressionStream('deflate-raw'));
    const ab = await new Response(stream).arrayBuffer();
    return { bytes: new Uint8Array(ab), comp: 'deflate-raw' };
  } catch {
    return { bytes: data, comp: 'none' };
  }
}

async function decompressDeflateRaw(data: Uint8Array, comp: 'deflate-raw' | 'none'): Promise<Uint8Array> {
  if (comp !== 'deflate-raw') return data;
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress deflate-raw .0arc backups.');
  }
  const stream = new Blob([toArrayBuffer(data)])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

async function deriveBackupKey(
  passphrase: string,
  salt: ArrayBuffer,
  iterations: number
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(encodeUtf8(passphrase)),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-512',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function isEncryptedBackupContent(rawText: string): boolean {
  try {
    const parsed = JSON.parse(rawText) as Partial<Encrypted0arcBackupFile>;
    return Boolean(
      parsed &&
        parsed.format === '0arc-encrypted-backup' &&
        parsed.v === 1 &&
        typeof parsed.salt === 'string' &&
        typeof parsed.iv === 'string' &&
        typeof parsed.ct === 'string'
    );
  } catch {
    return false;
  }
}

export async function createEncryptedBackupFile(
  payload: VaultBackupPayload,
  passphrase: string
): Promise<string> {
  if (!passphrase || passphrase.length < 4) {
    throw new Error('Backup passphrase must be at least 4 characters.');
  }

  const rawBytes = encodeUtf8(JSON.stringify(payload));
  const { bytes: preparedBytes, comp } = await compressDeflateRaw(rawBytes);

  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = await deriveBackupKey(passphrase, salt, BACKUP_ITERATIONS);

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: toArrayBuffer(encodeUtf8(BACKUP_AAD)),
    },
    key,
    toArrayBuffer(preparedBytes)
  );

  const envelope: Encrypted0arcBackupFile = {
    format: '0arc-encrypted-backup',
    v: 1,
    kdf: 'PBKDF2-SHA-512',
    iterations: BACKUP_ITERATIONS,
    comp,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(ciphertext),
  };

  return JSON.stringify(envelope, null, 2);
}

export async function decryptEncryptedBackupFile(
  rawText: string,
  passphrase: string
): Promise<VaultBackupPayload> {
  let envelope: Encrypted0arcBackupFile;
  try {
    envelope = JSON.parse(rawText) as Encrypted0arcBackupFile;
  } catch {
    throw new Error('Invalid .0arc backup file format.');
  }

  if (
    !envelope ||
    envelope.format !== '0arc-encrypted-backup' ||
    envelope.v !== 1 ||
    !envelope.salt ||
    !envelope.iv ||
    !envelope.ct
  ) {
    throw new Error('Unrecognized .0arc backup structure.');
  }

  if (!passphrase) {
    throw new Error('Enter the backup passphrase.');
  }

  const saltBuf = toArrayBuffer(fromBase64(envelope.salt));
  const ivBuf = toArrayBuffer(fromBase64(envelope.iv));
  const ctBuf = toArrayBuffer(fromBase64(envelope.ct));
  const iterations = Number(envelope.iterations) || BACKUP_ITERATIONS;

  const key = await deriveBackupKey(passphrase, saltBuf, iterations);

  let decrypted: ArrayBuffer;
  try {
    decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ivBuf,
        additionalData: toArrayBuffer(encodeUtf8(BACKUP_AAD)),
      },
      key,
      ctBuf
    );
  } catch {
    throw new Error('Incorrect backup passphrase or corrupted .0arc file.');
  }

  const plainBytes = await decompressDeflateRaw(
    new Uint8Array(decrypted),
    envelope.comp === 'deflate-raw' ? 'deflate-raw' : 'none'
  );
  const jsonText = new TextDecoder().decode(plainBytes);
  const payload = JSON.parse(jsonText) as VaultBackupPayload;

  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.tools) || !Array.isArray(payload.notes)) {
    throw new Error('Backup payload is missing archive sections.');
  }

  return payload;
}
