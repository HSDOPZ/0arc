import type { PasswordItem } from '../types';
import { getVaultItem, removeVaultItem, setVaultItem } from './vaultStorage';

export const PASSWORDS_CIPHER_KEY = '0arc_vault_passwords';
export const PASSWORDS_LOCK_KEY = '0arc_vault_passwords_lock';
export const PASSWORDS_UNLOCKED_DEVICE_KEY = '0arc_vault_passwords_dk';

const PBKDF2_ITERATIONS = 600_000;
const VAULT_AAD = '0arc:passwords:v2';
const LOCK_WRAP_AAD = '0arc:lock-wrap:v2';
const RECOVERY_WRAP_AAD = '0arc:recovery-wrap:v2';

export const RANDOM_SECURITY_QUESTIONS = [
  'What was the name of your first school?',
  'What city or town were you born in?',
  'What was the name of your childhood best friend?',
  'What was the name of the street you grew up on?',
  'What was the first movie you remember watching in a theater?',
  'What was your childhood nickname?',
  'What was the name of your first pet?',
  'What was your dream job when you were 10 years old?',
  'What is the first name of your favorite teacher?',
  'What is the name of the place you would most like to visit?',
] as const;

export function pickRandomSecurityQuestion(exclude?: string): string {
  const pool = exclude
    ? RANDOM_SECURITY_QUESTIONS.filter((q) => q !== exclude)
    : [...RANDOM_SECURITY_QUESTIONS];
  const randomBuffer = new Uint32Array(1);
  crypto.getRandomValues(randomBuffer);
  return pool[randomBuffer[0] % pool.length];
}

interface EncryptedPasswordsEnvelope {
  v: 2;
  iv: string;
  ct: string;
  count: number;
}

interface PasswordLockRecord {
  v: 2;
  salt: string;
  iterations: number;
  wrapIv: string;
  wrappedDek: string;
  recoveryQuestion: string;
  recoverySalt: string;
  recoveryIterations: number;
  recoveryWrapIv: string;
  recoveryWrappedDek: string;
  createdAt: string;
}

export interface EncryptedPasswordVaultRawState {
  cipherRaw: string | null;
  lockRaw: string | null;
  deviceKeyRaw: string | null;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy.buffer;
}

function encodeUtf8(text: string): ArrayBuffer {
  return toArrayBuffer(new TextEncoder().encode(text));
}

function decodeUtf8(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(buffer);
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

function fromBase64(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function randomBytes(length: number): ArrayBuffer {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(bytes);
  return bytes.buffer;
}

function normalizeRecoveryAnswer(answer: string): string {
  return answer.trim().replace(/\s+/g, ' ').toLowerCase();
}

async function deriveWrappingKey(
  passphrase: string,
  salt: ArrayBuffer,
  iterations: number
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encodeUtf8(passphrase),
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

async function generateRawDek(): Promise<ArrayBuffer> {
  return randomBytes(32);
}

async function importDekKey(rawDek: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    rawDek,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function wrapDekWithKek(
  rawDek: ArrayBuffer,
  kek: CryptoKey,
  aad: string
): Promise<{ iv: string; wrapped: string }> {
  const iv = randomBytes(12);
  const wrapped = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: encodeUtf8(aad),
    },
    kek,
    rawDek
  );
  return {
    iv: toBase64(iv),
    wrapped: toBase64(wrapped),
  };
}

async function unwrapDekWithKek(
  wrappedB64: string,
  ivB64: string,
  kek: CryptoKey,
  aad: string
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64(ivB64),
      additionalData: encodeUtf8(aad),
    },
    kek,
    fromBase64(wrappedB64)
  );
}

