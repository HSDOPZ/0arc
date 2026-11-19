import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Cloud,
  CloudOff,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  Lock,
  RefreshCw,
  Server,
  Upload,
  X,
} from 'lucide-react';
import { useArchive } from '../../context/ArchiveContext';
import {
  clearMongoSyncConfig,
  createInitialMongoSyncConfig,
  isTauriEnvironment,
  loadMongoSyncConfig,
  MongoSyncConfig,
  MongoTestResult,
  pullVaultFromMongo,
  pushVaultToMongo,
  saveMongoSyncConfig,
  testMongoSyncConnection,
} from '../../utils/mongoSync';

interface SyncServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigUpdated?: (config: MongoSyncConfig) => void;
}

export const SyncServerModal: React.FC<SyncServerModalProps> = ({
  isOpen,
  onClose,
  onConfigUpdated,
}) => {
  const { buildFullVaultPayload, importVaultPayload, addToast } = useArchive();

  const [config, setConfig] = useState<MongoSyncConfig>(createInitialMongoSyncConfig);
  const [showUri, setShowUri] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [pullMode, setPullMode] = useState<'merge' | 'replace'>('merge');
  const [busyAction, setBusyAction] = useState<'test' | 'push' | 'pull' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<MongoTestResult | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  const inTauri = isTauriEnvironment();

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setErrorMessage(null);
    setTestResult(null);
    void loadMongoSyncConfig().then((loaded) => {
      if (active) setConfig(loaded);
    });
    return () => {
      active = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const updateField = <K extends keyof MongoSyncConfig>(key: K, value: MongoSyncConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const persistConfig = async (nextConfig: MongoSyncConfig) => {
    await saveMongoSyncConfig(nextConfig);
    setConfig(nextConfig);
    onConfigUpdated?.(nextConfig);
  };

  const handleCopyVaultId = async () => {
    try {
      await navigator.clipboard.writeText(config.vaultId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleRegenerateVaultId = () => {
    const fresh = createInitialMongoSyncConfig().vaultId;
    updateField('vaultId', fresh);
  };

  const handleTest = async () => {
    setErrorMessage(null);
    setTestResult(null);
    setBusyAction('test');
    try {
      const result = await testMongoSyncConnection(config);
      setTestResult(result);
      const nextConfig: MongoSyncConfig = { ...config, connected: true };
      await persistConfig(nextConfig);
      addToast(
        'MongoDB Connected',
        'success',
        result.exists
          ? 'Connected and found an existing vault snapshot.'
          : 'Connected! Ready to push your vault.'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to connect to MongoDB.';
      setErrorMessage(msg);
      const nextConfig: MongoSyncConfig = { ...config, connected: false };
      await persistConfig(nextConfig);
    } finally {
      setBusyAction(null);
    }
  };

  const handlePush = async () => {
    setErrorMessage(null);
    setBusyAction('push');
    try {
      const payload = await buildFullVaultPayload();
      const { updatedAt } = await pushVaultToMongo(config, payload);
      const nextConfig: MongoSyncConfig = {
        ...config,
        connected: true,
        lastSyncedAt: updatedAt,
      };
      await persistConfig(nextConfig);
      addToast('Synced to MongoDB', 'success', 'Archive pushed to your MongoDB sync server.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to push vault to MongoDB.';
      setErrorMessage(msg);
    } finally {
      setBusyAction(null);
    }
  };

  const handlePull = async () => {
    setErrorMessage(null);
    setBusyAction('pull');
    try {
      const result = await pullVaultFromMongo(config);
      if (!result.found || !result.payload) {
        setErrorMessage('No saved vault was found for this Vault ID in MongoDB.');
        const nextConfig: MongoSyncConfig = { ...config, connected: true };
        await persistConfig(nextConfig);
        return;
      }

      const imported = await importVaultPayload(result.payload, pullMode);
      if (!imported.success) {
        setErrorMessage(imported.message);
        return;
      }

      const nextConfig: MongoSyncConfig = {
        ...config,
        connected: true,
        lastSyncedAt: result.updatedAt || new Date().toISOString(),
      };
      await persistConfig(nextConfig);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to pull vault from MongoDB.';
      setErrorMessage(msg);
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveOnly = async () => {
    setErrorMessage(null);
    await persistConfig(config);
    addToast('Sync Server Saved', 'info', 'MongoDB sync settings updated.');
    onClose();
  };

  const handleDisconnect = async () => {
    await clearMongoSyncConfig();
    const reset = createInitialMongoSyncConfig();
    setConfig(reset);
    setTestResult(null);
    setErrorMessage(null);
    onConfigUpdated?.(reset);
    addToast('Disconnected', 'info', 'Sync Server settings cleared from this device.');
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
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-lg bg-white/[0.06] text-white shrink-0">
              <Database className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-white truncate">Sync Server (MongoDB)</h2>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono ${
                    config.connected
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : 'bg-white/[0.05] text-zinc-400 border border-white/[0.08]'
                  }`}
                >
                  {config.connected ? <Cloud className="w-2.5 h-2.5" /> : <CloudOff className="w-2.5 h-2.5" />}
                  <span>{config.connected ? 'Connected' : 'Not Connected'}</span>
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 truncate">
                Connect your own or another person&apos;s MongoDB server so your data is never lost.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 -mr-1.5 text-zinc-400 hover:text-white rounded-lg transition-colors"
            aria-label="Close sync server modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {inTauri && !config.syncServerUrl.trim() && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-200 leading-relaxed">
              Native desktop & mobile apps need a reachable <strong>0arc Sync Server URL</strong> (for example, your hosted 0arc web URL or LAN server like <span className="font-mono">http://192.168.1.10:3000</span>) to bridge MongoDB connections.
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-400 mb-1">
                <Server className="w-3 h-3" />
                <span>Sync Server URL</span>
              </label>
              <input
                type="url"
                value={config.syncServerUrl}
                onChange={(e) => updateField('syncServerUrl', e.target.value)}
                placeholder="https://your-0arc-server.com (or http://192.168.x.x:3000)"
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/[0.08] text-xs font-mono text-white placeholder-zinc-600 focus:outline-none focus:border-white/30"
              />
              <p className="text-[10px] text-zinc-500 mt-1">
                Web mode uses this server automatically. Point mobile/desktop apps to any 0arc server URL.
              </p>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-400 mb-1">
                <Database className="w-3 h-3" />
                <span>MongoDB Connection URI</span>
              </label>
              <div className="relative">
                <input
                  type={showUri ? 'text' : 'password'}
                  value={config.mongoUri}
                  onChange={(e) => updateField('mongoUri', e.target.value)}
                  placeholder="mongodb+srv://user:password@cluster.mongodb.net/?retryWrites=true&w=majority"
                  className="w-full pl-3 pr-9 py-2 rounded-lg bg-black/40 border border-white/[0.08] text-xs font-mono text-white placeholder-zinc-600 focus:outline-none focus:border-white/30"
                />
                <button
                  type="button"
                  onClick={() => setShowUri((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
                  aria-label={showUri ? 'Hide MongoDB URI' : 'Show MongoDB URI'}
                >
                  {showUri ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-[10px] text-zinc-500 mt-1">
                Enter your own or a shared MongoDB URI. Stored locally on this device only.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                  Database Name
                </label>
                <input
                  type="text"
                  value={config.dbName}
                  onChange={(e) => updateField('dbName', e.target.value)}
                  placeholder="zeroarc"
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/[0.08] text-xs font-mono text-white placeholder-zinc-600 focus:outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                  Collection Name
                </label>
                <input
                  type="text"
                  value={config.collectionName}
                  onChange={(e) => updateField('collectionName', e.target.value)}
                  placeholder="vaults"
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/[0.08] text-xs font-mono text-white placeholder-zinc-600 focus:outline-none focus:border-white/30"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                Vault ID (use the same ID across your devices)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={config.vaultId}
                  onChange={(e) => updateField('vaultId', e.target.value)}
                  placeholder="my-personal-vault"
                  className="flex-1 px-3 py-2 rounded-lg bg-black/40 border border-white/[0.08] text-xs font-mono text-white placeholder-zinc-600 focus:outline-none focus:border-white/30"
                />
                <button
                  type="button"
                  onClick={handleCopyVaultId}
                  className="px-2.5 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-300 text-xs"
                  title="Copy Vault ID"
                >
                  {copiedId ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={handleRegenerateVaultId}
                  className="px-2.5 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-300 text-xs"
                  title="Generate New Vault ID"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-400 mb-1">
                <Lock className="w-3 h-3" />
                <span>End-to-End Sync Passphrase (Optional)</span>
              </label>
              <div className="relative">
                <input
                  type={showPassphrase ? 'text' : 'password'}
                  value={config.passphrase}
                  onChange={(e) => updateField('passphrase', e.target.value)}
                  placeholder="Encrypt vault before sending to MongoDB (recommended for shared DBs)"
                  className="w-full pl-3 pr-9 py-2 rounded-lg bg-black/40 border border-white/[0.08] text-xs font-mono text-white placeholder-zinc-600 focus:outline-none focus:border-white/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassphrase((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
                  aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                >
                  {showPassphrase ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Auto-Sync Toggle */}
            <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.06] flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-white">Auto-Sync Changes</p>
                <p className="text-[11px] text-zinc-400">
                  Automatically push updates to MongoDB after edits so your archive never gets lost.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={config.autoSync}
                onClick={() => updateField('autoSync', !config.autoSync)}
                className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors shrink-0 ${
                  config.autoSync ? 'bg-white' : 'bg-white/[0.1]'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full shadow-sm transform transition-transform ${
                    config.autoSync ? 'bg-black translate-x-5' : 'bg-zinc-400 translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Pull Mode */}
            <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-[11px] font-mono text-zinc-400">When Pulling from MongoDB:</span>
              <div className="flex items-center gap-4 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer text-zinc-200">
                  <input
                    type="radio"
                    name="mongo-pull-mode"
                    checked={pullMode === 'merge'}
                    onChange={() => setPullMode('merge')}
                    className="accent-white"
                  />
                  <span>Merge</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-zinc-200">
                  <input
                    type="radio"
                    name="mongo-pull-mode"
                    checked={pullMode === 'replace'}
                    onChange={() => setPullMode('replace')}
                    className="accent-white"
                  />
                  <span>Replace Local</span>
                </label>
              </div>
            </div>
          </div>

          {testResult && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-200 space-y-1 font-mono">
              <div className="flex items-center gap-2 font-semibold">
                <Check className="w-3.5 h-3.5 shrink-0" />
                <span>MongoDB Ping Successful</span>
              </div>
              <p className="text-[11px] text-emerald-300/90">
                {testResult.exists
                  ? `Remote vault found (${testResult.encrypted ? 'Encrypted' : 'Standard JSON'}) · Last updated: ${
                      testResult.updatedAt ? new Date(testResult.updatedAt).toLocaleString() : 'Unknown'
                    }`
                  : 'No snapshot stored for this Vault ID yet. Click "Push to MongoDB" to save your data.'}
              </p>
            </div>
          )}

          {errorMessage && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-start gap-2 font-mono">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={handleTest}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] text-xs font-medium text-white disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'test' ? 'animate-spin' : ''}`} />
              <span>{busyAction === 'test' ? 'Connecting...' : 'Test Connection'}</span>
            </button>

            <button
              type="button"
              disabled={busyAction !== null}
              onClick={handlePush}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white text-black hover:bg-zinc-200 text-xs font-medium disabled:opacity-50 transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{busyAction === 'push' ? 'Pushing...' : 'Push to MongoDB'}</span>
            </button>

            <button
              type="button"
              disabled={busyAction !== null}
              onClick={handlePull}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.12] text-xs font-medium text-white disabled:opacity-50 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{busyAction === 'pull' ? 'Pulling...' : 'Pull from MongoDB'}</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-between gap-2 shrink-0 bg-white/[0.01]">
          <button
            type="button"
            onClick={handleDisconnect}
            className="px-3 py-1.5 rounded-lg text-xs text-red-400 hover:bg-red-500/10 transition-colors"
          >
            Disconnect
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white transition-colors"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSaveOnly}
              className="px-3.5 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-xs font-medium text-white transition-colors"
            >
              Save Config
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
