import type { VaultBackupPayload } from './encryptedBackup';

const SYNC_AAD = '0arc:sync:v1';
const SYNC_ITERATIONS = 120_000;
const QR_CHUNK_SIZE = 700;

export interface ParsedQrChunk {
  sid: string;
  index: number;
  total: number;
  data: string;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy.buffer;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function compressBytes(data: Uint8Array): Promise<{ bytes: Uint8Array; compressed: boolean }> {
  if (typeof CompressionStream === 'undefined') {
    return { bytes: data, compressed: false };
  }
  try {
    const stream = new Blob([toArrayBuffer(data)])
      .stream()
      .pipeThrough(new CompressionStream('deflate-raw'));
    const ab = await new Response(stream).arrayBuffer();
    return { bytes: new Uint8Array(ab), compressed: true };
  } catch {
    return { bytes: data, compressed: false };
  }
}

async function decompressBytes(data: Uint8Array, compressed: boolean): Promise<Uint8Array> {
  if (!compressed) return data;
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This device cannot decompress compressed sync packets.');
  }
  const stream = new Blob([toArrayBuffer(data)])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

async function deriveSyncKey(pin: string, salt: ArrayBuffer): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(new TextEncoder().encode(pin.trim())),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: SYNC_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function generateSyncPin(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, '0');
}

function randomSessionId(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => alphabet[b % alphabet.length])
    .join('');
}

/**
 * Compresses and encrypts a full vault snapshot with the 6-digit Sync PIN.
 * Binary format before base64url: [flags(1)][salt(16)][iv(12)][ciphertext...]
 */
export async function encryptSyncPacket(
  payload: VaultBackupPayload,
  pin: string
): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(payload));
  const { bytes: prepared, compressed } = await compressBytes(raw);

  const salt = new Uint8Array(new ArrayBuffer(16));
  const iv = new Uint8Array(new ArrayBuffer(12));
  crypto.getRandomValues(salt);
  crypto.getRandomValues(iv);

  const key = await deriveSyncKey(pin, toArrayBuffer(salt));
  const ctBuf = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(new TextEncoder().encode(SYNC_AAD)),
    },
    key,
    toArrayBuffer(prepared)
  );
  const ct = new Uint8Array(ctBuf);

  const packed = new Uint8Array(1 + salt.length + iv.length + ct.length);
  packed[0] = compressed ? 1 : 0;
  packed.set(salt, 1);
  packed.set(iv, 17);
  packed.set(ct, 29);

  return toBase64Url(packed);
}

export async function decryptSyncPacket(
  packetBase64Url: string,
  pin: string
): Promise<VaultBackupPayload> {
  if (!pin.trim()) {
    throw new Error('Enter the 6-digit Sync PIN shown on the sending device.');
  }
  const packed = fromBase64Url(packetBase64Url.trim());
  if (packed.length < 32) {
    throw new Error('Sync packet is incomplete or corrupted.');
  }

  const compressed = (packed[0] & 1) === 1;
  const salt = packed.slice(1, 17);
  const iv = packed.slice(17, 29);
  const ct = packed.slice(29);

  const key = await deriveSyncKey(pin, toArrayBuffer(salt));
  let decrypted: ArrayBuffer;
  try {
    decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(new TextEncoder().encode(SYNC_AAD)),
      },
      key,
      toArrayBuffer(ct)
    );
  } catch {
    throw new Error('Incorrect Sync PIN or corrupted sync data.');
  }

  const plainBytes = await decompressBytes(new Uint8Array(decrypted), compressed);
  const parsed = JSON.parse(new TextDecoder().decode(plainBytes)) as VaultBackupPayload;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tools)) {
    throw new Error('Invalid synced vault payload.');
  }
  return parsed;
}

export function encodeQrChunks(packet: string, chunkSize = QR_CHUNK_SIZE): string[] {
  const sid = randomSessionId();
  const total = Math.max(1, Math.ceil(packet.length / chunkSize));
  const chunks: string[] = [];
  for (let i = 0; i < total; i++) {
    const slice = packet.slice(i * chunkSize, (i + 1) * chunkSize);
    chunks.push(`0ARCQ:${sid}:${i + 1}:${total}:${slice}`);
  }
  return chunks;
}

