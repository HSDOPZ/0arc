import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {
  Camera,
  Check,
  Copy,
  Image as ImageIcon,
  Pause,
  Play,
  QrCode,
  RefreshCw,
  Wifi,
  X,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import { useArchive } from '../../context/ArchiveContext';
import { VaultBackupPayload } from '../../utils/encryptedBackup';
import {
  decodeWebRtcSignal,
  decryptSyncPacket,
  encodeQrChunks,
  encodeWebRtcSignal,
  encryptSyncPacket,
  generateSyncPin,
  parseQrChunk,
  sendPacketOverDataChannel,
  waitForIceGathering,
} from '../../utils/deviceSync';

interface DeviceSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SyncMethod = 'qr' | 'p2p';
type SyncRole = 'send' | 'receive';

interface ScannerInputProps {
  label: string;
  placeholder: string;
  onDetected: (text: string) => void;
}

const CodeScannerInput: React.FC<ScannerInputProps> = ({
  label,
  placeholder,
  onDetected,
}) => {
  const [cameraActive, setCameraActive] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastScannedRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const stopCamera = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  useEffect(() => {
    if (!cameraActive || !streamRef.current) return;
    const video = videoRef.current;
    if (!video) return;

    video.srcObject = streamRef.current;
    void video.play().catch(() => {});

    const tick = () => {
      if (!streamRef.current || !videoRef.current) return;
      const v = videoRef.current;
      if (v.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA && v.videoWidth > 0) {
        const canvas = canvasRef.current || document.createElement('canvas');
        canvasRef.current = canvas;
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imgData.data, imgData.width, imgData.height);
          if (code?.data) {
            emitCode(code.data);
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraActive]);

  const emitCode = (text: string) => {
    const now = Date.now();
    if (lastScannedRef.current.text === text && now - lastScannedRef.current.at < 1200) {
      return;
    }
    lastScannedRef.current = { text, at: now };
    onDetected(text);
  };

  const startCamera = async () => {
    setScanError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setScanError('Camera access is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
    } catch {
      setScanError('Unable to access camera. You can upload a QR image or paste the code below.');
      stopCamera();
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanError(null);

    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Canvas unavailable');
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imgData.data, imgData.width, imgData.height);
        if (code?.data) {
          emitCode(code.data);
        } else {
          setScanError('No QR code detected inside the selected image.');
        }
      } catch {
        setScanError('Failed to decode the selected image.');
      } finally {
        URL.revokeObjectURL(url);
        if (imageInputRef.current) imageInputRef.current.value = '';
      }
    };
    img.onerror = () => {
      setScanError('Could not load image file.');
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={cameraActive ? stopCamera : startCamera}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
            cameraActive
              ? 'bg-red-500/10 border-red-500/30 text-red-300'
              : 'bg-white/[0.06] hover:bg-white/[0.1] border-white/[0.1] text-white'
          }`}
        >
          <Camera className="w-3.5 h-3.5" />
          <span>{cameraActive ? 'Stop Camera' : 'Scan with Camera'}</span>
        </button>

        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.08] text-xs text-zinc-300 hover:text-white transition-colors"
        >
          <ImageIcon className="w-3.5 h-3.5 text-zinc-400" />
          <span>Upload QR Image</span>
        </button>
      </div>

      {cameraActive && (
        <div className="relative rounded-xl overflow-hidden border border-white/[0.1] bg-black aspect-video max-h-56">
          <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
        </div>
      )}

      {scanError && (
        <p className="text-[11px] font-mono text-red-400 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{scanError}</span>
        </p>
      )}

      <div>
        <label className="block text-[11px] font-mono text-zinc-500 mb-1">{label}</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={placeholder}
            className="flex-1 px-3 py-1.5 rounded-lg bg-black/40 border border-white/[0.08] text-xs font-mono text-white placeholder-zinc-600 focus:outline-none focus:border-white/30"
          />
          <button
            type="button"
            disabled={!pasteText.trim()}
            onClick={() => {
              if (!pasteText.trim()) return;
              onDetected(pasteText.trim());
              setPasteText('');
            }}
            className="px-3 py-1.5 rounded-lg bg-white text-black hover:bg-zinc-200 disabled:opacity-40 text-xs font-medium transition-colors shrink-0"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
};

export const DeviceSyncModal: React.FC<DeviceSyncModalProps> = ({ isOpen, onClose }) => {
  const { buildFullVaultPayload, importVaultPayload, addToast } = useArchive();

  const [method, setMethod] = useState<SyncMethod>('p2p');
  const [role, setRole] = useState<SyncRole>('send');

  // Shared receive import preview state
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [decryptedPayload, setDecryptedPayload] = useState<VaultBackupPayload | null>(null);
  const [applyingImport, setApplyingImport] = useState(false);

  // QR Send State
  const [qrPin, setQrPin] = useState('');
  const [qrChunks, setQrChunks] = useState<string[]>([]);
  const [qrIndex, setQrIndex] = useState(0);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [qrAutoPlay, setQrAutoPlay] = useState(true);
  const [qrBusy, setQrBusy] = useState(false);

  // QR Receive State
  const [receivedChunksMap, setReceivedChunksMap] = useState<Record<number, string>>({});
  const [receivedSession, setReceivedSession] = useState<{ sid: string; total: number } | null>(null);
  const [receivePin, setReceivePin] = useState('');
  const [qrDecodeError, setQrDecodeError] = useState<string | null>(null);

  // WebRTC P2P State
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const [p2pPin, setP2pPin] = useState('');
  const [p2pSignalOut, setP2pSignalOut] = useState('');
  const [p2pSignalQr, setP2pSignalQr] = useState('');
  const [p2pStatus, setP2pStatus] = useState<
    'idle' | 'creating' | 'waiting_answer' | 'waiting_offer' | 'connecting' | 'transferring' | 'awaiting_pin' | 'done' | 'error'
  >('idle');
  const [p2pProgress, setP2pProgress] = useState(0);
  const [p2pError, setP2pError] = useState<string | null>(null);
  const [p2pReceivedPacket, setP2pReceivedPacket] = useState<string | null>(null);
  const [p2pReceivePin, setP2pReceivePin] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const p2pIncomingRef = useRef<{ totalChunks: number; chunks: Record<number, string> }>({
    totalChunks: 0,
    chunks: {},
  });
  const p2pCompletedRef = useRef(false);

  const cleanupP2P = () => {
    if (dcRef.current) {
      try {
        dcRef.current.close();
      } catch {
        // ignore
      }
      dcRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        // ignore
      }
      pcRef.current = null;
    }
  };

  const resetAllTransientState = () => {
    cleanupP2P();
    setDecryptedPayload(null);
    setQrPin('');
    setQrChunks([]);
    setQrIndex(0);
    setQrDataUrl('');
    setReceivedChunksMap({});
    setReceivedSession(null);
    setReceivePin('');
    setQrDecodeError(null);
    setP2pPin('');
    setP2pSignalOut('');
    setP2pSignalQr('');
    setP2pStatus('idle');
    setP2pProgress(0);
    setP2pError(null);
    setP2pReceivedPacket(null);
    setP2pReceivePin('');
    p2pIncomingRef.current = { totalChunks: 0, chunks: {} };
    p2pCompletedRef.current = false;
  };

  useEffect(() => {
    if (!isOpen) {
      resetAllTransientState();
    }
    return () => {
      cleanupP2P();
    };
  }, [isOpen]);

  // Auto-render QR image for current QR chunk
  useEffect(() => {
    if (method !== 'qr' || role !== 'send' || qrChunks.length === 0) return;
    const activeChunk = qrChunks[qrIndex];
    if (!activeChunk) return;

    QRCode.toDataURL(activeChunk, {
      margin: 2,
      width: 260,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [method, role, qrChunks, qrIndex]);

  // Auto-cycle multi-part QR chunks smoothly
  useEffect(() => {
    if (method !== 'qr' || role !== 'send' || !qrAutoPlay || qrChunks.length <= 1) return;
    const id = window.setInterval(() => {
      setQrIndex((prev) => (prev + 1) % qrChunks.length);
    }, 1800);
    return () => clearInterval(id);
  }, [method, role, qrAutoPlay, qrChunks.length]);

  if (!isOpen) return null;

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleMethodOrRoleChange = (nextMethod: SyncMethod, nextRole: SyncRole) => {
    resetAllTransientState();
    setMethod(nextMethod);
    setRole(nextRole);
  };

  // ---------- QR SEND ----------
  const handleGenerateQr = async () => {
    setQrBusy(true);
    try {
      const pin = generateSyncPin();
      const payload = await buildFullVaultPayload();
      const packet = await encryptSyncPacket(payload, pin);
      const chunks = encodeQrChunks(packet);
      setQrPin(pin);
      setQrChunks(chunks);
      setQrIndex(0);
      setQrAutoPlay(chunks.length > 1);
    } catch (err: unknown) {
      addToast(
        'Sync Prep Failed',
        'error',
        err instanceof Error ? err.message : 'Unable to prepare QR sync.'
      );
    } finally {
      setQrBusy(false);
    }
  };

  // ---------- QR RECEIVE ----------
  const handleQrDetected = (raw: string) => {
    setQrDecodeError(null);
    const parsed = parseQrChunk(raw);
    if (!parsed) {
      setQrDecodeError('Scanned text is not a valid 0arc QR sync frame.');
      return;
    }

    if (receivedSession && receivedSession.sid !== parsed.sid) {
      // Starting scan for a newer session resets previous partial session
      setReceivedSession({ sid: parsed.sid, total: parsed.total });
      setReceivedChunksMap({ [parsed.index]: parsed.data });
      return;
    }

    if (!receivedSession) {
      setReceivedSession({ sid: parsed.sid, total: parsed.total });
    }
    setReceivedChunksMap((prev) => ({ ...prev, [parsed.index]: parsed.data }));
  };

  const receivedCount = Object.keys(receivedChunksMap).length;
  const allQrChunksCollected =
    Boolean(receivedSession) && receivedCount === receivedSession?.total;

  const handleDecryptQr = async () => {
    if (!receivedSession || !allQrChunksCollected) return;
    setQrDecodeError(null);
    try {
      const ordered: string[] = [];
      for (let i = 1; i <= receivedSession.total; i++) {
        ordered.push(receivedChunksMap[i] || '');
      }
      const packet = ordered.join('');
      const payload = await decryptSyncPacket(packet, receivePin);
      setDecryptedPayload(payload);
    } catch (err: unknown) {
      setQrDecodeError(err instanceof Error ? err.message : 'Failed to decrypt QR payload.');
    }
  };

  // ---------- LOCAL WI-FI P2P (WEBRTC) ----------
  const handleStartP2pSend = async () => {
    cleanupP2P();
    setP2pError(null);
    setP2pStatus('creating');
    setP2pProgress(0);

    try {
      const pin = generateSyncPin();
      const payload = await buildFullVaultPayload();
      const packet = await encryptSyncPacket(payload, pin);

      const pc = new RTCPeerConnection({ iceServers: [] });
      pcRef.current = pc;
      const channel = pc.createDataChannel('0arc-sync', { ordered: true });
      dcRef.current = channel;

      channel.onopen = async () => {
        setP2pStatus('transferring');
        try {
          await sendPacketOverDataChannel(channel, packet, (pct) => setP2pProgress(pct));
          p2pCompletedRef.current = true;
          setP2pStatus('done');
        } catch (err: unknown) {
          setP2pError(err instanceof Error ? err.message : 'Transfer interrupted.');
          setP2pStatus('error');
        }
      };

      pc.onconnectionstatechange = () => {
        if (
          (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') &&
          !p2pCompletedRef.current
        ) {
          setP2pError('Direct Wi-Fi P2P connection failed. Make sure both devices are on the same network.');
          setP2pStatus('error');
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc, 1500);

      const completeDesc = pc.localDescription || offer;
      const encoded = await encodeWebRtcSignal(completeDesc);
      const qr = await QRCode.toDataURL(encoded, {
        margin: 2,
        width: 220,
        errorCorrectionLevel: 'L',
        color: { dark: '#000000', light: '#ffffff' },
      });

      setP2pPin(pin);
      setP2pSignalOut(encoded);
      setP2pSignalQr(qr);
      setP2pStatus('waiting_answer');
    } catch (err: unknown) {
      setP2pError(err instanceof Error ? err.message : 'Could not initialize WebRTC P2P.');
      setP2pStatus('error');
    }
  };

  const handleApplyP2pAnswer = async (answerCode: string) => {
    setP2pError(null);
    const pc = pcRef.current;
    if (!pc) return;
    try {
      const answerDesc = await decodeWebRtcSignal(answerCode);
      if (answerDesc.type !== 'answer') {
        throw new Error('Expected a receiver Answer pairing code.');
      }
      setP2pStatus('connecting');
      await pc.setRemoteDescription(answerDesc);
    } catch (err: unknown) {
      setP2pError(err instanceof Error ? err.message : 'Invalid pairing answer.');
    }
  };

  const handleAcceptP2pOffer = async (offerCode: string) => {
    cleanupP2P();
    setP2pError(null);
    setP2pProgress(0);
    p2pIncomingRef.current = { totalChunks: 0, chunks: {} };

    try {
      const offerDesc = await decodeWebRtcSignal(offerCode);
      if (offerDesc.type !== 'offer') {
        throw new Error('Expected a sender Offer pairing code.');
      }

      setP2pStatus('creating');
      const pc = new RTCPeerConnection({ iceServers: [] });
      pcRef.current = pc;

      pc.ondatachannel = (event) => {
        const channel = event.channel;
        dcRef.current = channel;
        setP2pStatus('transferring');

        channel.onmessage = (msgEvent) => {
          try {
            const msg = JSON.parse(String(msgEvent.data)) as
              | { kind: 'meta'; totalChunks: number }
              | { kind: 'chunk'; index: number; data: string }
              | { kind: 'done' };

            if (msg.kind === 'meta') {
              p2pIncomingRef.current = { totalChunks: msg.totalChunks, chunks: {} };
            } else if (msg.kind === 'chunk') {
              p2pIncomingRef.current.chunks[msg.index] = msg.data;
              const got = Object.keys(p2pIncomingRef.current.chunks).length;
              const tot = Math.max(1, p2pIncomingRef.current.totalChunks);
              setP2pProgress(Math.round((got / tot) * 100));
            } else if (msg.kind === 'done') {
              const { totalChunks, chunks } = p2pIncomingRef.current;
              const parts: string[] = [];
              for (let i = 0; i < totalChunks; i++) {
                parts.push(chunks[i] || '');
              }
              p2pCompletedRef.current = true;
              setP2pReceivedPacket(parts.join(''));
              setP2pStatus('awaiting_pin');
            }
          } catch {
            // ignore non-json message
          }
        };
      };

      pc.onconnectionstatechange = () => {
        if (
          (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') &&
          !p2pCompletedRef.current
        ) {
          setP2pError('Direct Wi-Fi connection dropped. Ensure both devices are on the same Wi-Fi.');
        }
      };

      await pc.setRemoteDescription(offerDesc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGathering(pc, 1500);

      const completeDesc = pc.localDescription || answer;
      const encoded = await encodeWebRtcSignal(completeDesc);
      const qr = await QRCode.toDataURL(encoded, {
        margin: 2,
        width: 220,
        errorCorrectionLevel: 'L',
        color: { dark: '#000000', light: '#ffffff' },
      });

      setP2pSignalOut(encoded);
      setP2pSignalQr(qr);
      setP2pStatus('waiting_offer');
    } catch (err: unknown) {
      setP2pError(err instanceof Error ? err.message : 'Failed to process Offer pairing code.');
      setP2pStatus('error');
    }
  };

  const handleDecryptP2pPacket = async () => {
    if (!p2pReceivedPacket) return;
    setP2pError(null);
    try {
      const payload = await decryptSyncPacket(p2pReceivedPacket, p2pReceivePin);
      setDecryptedPayload(payload);
      setP2pStatus('done');
    } catch (err: unknown) {
      setP2pError(err instanceof Error ? err.message : 'Incorrect Sync PIN.');
    }
  };

  const handleApplySyncedPayload = async () => {
    if (!decryptedPayload) return;
    setApplyingImport(true);
    try {
      await importVaultPayload(decryptedPayload, importMode);
      onClose();
    } finally {
      setApplyingImport(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-xl max-h-[92dvh] surface-elevated border border-white/[0.1] rounded-t-2xl sm:rounded-xl overflow-hidden shadow-2xl flex flex-col pb-[env(safe-area-inset-bottom)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-white">Device Sync</h2>
            <p className="text-[11px] text-zinc-400">
              End-to-end encrypted transfer across Windows, Linux, Android & iOS with zero server.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 -mr-1.5 text-zinc-400 hover:text-white rounded-lg transition-colors"
            aria-label="Close sync modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Method + Role Bar */}
        <div className="px-5 py-3 border-b border-white/[0.06] bg-white/[0.015] flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="inline-flex rounded-lg bg-black/40 p-0.5 border border-white/[0.06]">
            <button
              type="button"
              onClick={() => handleMethodOrRoleChange('p2p', role)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${
                method === 'p2p' ? 'bg-white text-black font-medium' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Wifi className="w-3.5 h-3.5" />
              <span>Local Wi-Fi P2P</span>
            </button>
            <button
              type="button"
              onClick={() => handleMethodOrRoleChange('qr', role)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${
                method === 'qr' ? 'bg-white text-black font-medium' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Encrypted QR</span>
            </button>
          </div>

          <div className="inline-flex rounded-lg bg-black/40 p-0.5 border border-white/[0.06]">
            <button
              type="button"
              onClick={() => handleMethodOrRoleChange(method, 'send')}
              className={`px-3 py-1 rounded-md text-xs transition-colors ${
                role === 'send' ? 'bg-white/[0.14] text-white font-medium' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Send
            </button>
            <button
              type="button"
              onClick={() => handleMethodOrRoleChange(method, 'receive')}
              className={`px-3 py-1 rounded-md text-xs transition-colors ${
                role === 'receive' ? 'bg-white/[0.14] text-white font-medium' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Receive
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {decryptedPayload ? (
            /* Final Review + Apply Step (shared by QR & P2P Receive) */
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.1] space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>Vault Decrypted Successfully</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px] font-mono">
                  <div className="p-2 rounded-lg bg-black/30 border border-white/[0.05]">
                    <span className="text-zinc-500 block">Tools</span>
                    <span className="text-white text-sm tabular-nums">{decryptedPayload.tools.length}</span>
                  </div>
                  <div className="p-2 rounded-lg bg-black/30 border border-white/[0.05]">
                    <span className="text-zinc-500 block">Notes</span>
                    <span className="text-white text-sm tabular-nums">{decryptedPayload.notes.length}</span>
                  </div>
                  <div className="p-2 rounded-lg bg-black/30 border border-white/[0.05]">
                    <span className="text-zinc-500 block">Watchlist</span>
                    <span className="text-white text-sm tabular-nums">{decryptedPayload.media.length}</span>
                  </div>
                  <div className="p-2 rounded-lg bg-black/30 border border-white/[0.05]">
                    <span className="text-zinc-500 block">Passwords</span>
                    <span className="text-white text-sm tabular-nums">
                      {decryptedPayload.passwords?.length ??
                        (decryptedPayload.passwordVault?.cipherRaw ? 'Locked' : 0)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 p-3 rounded-lg bg-white/[0.02] border border-white/[0.06]">
                <span className="text-[11px] font-mono text-zinc-400">Import Mode:</span>
                <div className="flex items-center gap-4 text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer text-zinc-200">
                    <input
                      type="radio"
                      name="sync-import-mode"
                      checked={importMode === 'merge'}
                      onChange={() => setImportMode('merge')}
                      className="accent-white"
                    />
                    <span>Merge (keep existing)</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-zinc-200">
                    <input
                      type="radio"
                      name="sync-import-mode"
                      checked={importMode === 'replace'}
                      onChange={() => setImportMode('replace')}
                      className="accent-white"
                    />
                    <span>Replace All</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={resetAllTransientState}
                  className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white transition-colors"
                >
                  Discard
                </button>
                <button
                  type="button"
                  disabled={applyingImport}
                  onClick={handleApplySyncedPayload}
                  className="px-4 py-2 rounded-lg bg-white text-black hover:bg-zinc-200 disabled:opacity-50 text-xs font-medium transition-colors"
                >
                  {applyingImport ? 'Applying...' : 'Apply Synced Vault'}
                </button>
              </div>
            </div>
          ) : method === 'qr' && role === 'send' ? (
            /* QR SEND */
            <div className="space-y-4">
              {qrChunks.length === 0 ? (
                <div className="p-6 rounded-xl bg-white/[0.02] border border-white/[0.06] text-center space-y-3">
                  <QrCode className="w-7 h-7 text-zinc-500 mx-auto" />
                  <div>
                    <p className="text-xs font-medium text-white">Generate Encrypted Sync QR</p>
                    <p className="text-[11px] text-zinc-400 mt-1">
                      Encrypts your tools, notes, watchlist, and password vault with a one-time 6-digit PIN. Works completely offline.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={qrBusy}
                    onClick={handleGenerateQr}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white text-black hover:bg-zinc-200 disabled:opacity-50 text-xs font-medium transition-colors"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>{qrBusy ? 'Encrypting Vault...' : 'Generate Sync QR'}</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                    {qrDataUrl && (
                      <div className="p-2 bg-white rounded-xl shrink-0">
                        <img src={qrDataUrl} alt={`Sync QR ${qrIndex + 1}`} className="w-48 h-48 block" />
                      </div>
                    )}

                    <div className="flex-1 space-y-3 text-center sm:text-left">
                      <div>
                        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                          One-Time Sync PIN
                        </span>
                        <div className="text-2xl font-mono font-semibold tracking-[0.22em] text-white mt-0.5 tabular-nums">
                          {qrPin}
                        </div>
                      </div>

                      <p className="text-[11px] text-zinc-400 leading-relaxed">
                        Open 0arc Settings → Device Sync → Encrypted QR → Receive on your other device and scan {qrChunks.length === 1 ? 'this code' : `all ${qrChunks.length} frames`}.
                      </p>

                      <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                        {qrChunks.length > 1 && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setQrAutoPlay(false);
                                setQrIndex((prev) => (prev - 1 + qrChunks.length) % qrChunks.length);
                              }}
                              className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-300"
                              aria-label="Previous QR frame"
                            >
                              <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-[11px] font-mono text-zinc-300 tabular-nums px-1">
                              {qrIndex + 1} / {qrChunks.length}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setQrAutoPlay(false);
                                setQrIndex((prev) => (prev + 1) % qrChunks.length);
                              }}
                              className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-300"
                              aria-label="Next QR frame"
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setQrAutoPlay((p) => !p)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-[11px] text-zinc-300"
                            >
                              {qrAutoPlay ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                              <span>{qrAutoPlay ? 'Pause' : 'Play'}</span>
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          onClick={() => handleCopy(qrChunks[qrIndex], 'qr-chunk')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-[11px] font-mono text-zinc-300"
                        >
                          {copiedKey === 'qr-chunk' ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>Copy Frame</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : method === 'qr' && role === 'receive' ? (
            /* QR RECEIVE */
            <div className="space-y-4">
              <CodeScannerInput
                label="Or paste scanned 0ARCQ frame"
                placeholder="0ARCQ:..."
                onDetected={handleQrDetected}
              />

              {receivedSession && (
                <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.08] space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300 font-medium">
                      Session {receivedSession.sid}
                    </span>
                    <span className="font-mono text-[11px] text-zinc-400 tabular-nums">
                      {receivedCount} / {receivedSession.total} frames received
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-white transition-all"
                      style={{
                        width: `${Math.round((receivedCount / receivedSession.total) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {allQrChunksCollected && (
                <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-2.5">
                  <label className="block text-[11px] font-mono text-zinc-400">
                    Enter 6-digit Sync PIN from sender device
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={receivePin}
                      onChange={(e) => setReceivePin(e.target.value)}
                      placeholder="123456"
                      className="w-36 px-3 py-1.5 rounded-lg bg-black/40 border border-white/[0.1] text-sm font-mono tracking-widest text-white focus:outline-none focus:border-white/30"
                    />
                    <button
                      type="button"
                      onClick={handleDecryptQr}
                      className="px-3.5 py-1.5 rounded-lg bg-white text-black hover:bg-zinc-200 text-xs font-medium transition-colors"
                    >
                      Decrypt
                    </button>
                  </div>
                </div>
              )}

              {qrDecodeError && (
                <p className="text-[11px] font-mono text-red-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>{qrDecodeError}</span>
                </p>
              )}
            </div>
          ) : method === 'p2p' && role === 'send' ? (
            /* LOCAL WI-FI P2P SEND */
            <div className="space-y-4">
              {p2pStatus === 'idle' && (
                <div className="p-6 rounded-xl bg-white/[0.02] border border-white/[0.06] text-center space-y-3">
                  <Wifi className="w-7 h-7 text-zinc-500 mx-auto" />
                  <div>
                    <p className="text-xs font-medium text-white">Direct Local Wi-Fi P2P Transfer</p>
                    <p className="text-[11px] text-zinc-400 mt-1">
                      Connects directly between your PC and phone over local Wi-Fi using WebRTC DataChannel. Ideal for large vaults.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleStartP2pSend}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white text-black hover:bg-zinc-200 text-xs font-medium transition-colors"
                  >
                    <Wifi className="w-3.5 h-3.5" />
                    <span>Start Pairing Session</span>
                  </button>
                </div>
              )}

              {p2pStatus === 'creating' && (
                <div className="p-6 text-center text-xs font-mono text-zinc-400">
                  Preparing encrypted vault & local network offer...
                </div>
              )}

              {(p2pStatus === 'waiting_answer' || p2pStatus === 'connecting') && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                    {p2pSignalQr && (
                      <div className="p-2 bg-white rounded-xl shrink-0">
                        <img src={p2pSignalQr} alt="P2P Offer QR" className="w-40 h-40 block" />
                      </div>
                    )}
                    <div className="flex-1 space-y-2.5 text-center sm:text-left">
                      <div>
                        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                          Step 1 · Scan or Copy Offer + Sync PIN
                        </span>
                        <div className="text-xl font-mono font-semibold tracking-[0.22em] text-white mt-0.5 tabular-nums">
                          {p2pPin}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy(p2pSignalOut, 'p2p-offer')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] text-xs font-mono text-white"
                      >
                        {copiedKey === 'p2p-offer' ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 text-zinc-400" />
                        )}
                        <span>{copiedKey === 'p2p-offer' ? 'Offer Copied' : 'Copy Offer Code'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-2">
                    <p className="text-[11px] font-mono text-zinc-400">
                      Step 2 · Scan or paste the Receiver&apos;s Answer code
                    </p>
                    <CodeScannerInput
                      label="Paste receiver 0ARCS1 answer code"
                      placeholder="0ARCS1:..."
                      onDetected={handleApplyP2pAnswer}
                    />
                  </div>
                </div>
              )}

              {p2pStatus === 'transferring' && (
                <div className="p-5 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-2">
                  <div className="flex items-center justify-between text-xs text-white font-mono">
                    <span>Sending encrypted vault over Wi-Fi...</span>
                    <span className="tabular-nums">{p2pProgress}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                    <div className="h-full bg-white transition-all" style={{ width: `${p2pProgress}%` }} />
                  </div>
                </div>
              )}

              {p2pStatus === 'done' && (
                <div className="p-5 rounded-xl bg-white/[0.03] border border-white/[0.1] text-center space-y-2">
                  <Check className="w-6 h-6 text-emerald-400 mx-auto" />
                  <p className="text-xs font-semibold text-white">Vault Sent Over Local Wi-Fi</p>
                  <p className="text-[11px] text-zinc-400">
                    Enter PIN <span className="font-mono text-white">{p2pPin}</span> on the receiving device to apply.
                  </p>
                </div>
              )}

              {p2pError && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center justify-between gap-2 font-mono">
                  <span>{p2pError}</span>
                  <button
                    type="button"
                    onClick={handleStartP2pSend}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/[0.08] text-white shrink-0"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Retry</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* LOCAL WI-FI P2P RECEIVE */
            <div className="space-y-4">
              {p2pStatus === 'idle' && (
                <CodeScannerInput
                  label="Step 1 · Scan or paste Sender's 0ARCS1 Offer code"
                  placeholder="0ARCS1:..."
                  onDetected={handleAcceptP2pOffer}
                />
              )}

              {p2pStatus === 'waiting_offer' && (
                <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                  {p2pSignalQr && (
                    <div className="p-2 bg-white rounded-xl shrink-0">
                      <img src={p2pSignalQr} alt="P2P Answer QR" className="w-40 h-40 block" />
                    </div>
                  )}
                  <div className="flex-1 space-y-2.5 text-center sm:text-left">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                      Step 2 · Scan or Copy Answer on Sender Device
                    </span>
                    <p className="text-xs text-zinc-300 leading-relaxed">
                      Show this QR code to the sender device or copy the Answer code below. Transfer starts automatically once accepted.
                    </p>
                    <button
                      type="button"
                      onClick={() => handleCopy(p2pSignalOut, 'p2p-answer')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] text-xs font-mono text-white"
                    >
                      {copiedKey === 'p2p-answer' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-zinc-400" />
                      )}
                      <span>{copiedKey === 'p2p-answer' ? 'Answer Copied' : 'Copy Answer Code'}</span>
                    </button>
                  </div>
                </div>
              )}

              {p2pStatus === 'transferring' && (
                <div className="p-5 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-2">
                  <div className="flex items-center justify-between text-xs text-white font-mono">
                    <span>Receiving vault over Wi-Fi...</span>
                    <span className="tabular-nums">{p2pProgress}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                    <div className="h-full bg-white transition-all" style={{ width: `${p2pProgress}%` }} />
                  </div>
                </div>
              )}

              {p2pStatus === 'awaiting_pin' && (
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-white">
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>Encrypted vault received. Enter 6-digit Sync PIN to decrypt:</span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={p2pReceivePin}
                      onChange={(e) => setP2pReceivePin(e.target.value)}
                      placeholder="123456"
                      className="w-36 px-3 py-1.5 rounded-lg bg-black/40 border border-white/[0.1] text-sm font-mono tracking-widest text-white focus:outline-none focus:border-white/30"
                    />
                    <button
                      type="button"
                      onClick={handleDecryptP2pPacket}
                      className="px-3.5 py-1.5 rounded-lg bg-white text-black hover:bg-zinc-200 text-xs font-medium transition-colors"
                    >
                      Decrypt
                    </button>
                  </div>
                </div>
              )}

              {p2pError && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center justify-between gap-2 font-mono">
                  <span>{p2pError}</span>
                  <button
                    type="button"
                    onClick={() => handleMethodOrRoleChange('p2p', 'receive')}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/[0.08] text-white shrink-0"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Reset</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