async function readLockRecord(): Promise<PasswordLockRecord | null> {
  try {
    const raw = await getVaultItem(PASSWORDS_LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PasswordLockRecord;
    if (
      parsed &&
      parsed.v === 2 &&
      typeof parsed.salt === 'string' &&
      typeof parsed.wrappedDek === 'string' &&
      typeof parsed.recoveryQuestion === 'string' &&
      typeof parsed.recoveryWrappedDek === 'string'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

async function readEnvelope(): Promise<EncryptedPasswordsEnvelope | null> {
  try {
    const raw = await getVaultItem(PASSWORDS_CIPHER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EncryptedPasswordsEnvelope;
    if (
      parsed &&
      parsed.v === 2 &&
      typeof parsed.iv === 'string' &&
      typeof parsed.ct === 'string'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

async function encryptEntriesWithDek(
  entries: PasswordItem[],
  dek: CryptoKey
): Promise<void> {
  const iv = randomBytes(12);
  const plaintext = encodeUtf8(JSON.stringify(entries));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: encodeUtf8(VAULT_AAD),
    },
    dek,
    plaintext
  );

  const envelope: EncryptedPasswordsEnvelope = {
    v: 2,
    iv: toBase64(iv),
    ct: toBase64(ciphertext),
    count: entries.length,
  };
  await setVaultItem(PASSWORDS_CIPHER_KEY, JSON.stringify(envelope));
}

async function decryptEntriesWithDek(dek: CryptoKey): Promise<PasswordItem[]> {
  const envelope = await readEnvelope();
  if (!envelope) return [];

  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64(envelope.iv),
      additionalData: encodeUtf8(VAULT_AAD),
    },
    dek,
    fromBase64(envelope.ct)
  );

  const parsed = JSON.parse(decodeUtf8(decrypted));
  return Array.isArray(parsed) ? (parsed as PasswordItem[]) : [];
}

async function getOrCreateUnprotectedDeviceKey(): Promise<CryptoKey> {
  let rawB64 = await getVaultItem(PASSWORDS_UNLOCKED_DEVICE_KEY);
  let rawKey: ArrayBuffer;
  if (rawB64) {
    rawKey = fromBase64(rawB64);
  } else {
    rawKey = await generateRawDek();
    rawB64 = toBase64(rawKey);
    await setVaultItem(PASSWORDS_UNLOCKED_DEVICE_KEY, rawB64);
  }
  return importDekKey(rawKey);
}

export async function getPasswordLockStatus(): Promise<{
  hasLock: boolean;
  recoveryQuestion: string | null;
  storedCount: number;
}> {
  const [lock, envelope] = await Promise.all([readLockRecord(), readEnvelope()]);
  return {
    hasLock: Boolean(lock),
    recoveryQuestion: lock?.recoveryQuestion ?? null,
    storedCount: envelope?.count ?? 0,
  };
}

export async function loadUnprotectedPasswords(): Promise<{
  entries: PasswordItem[];
  dek: CryptoKey;
}> {
  const dek = await getOrCreateUnprotectedDeviceKey();
  const entries = await decryptEntriesWithDek(dek).catch(() => []);
  return { entries, dek };
}

export async function persistPasswords(
  entries: PasswordItem[],
  dek: CryptoKey | null
): Promise<void> {
  const lock = await readLockRecord();
  if (lock) {
    if (!dek) {
      throw new Error('Password vault is locked.');
    }
    await encryptEntriesWithDek(entries, dek);
    return;
  }
  const activeDek = dek || (await getOrCreateUnprotectedDeviceKey());
  await encryptEntriesWithDek(entries, activeDek);
}

/**
 * Sets up the Main Lock (saved once) + random recovery question.
 * Seals all existing password entries under a fresh 256-bit DEK wrapped by
 * PBKDF2-HMAC-SHA-512 (600,000 iterations).
 */
export async function setupPasswordMainLock(
  mainPassword: string,
  recoveryQuestion: string,
  recoveryAnswer: string,
  existingEntries: PasswordItem[]
): Promise<{ dek: CryptoKey }> {
  if (await readLockRecord()) {
    throw new Error('Main lock is already set. Use the recovery question to reset it.');
  }
  if (!mainPassword || mainPassword.length < 4) {
    throw new Error('Main lock password must be at least 4 characters.');
  }
  const normalizedAnswer = normalizeRecoveryAnswer(recoveryAnswer);
  if (!normalizedAnswer) {
    throw new Error('Please provide an answer for the recovery question.');
  }

  const rawDek = await generateRawDek();
  const dek = await importDekKey(rawDek);

  const salt = randomBytes(32);
  const recoverySalt = randomBytes(32);

  const kek = await deriveWrappingKey(mainPassword, salt, PBKDF2_ITERATIONS);
  const recoveryKek = await deriveWrappingKey(
    normalizedAnswer,
    recoverySalt,
    PBKDF2_ITERATIONS
  );

  const primaryWrap = await wrapDekWithKek(rawDek, kek, LOCK_WRAP_AAD);
  const recoveryWrap = await wrapDekWithKek(rawDek, recoveryKek, RECOVERY_WRAP_AAD);

  new Uint8Array(rawDek).fill(0);

  await encryptEntriesWithDek(existingEntries, dek);

  const lockRecord: PasswordLockRecord = {
    v: 2,
    salt: toBase64(salt),
    iterations: PBKDF2_ITERATIONS,
    wrapIv: primaryWrap.iv,
    wrappedDek: primaryWrap.wrapped,
    recoveryQuestion: recoveryQuestion.trim(),
    recoverySalt: toBase64(recoverySalt),
    recoveryIterations: PBKDF2_ITERATIONS,
    recoveryWrapIv: recoveryWrap.iv,
    recoveryWrappedDek: recoveryWrap.wrapped,
    createdAt: new Date().toISOString(),
  };

  await setVaultItem(PASSWORDS_LOCK_KEY, JSON.stringify(lockRecord));
  await removeVaultItem(PASSWORDS_UNLOCKED_DEVICE_KEY);

  return { dek };
}

export async function unlockPasswordVaultWithPassword(
  mainPassword: string
): Promise<{ dek: CryptoKey; entries: PasswordItem[] }> {
  const lock = await readLockRecord();
  if (!lock) {
    return loadUnprotectedPasswords();
  }

  const kek = await deriveWrappingKey(
    mainPassword,
    fromBase64(lock.salt),
    lock.iterations
  );

  let rawDek: ArrayBuffer;
  try {
    rawDek = await unwrapDekWithKek(
      lock.wrappedDek,
      lock.wrapIv,
      kek,
      LOCK_WRAP_AAD
    );
  } catch {
    throw new Error('Incorrect main lock password.');
  }

  const dek = await importDekKey(rawDek);
  new Uint8Array(rawDek).fill(0);

  const entries = await decryptEntriesWithDek(dek);
  return { dek, entries };
}

export async function resetPasswordMainLockWithAnswer(
  recoveryAnswer: string,
  newMainPassword: string
): Promise<{ dek: CryptoKey; entries: PasswordItem[]; nextQuestion: string }> {
  const lock = await readLockRecord();
  if (!lock) {
    throw new Error('No main lock is configured.');
  }
  if (!newMainPassword || newMainPassword.length < 4) {
    throw new Error('New main lock password must be at least 4 characters.');
  }

  const normalizedAnswer = normalizeRecoveryAnswer(recoveryAnswer);
  if (!normalizedAnswer) {
    throw new Error('Enter your answer to the recovery question.');
  }

  const recoveryKek = await deriveWrappingKey(
    normalizedAnswer,
    fromBase64(lock.recoverySalt),
    lock.recoveryIterations
  );

  let rawDek: ArrayBuffer;
  try {
    rawDek = await unwrapDekWithKek(
      lock.recoveryWrappedDek,
      lock.recoveryWrapIv,
      recoveryKek,
      RECOVERY_WRAP_AAD
    );
  } catch {
    throw new Error('Incorrect recovery answer.');
  }

  const newSalt = randomBytes(32);
  const newKek = await deriveWrappingKey(
    newMainPassword,
    newSalt,
    PBKDF2_ITERATIONS
  );
  const newWrap = await wrapDekWithKek(rawDek, newKek, LOCK_WRAP_AAD);

  const dek = await importDekKey(rawDek);
  new Uint8Array(rawDek).fill(0);

  const updatedLock: PasswordLockRecord = {
    ...lock,
    salt: toBase64(newSalt),
    iterations: PBKDF2_ITERATIONS,
    wrapIv: newWrap.iv,
    wrappedDek: newWrap.wrapped,
  };
  await setVaultItem(PASSWORDS_LOCK_KEY, JSON.stringify(updatedLock));

  const entries = await decryptEntriesWithDek(dek);
  return { dek, entries, nextQuestion: lock.recoveryQuestion };
}

export async function removePasswordMainLock(
  currentPassword: string
): Promise<{ dek: CryptoKey; entries: PasswordItem[] }> {
  const { entries } = await unlockPasswordVaultWithPassword(currentPassword);
  await removeVaultItem(PASSWORDS_LOCK_KEY);
  const deviceDek = await getOrCreateUnprotectedDeviceKey();
  await encryptEntriesWithDek(entries, deviceDek);
  return { dek: deviceDek, entries };
}

export async function clearPasswordStorage(): Promise<void> {
  await Promise.all([
    removeVaultItem(PASSWORDS_CIPHER_KEY),
    removeVaultItem(PASSWORDS_LOCK_KEY),
    removeVaultItem(PASSWORDS_UNLOCKED_DEVICE_KEY),
  ]);
}

export async function exportEncryptedPasswordVaultState(): Promise<EncryptedPasswordVaultRawState> {
  const [cipherRaw, lockRaw, deviceKeyRaw] = await Promise.all([
    getVaultItem(PASSWORDS_CIPHER_KEY),
    getVaultItem(PASSWORDS_LOCK_KEY),
    getVaultItem(PASSWORDS_UNLOCKED_DEVICE_KEY),
  ]);
  return { cipherRaw, lockRaw, deviceKeyRaw };
}

export async function restoreEncryptedPasswordVaultRawState(
  state: EncryptedPasswordVaultRawState
): Promise<void> {
  if (state.cipherRaw !== null) {
    await setVaultItem(PASSWORDS_CIPHER_KEY, state.cipherRaw);
  } else {
    await removeVaultItem(PASSWORDS_CIPHER_KEY);
  }

  if (state.lockRaw !== null) {
    await setVaultItem(PASSWORDS_LOCK_KEY, state.lockRaw);
  } else {
    await removeVaultItem(PASSWORDS_LOCK_KEY);
  }

  if (state.deviceKeyRaw !== null) {
    await setVaultItem(PASSWORDS_UNLOCKED_DEVICE_KEY, state.deviceKeyRaw);
  } else {
    await removeVaultItem(PASSWORDS_UNLOCKED_DEVICE_KEY);
  }
}

export function generateStrongPassword(length = 18): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*-_=+?';
  const all = upper + lower + digits + symbols;

  const rnd = new Uint32Array(length);
  crypto.getRandomValues(rnd);

  const chars = [
    upper[rnd[0] % upper.length],
    lower[rnd[1] % lower.length],
    digits[rnd[2] % digits.length],
    symbols[rnd[3] % symbols.length],
  ];

  for (let i = 4; i < length; i++) {
    chars.push(all[rnd[i] % all.length]);
  }

  const shuffleRnd = new Uint32Array(chars.length);
  crypto.getRandomValues(shuffleRnd);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = shuffleRnd[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}
