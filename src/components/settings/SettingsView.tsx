import React, { useState, useRef, Suspense } from 'react';
import { useArchive } from '../../context/ArchiveContext';
import {
  Shield,
  Download,
  Upload,
  RotateCcw,
  Trash2,
  FileJson,
  AlertTriangle,
  Check,
  Wrench,
  FileText,
  Film,
  KeyRound,
  Lock,
  Laptop,
  X,
  Database,
  RefreshCw,
} from 'lucide-react';
import { NavigationTab } from '../../types';
import {
  decryptEncryptedBackupFile,
  isEncryptedBackupContent,
} from '../../utils/encryptedBackup';
import {
  loadMongoSyncConfig,
  MongoSyncConfig,
  pushVaultToMongo,
  saveMongoSyncConfig,
} from '../../utils/mongoSync';

const DeviceSyncModal = React.lazy(() =>
  import('./DeviceSyncModal').then((m) => ({ default: m.DeviceSyncModal }))
);
const SyncServerModal = React.lazy(() =>
  import('./SyncServerModal').then((m) => ({ default: m.SyncServerModal }))
);

export const SettingsView: React.FC = () => {
  const {
    settings,
    updateSettings,
    tools,
    notes,
    media,
    passwordCount,
    hasPasswordLock,
    isPasswordVaultUnlocked,
    exportAllJSON,
    exportCollectionJSON,
    exportEncryptedBackup,
    buildFullVaultPayload,
    importJSON,
    importVaultPayload,
    clearAllData,
    resetToSampleData,
    addToast,
  } = useArchive();

  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showClearModal, setShowClearModal] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');

  // Encrypted .0arc export modal
  const [showExport0arcModal, setShowExport0arcModal] = useState(false);
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [backupConfirm, setBackupConfirm] = useState('');
  const [export0arcBusy, setExport0arcBusy] = useState(false);
  const [export0arcError, setExport0arcError] = useState<string | null>(null);

  // Encrypted .0arc import passphrase prompt
  const [pending0arcContent, setPending0arcContent] = useState<string | null>(null);
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [restore0arcBusy, setRestore0arcBusy] = useState(false);
  const [restore0arcError, setRestore0arcError] = useState<string | null>(null);

  // Zero-server Device Sync modal
  const [syncModalOpen, setSyncModalOpen] = useState(false);

  // Sync Server (MongoDB) modal & status
  const [syncServerModalOpen, setSyncServerModalOpen] = useState(false);
  const [mongoConfig, setMongoConfig] = useState<MongoSyncConfig | null>(null);
  const [quickSyncing, setQuickSyncing] = useState(false);

  React.useEffect(() => {
    let active = true;
    void loadMongoSyncConfig().then((loaded) => {
      if (active) setMongoConfig(loaded);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleQuickMongoPush = async () => {
    if (!mongoConfig || !mongoConfig.mongoUri.trim()) {
      setSyncServerModalOpen(true);
      return;
    }
    setQuickSyncing(true);
    try {
      const payload = await buildFullVaultPayload();
      const { updatedAt } = await pushVaultToMongo(mongoConfig, payload);
      const next: MongoSyncConfig = {
        ...mongoConfig,
        connected: true,
        lastSyncedAt: updatedAt,
      };
      await saveMongoSyncConfig(next);
      setMongoConfig(next);
      addToast('Synced to MongoDB', 'success', 'Archive backed up to your sync server.');
    } catch (err: unknown) {
      addToast(
        'Sync Failed',
        'error',
        err instanceof Error ? err.message : 'Could not push archive to MongoDB.'
      );
    } finally {
      setQuickSyncing(false);
    }
  };

  const totalItems = tools.length + notes.length + media.length + passwordCount;

  const handleConfirmToggle = (checked: boolean) => {
    updateSettings({ confirmBeforeDelete: checked });
  };

  const handleDefaultViewChange = (tab: NavigationTab) => {
    updateSettings({ defaultArchiveView: tab });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportError(null);
    setImportSuccess(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) {
        setImportError('File is empty.');
        return;
      }

      if (isEncryptedBackupContent(content)) {
        setPending0arcContent(content);
        setRestorePassphrase('');
        setRestore0arcError(null);
      } else {
        const result = importJSON(content, importMode);
        if (result.success) {
          setImportSuccess(result.message);
        } else {
          setImportError(result.message);
        }
      }

      if (fileInputRef.current) fileInputRef.current.value = '';
    };

    reader.onerror = () => {
      setImportError('Failed to read selected file.');
    };

    reader.readAsText(file);
  };

  const handleCreate0arcBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    setExport0arcError(null);
    if (backupPassphrase.length < 4) {
      setExport0arcError('Passphrase must be at least 4 characters.');
      return;
    }
    if (backupPassphrase !== backupConfirm) {
      setExport0arcError('Passphrases do not match.');
      return;
    }
    setExport0arcBusy(true);
    try {
      await exportEncryptedBackup(backupPassphrase);
      setShowExport0arcModal(false);
      setBackupPassphrase('');
      setBackupConfirm('');
    } catch (err: unknown) {
      setExport0arcError(
        err instanceof Error ? err.message : 'Failed to encrypt backup.'
      );
    } finally {
      setExport0arcBusy(false);
    }
  };

  const handleRestore0arcBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pending0arcContent) return;
    setRestore0arcError(null);
    setRestore0arcBusy(true);

    try {
      const payload = await decryptEncryptedBackupFile(
        pending0arcContent,
        restorePassphrase
      );
      const result = await importVaultPayload(payload, importMode);
      setPending0arcContent(null);
      setRestorePassphrase('');
      if (result.success) {
        setImportSuccess(result.message);
      } else {
        setImportError(result.message);
      }
    } catch (err: unknown) {
      setRestore0arcError(
        err instanceof Error ? err.message : 'Incorrect passphrase or invalid file.'
      );
    } finally {
      setRestore0arcBusy(false);
    }
  };

  const handleExecuteClear = () => {
    if (confirmInput.trim().toUpperCase() === 'CLEAR') {
      clearAllData();
      setShowClearModal(false);
      setConfirmInput('');
    } else {
      addToast('Confirmation Failed', 'error', 'Type CLEAR to confirm deletion.');
    }
  };

  return (
    <div className="space-y-6 max-w-2xl animate-in fade-in duration-150 pb-8">
      {/* Header */}
      <div className="pb-4 border-b border-white/[0.06]">
        <h1 className="text-xl font-semibold text-white tracking-tight">
          Settings
        </h1>
        <p className="text-xs text-zinc-400 mt-0.5">
          Vault preferences, encrypted backups, and device sync.
        </p>
      </div>

      {/* Zero-Server Device Sync */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-white">
          <Laptop className="w-3.5 h-3.5 text-zinc-400" />
          <span>Device Sync</span>
        </div>

        <div className="surface-card rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold text-white">Direct Device-to-Device Transfer</h3>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Sync your archive between Windows, Linux, Android, and iOS over local Wi-Fi P2P or encrypted QR codes—no cloud account or server required.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setSyncModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-black hover:bg-zinc-200 text-xs font-medium transition-colors shrink-0 whitespace-nowrap"
          >
            <Laptop className="w-3.5 h-3.5" />
            <span>Sync Device</span>
          </button>
        </div>

        <div className="surface-card rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xs font-semibold text-white">Sync Server (MongoDB)</h3>
              {mongoConfig?.connected ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-mono text-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>Connected</span>
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-[10px] font-mono text-zinc-400">
                  Not Configured
                </span>
              )}
              {mongoConfig?.autoSync && mongoConfig?.connected && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.1] text-[10px] font-mono text-zinc-300">
                  Auto-Sync On
                </span>
              )}
            </div>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Connect your own or another person&apos;s MongoDB server so your archive stays backed up across devices and never gets lost.
            </p>
            {mongoConfig?.connected && (
              <p className="text-[10px] font-mono text-zinc-500 mt-1 truncate">
                Vault: <span className="text-zinc-300">{mongoConfig.vaultId}</span>
                {mongoConfig.lastSyncedAt
                  ? ` · Last synced ${new Date(mongoConfig.lastSyncedAt).toLocaleString()}`
                  : ''}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {mongoConfig?.connected && mongoConfig.mongoUri.trim() && (
              <button
                type="button"
                disabled={quickSyncing}
                onClick={handleQuickMongoPush}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.1] text-xs font-medium text-white disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${quickSyncing ? 'animate-spin' : ''}`} />
                <span>{quickSyncing ? 'Syncing...' : 'Sync Now'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setSyncServerModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-black hover:bg-zinc-200 text-xs font-medium transition-colors whitespace-nowrap"
            >
              <Database className="w-3.5 h-3.5" />
              <span>Sync Server</span>
            </button>
          </div>
        </div>
      </div>

      {/* Vault Preferences */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-white">
          <Shield className="w-3.5 h-3.5 text-zinc-400" />
          <span>Vault Preferences</span>
        </div>

        <div className="surface-card rounded-xl p-4 space-y-4">
          <div>
            <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">
              Default View on Launch
            </label>
            <select
              value={settings.defaultArchiveView}
              onChange={(e) => handleDefaultViewChange(e.target.value as NavigationTab)}
              className="w-full sm:w-64 px-3 py-1.5 rounded-lg bg-black/40 border border-white/[0.08] text-xs font-mono text-white focus:outline-none focus:border-white/30"
            >
              <option value="overview">Overview</option>
              <option value="tools">Tools & Resources</option>
              <option value="notes">Personal Notes</option>
              <option value="watchlist">Watchlist</option>
              <option value="passwords">Passwords</option>
              <option value="favorites">Favorites</option>
            </select>
          </div>

          <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-white">Confirm Deletions</p>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Display safety confirmation dialog before deleting an archive item.
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={settings.confirmBeforeDelete}
              aria-label="Confirm deletions"
              onClick={() => handleConfirmToggle(!settings.confirmBeforeDelete)}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors shrink-0 ${
                settings.confirmBeforeDelete ? 'bg-white' : 'bg-white/[0.1]'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full shadow-sm transform transition-transform ${
                  settings.confirmBeforeDelete ? 'bg-black translate-x-5' : 'bg-zinc-400 translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Export Data */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-white">
          <Download className="w-3.5 h-3.5 text-zinc-400" />
          <span>Export Data</span>
        </div>

        <div className="surface-card rounded-xl p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-semibold text-white">Complete Archive Snapshot</h3>
              <p className="text-[11px] text-zinc-400 mt-0.5 tabular-nums">
                Download an encrypted <span className="font-mono text-zinc-300">.0arc</span> backup (includes Passwords + Main Lock) or plaintext JSON of your {totalItems} items.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setBackupPassphrase('');
                  setBackupConfirm('');
                  setExport0arcError(null);
                  setShowExport0arcModal(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-black hover:bg-zinc-200 text-xs font-medium transition-colors whitespace-nowrap"
              >
                <Lock className="w-3 h-3" />
                <span>Export .0arc Backup</span>
              </button>

              <button
                type="button"
                onClick={exportAllJSON}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-200 hover:text-white text-xs font-medium transition-colors whitespace-nowrap"
              >
                <Download className="w-3 h-3" />
                <span>JSON</span>
              </button>
            </div>
          </div>

          <div className="pt-3 border-t border-white/[0.06]">
            <p className="text-[11px] font-mono text-zinc-500 mb-2">
              Export by Section{hasPasswordLock && !isPasswordVaultUnlocked ? ' (unlock Passwords for plain JSON)' : ''}:
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                onClick={() => exportCollectionJSON('tools')}
                className="flex items-center justify-center gap-1.5 p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.06] text-zinc-300 hover:text-white border border-white/[0.06] transition-colors font-mono text-[11px]"
              >
                <Wrench className="w-3 h-3 text-zinc-400" />
                <span>Tools JSON</span>
              </button>
              <button
                onClick={() => exportCollectionJSON('notes')}
                className="flex items-center justify-center gap-1.5 p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.06] text-zinc-300 hover:text-white border border-white/[0.06] transition-colors font-mono text-[11px]"
              >
                <FileText className="w-3 h-3 text-zinc-400" />
                <span>Notes JSON</span>
              </button>
              <button
                onClick={() => exportCollectionJSON('watchlist')}
                className="flex items-center justify-center gap-1.5 p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.06] text-zinc-300 hover:text-white border border-white/[0.06] transition-colors font-mono text-[11px]"
              >
                <Film className="w-3 h-3 text-zinc-400" />
                <span>Watchlist JSON</span>
              </button>
              <button
                onClick={() => exportCollectionJSON('passwords')}
                className="flex items-center justify-center gap-1.5 p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.06] text-zinc-300 hover:text-white border border-white/[0.06] transition-colors font-mono text-[11px]"
              >
                <KeyRound className="w-3 h-3 text-zinc-400" />
                <span>Passwords JSON</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Import Data */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-white">
          <Upload className="w-3.5 h-3.5 text-zinc-400" />
          <span>Import Data</span>
        </div>

        <div className="surface-card rounded-xl p-4 space-y-4">
          <div>
            <h3 className="text-xs font-semibold text-white">Restore from Backup</h3>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Load an encrypted <span className="font-mono text-zinc-300">.0arc</span> vault backup or a <span className="font-mono text-zinc-300">.json</span> snapshot.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 p-3 rounded-lg bg-white/[0.02] border border-white/[0.06]">
            <span className="text-[11px] font-mono text-zinc-400">Mode:</span>
            <div className="flex items-center gap-4 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer text-zinc-200">
                <input
                  type="radio"
                  name="import-mode"
                  checked={importMode === 'merge'}
                  onChange={() => setImportMode('merge')}
                  className="accent-white"
                />
                <span className="text-xs">Merge (keep existing)</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer text-zinc-200">
                <input
                  type="radio"
                  name="import-mode"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                  className="accent-white"
                />
                <span className="text-xs text-zinc-300">Replace All</span>
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".0arc,.json,application/json,application/octet-stream"
              onChange={handleFileUpload}
              className="hidden"
              id="json-file-picker"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white border border-white/[0.1] text-xs font-mono transition-colors"
            >
              <FileJson className="w-3.5 h-3.5 text-zinc-400" />
              <span>Select .0arc / .json File</span>
            </button>
            <span className="text-[11px] font-mono text-zinc-500">.0arc encrypted or .json</span>
          </div>

          {importSuccess && (
            <div className="p-3 rounded-lg bg-white/[0.05] border border-white/[0.12] text-xs text-zinc-100 flex items-center gap-2 font-mono">
              <Check className="w-4 h-4 shrink-0" />
              <span>{importSuccess}</span>
            </div>
          )}

          {importError && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center gap-2 font-mono">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{importError}</span>
            </div>
          )}
        </div>
      </div>

      {/* Danger Zone */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-red-400">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
          <span>Danger Zone</span>
        </div>

        <div className="surface-card rounded-xl p-4 space-y-4 border-red-500/20">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-semibold text-white">Reset Vault Preferences</h3>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Restores default launch view and deletion confirmation settings.
              </p>
            </div>

            <button
              onClick={resetToSampleData}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.08] text-xs font-mono text-zinc-200 transition-colors shrink-0"
            >
              <RotateCcw className="w-3 h-3 text-zinc-400" />
              <span>Reset Preferences</span>
            </button>
          </div>

          <div className="pt-3 border-t border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-semibold text-red-400">Clear All Vault Data</h3>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Permanently wipes all saved tools, notes, watchlist items, and passwords from local storage.
              </p>
            </div>

            <button
              onClick={() => {
                setConfirmInput('');
                setShowClearModal(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-xs font-mono text-red-400 transition-colors shrink-0"
            >
              <Trash2 className="w-3 h-3" />
              <span>Erase All</span>
            </button>
          </div>
        </div>
      </div>

      {/* Export Encrypted .0arc Modal */}
      {showExport0arcModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm sm:p-4 animate-in fade-in duration-150"
          onClick={() => setShowExport0arcModal(false)}
        >
          <form
            onSubmit={handleCreate0arcBackup}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md surface-elevated border border-white/[0.1] rounded-t-2xl sm:rounded-xl p-5 sm:p-6 shadow-2xl space-y-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-6"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <div className="p-2 rounded-lg bg-white/[0.06] text-white shrink-0">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Export Encrypted .0arc Backup</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Protected with PBKDF2-SHA-512 + AES-256-GCM. Includes Passwords and your Main Lock.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowExport0arcModal(false)}
                className="p-1 text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                  Backup Passphrase
                </label>
                <input
                  type="password"
                  autoFocus
                  required
                  value={backupPassphrase}
                  onChange={(e) => setBackupPassphrase(e.target.value)}
                  placeholder="At least 4 characters"
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/[0.1] text-xs text-white focus:outline-none focus:border-white/30"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                  Confirm Passphrase
                </label>
                <input
                  type="password"
                  required
                  value={backupConfirm}
                  onChange={(e) => setBackupConfirm(e.target.value)}
                  placeholder="Re-enter passphrase"
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/[0.1] text-xs text-white focus:outline-none focus:border-white/30"
                />
              </div>
            </div>

            {export0arcError && (
              <p className="text-[11px] font-mono text-red-400">{export0arcError}</p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowExport0arcModal(false)}
                className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={export0arcBusy}
                className="px-4 py-1.5 text-xs font-medium bg-white text-black hover:bg-zinc-200 disabled:opacity-50 rounded-lg transition-colors"
              >
                {export0arcBusy ? 'Encrypting...' : 'Download .0arc'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Restore Encrypted .0arc Modal */}
      {pending0arcContent && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm sm:p-4 animate-in fade-in duration-150"
          onClick={() => setPending0arcContent(null)}
        >
          <form
            onSubmit={handleRestore0arcBackup}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md surface-elevated border border-white/[0.1] rounded-t-2xl sm:rounded-xl p-5 sm:p-6 shadow-2xl space-y-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-6"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <div className="p-2 rounded-lg bg-white/[0.06] text-white shrink-0">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Decrypt .0arc Vault</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Enter the passphrase used when this encrypted backup was created ({importMode === 'replace' ? 'Replace All' : 'Merge'} mode).
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPending0arcContent(null)}
                className="p-1 text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                Backup Passphrase
              </label>
              <input
                type="password"
                autoFocus
                required
                value={restorePassphrase}
                onChange={(e) => setRestorePassphrase(e.target.value)}
                placeholder="Enter backup passphrase"
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/[0.1] text-xs text-white focus:outline-none focus:border-white/30"
              />
            </div>

            {restore0arcError && (
              <p className="text-[11px] font-mono text-red-400">{restore0arcError}</p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPending0arcContent(null)}
                className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={restore0arcBusy}
                className="px-4 py-1.5 text-xs font-medium bg-white text-black hover:bg-zinc-200 disabled:opacity-50 rounded-lg transition-colors"
              >
                {restore0arcBusy ? 'Decrypting...' : 'Restore Vault'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Zero-Server Device Sync Modal */}
      {syncModalOpen && (
        <Suspense fallback={null}>
          <DeviceSyncModal
            isOpen={syncModalOpen}
            onClose={() => setSyncModalOpen(false)}
          />
        </Suspense>
      )}

      {/* Sync Server (MongoDB) Modal */}
      {syncServerModalOpen && (
        <Suspense fallback={null}>
          <SyncServerModal
            isOpen={syncServerModalOpen}
            onClose={() => setSyncServerModalOpen(false)}
            onConfigUpdated={(updated) => setMongoConfig(updated)}
          />
        </Suspense>
      )}

      {/* Clear All Confirmation Modal */}
      {showClearModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm sm:p-4 animate-in fade-in duration-150">
          <div className="w-full sm:max-w-md surface-elevated border border-red-500/30 rounded-t-2xl sm:rounded-xl p-5 sm:p-6 shadow-2xl space-y-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-6">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-red-500/10 text-red-400 shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Erase Local Vault Data?</h3>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                  This action cannot be undone. All entries in browser local storage will be permanently deleted.
                </p>
              </div>
            </div>

            <div className="p-3 bg-white/[0.02] rounded-lg border border-white/[0.06]">
              <label className="block text-[11px] font-mono text-zinc-400 mb-1.5">
                Type <span className="text-red-400 font-bold">CLEAR</span> to confirm:
              </label>
              <input
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder="CLEAR"
                className="w-full px-3 py-1.5 rounded-lg bg-black/40 border border-white/[0.1] text-xs font-mono text-white uppercase tracking-wider focus:outline-none focus:border-red-400"
              />
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowClearModal(false)}
                className="flex-1 sm:flex-none px-3 py-2.5 sm:py-1.5 text-xs text-zinc-400 hover:text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteClear}
                disabled={confirmInput.trim().toUpperCase() !== 'CLEAR'}
                className="flex-1 sm:flex-none px-3.5 py-2.5 sm:py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 disabled:opacity-40 rounded-lg transition-colors"
              >
                Permanently Erase
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