export function parseQrChunk(rawText: string): ParsedQrChunk | null {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith('0ARCQ:')) return null;
  const parts = trimmed.split(':');
  if (parts.length < 5) return null;
  const sid = parts[1];
  const index = Number(parts[2]);
  const total = Number(parts[3]);
  const data = parts.slice(4).join(':');
  if (!sid || !Number.isInteger(index) || !Number.isInteger(total) || index < 1 || index > total || !data) {
    return null;
  }
  return { sid, index, total, data };
}

/**
 * Encodes a WebRTC Offer/Answer SDP into a compact QR-safe string (`0ARCS1:<c|p>:<b64url>`).
 */
export async function encodeWebRtcSignal(desc: RTCSessionDescriptionInit): Promise<string> {
  const minimal = JSON.stringify({
    t: desc.type === 'offer' ? 'o' : 'a',
    s: desc.sdp || '',
  });
  const raw = new TextEncoder().encode(minimal);
  const { bytes, compressed } = await compressBytes(raw);
  return `0ARCS1:${compressed ? 'c' : 'p'}:${toBase64Url(bytes)}`;
}

export async function decodeWebRtcSignal(code: string): Promise<RTCSessionDescriptionInit> {
  const trimmed = code.trim();
  if (!trimmed.startsWith('0ARCS1:')) {
    throw new Error('Invalid Wi-Fi P2P pairing code.');
  }
  const rest = trimmed.slice('0ARCS1:'.length);
  const colonIdx = rest.indexOf(':');
  if (colonIdx <= 0) {
    throw new Error('Malformed Wi-Fi P2P pairing code.');
  }
  const mode = rest.slice(0, colonIdx);
  const b64 = rest.slice(colonIdx + 1);
  const raw = await decompressBytes(fromBase64Url(b64), mode === 'c');
  const parsed = JSON.parse(new TextDecoder().decode(raw)) as { t: string; s: string };
  if (!parsed || typeof parsed.s !== 'string' || (parsed.t !== 'o' && parsed.t !== 'a')) {
    throw new Error('Corrupted Wi-Fi P2P pairing code.');
  }
  return {
    type: parsed.t === 'o' ? 'offer' : 'answer',
    sdp: parsed.s,
  };
}

export async function waitForIceGathering(
  pc: RTCPeerConnection,
  timeoutMs = 1500
): Promise<void> {
  if (pc.iceGatheringState === 'complete') return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      pc.removeEventListener('icegatheringstatechange', onState);
      pc.removeEventListener('icecandidate', onCandidate);
      clearTimeout(timer);
      resolve();
    };

    const onState = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };

    const onCandidate = (ev: RTCPeerConnectionIceEvent) => {
      if (!ev.candidate) finish();
    };

    const timer = window.setTimeout(finish, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onState);
    pc.addEventListener('icecandidate', onCandidate);
  });
}

export async function sendPacketOverDataChannel(
  channel: RTCDataChannel,
  packet: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  const CHUNK_SIZE = 16_000;
  const totalChunks = Math.max(1, Math.ceil(packet.length / CHUNK_SIZE));

  channel.send(JSON.stringify({ kind: 'meta', totalChunks, totalLength: packet.length }));

  for (let i = 0; i < totalChunks; i++) {
    while (channel.bufferedAmount > 512 * 1024) {
      await new Promise((r) => setTimeout(r, 25));
      if (channel.readyState !== 'open') {
        throw new Error('P2P connection closed during transfer.');
      }
    }
    const slice = packet.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    channel.send(JSON.stringify({ kind: 'chunk', index: i, data: slice }));
    onProgress?.(Math.round(((i + 1) / totalChunks) * 100));
  }

  channel.send(JSON.stringify({ kind: 'done' }));
}
