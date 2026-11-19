import React, { useState, useMemo } from 'react';
import { useArchive } from '../../context/ArchiveContext';
import { PasswordItem } from '../../types';
import { PasswordModal } from './PasswordModal';
import { MainLockModal } from './MainLockModal';
import { ConfirmModal } from '../common/ConfirmModal';
import {
  Plus,
  Search,
  Lock,
  Unlock,
  KeyRound,
  Eye,
  EyeOff,
  Copy,
  Check,
  ExternalLink,
  Edit2,
  Trash2,
  ShieldCheck,
  LayoutGrid,
  List,
  Loader2,
  AlertTriangle,
  ArrowLeft,
} from 'lucide-react';

const normalizeHref = (rawUrl: string): string => {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '#';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

const getHostLabel = (rawUrl: string): string => {
  try {
    return new URL(normalizeHref(rawUrl)).hostname.replace(/^www\./, '');
  } catch {
    return rawUrl;
  }
};

export const PasswordsView: React.FC = () => {
  const {
    passwords,
    passwordCount,
    hasPasswordLock,
    isPasswordVaultUnlocked,
    passwordRecoveryQuestion,
    addPassword,
    updatePassword,
    deletePassword,
    unlockPasswordVault,
    lockPasswordVault,
    enablePasswordMainLock,
    resetPasswordMainLock,
    disablePasswordMainLock,
    settings,
    addToast,
  } = useArchive();

  // Unlock / Recovery UI state
  const [unlockInput, setUnlockInput] = useState('');
  const [showUnlockPassword, setShowUnlockPassword] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlockBusy, setUnlockBusy] = useState(false);

  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryAnswer, setRecoveryAnswer] = useState('');
  const [newLockPassword, setNewLockPassword] = useState('');
  const [confirmNewLockPassword, setConfirmNewLockPassword] = useState('');

  // Vault list / grid state
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [entryModalOpen, setEntryModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<PasswordItem | null>(null);
  const [entryToDelete, setEntryToDelete] = useState<PasswordItem | null>(null);
  const [lockModalMode, setLockModalMode] = useState<'setup' | 'remove' | null>(null);

  const filteredPasswords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return passwords.filter(
      (item) =>
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.link.toLowerCase().includes(q) ||
        (item.username && item.username.toLowerCase().includes(q))
    );
  }, [passwords, searchQuery]);

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnlockError(null);
    setUnlockBusy(true);
    try {
      await unlockPasswordVault(unlockInput);
      setUnlockInput('');
      setRecoveryMode(false);
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : 'Incorrect main lock password.');
    } finally {
      setUnlockBusy(false);
    }
  };

  const handleResetLockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnlockError(null);
    if (newLockPassword.length < 4) {
      setUnlockError('New main lock password must be at least 4 characters.');
      return;
    }
    if (newLockPassword !== confirmNewLockPassword) {
      setUnlockError('New passwords do not match.');
      return;
    }
    setUnlockBusy(true);
    try {
      await resetPasswordMainLock(recoveryAnswer, newLockPassword);
      setRecoveryAnswer('');
      setNewLockPassword('');
      setConfirmNewLockPassword('');
      setRecoveryMode(false);
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : 'Incorrect recovery answer.');
    } finally {
      setUnlockBusy(false);
    }
  };

  const toggleReveal = (id: string) => {
    setRevealedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopyPassword = async (item: PasswordItem) => {
    try {
      await navigator.clipboard.writeText(item.password);
      setCopiedId(item.id);
      addToast('Password Copied', 'info', `Copied password for "${item.name}".`);
      setTimeout(() => setCopiedId((curr) => (curr === item.id ? null : curr)), 2000);
    } catch {
      addToast('Clipboard Unavailable', 'error', 'Could not access system clipboard.');
    }
  };

  const handleSaveEntry = async (data: Omit<PasswordItem, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (editingEntry) {
      await updatePassword(editingEntry.id, data);
      setEditingEntry(null);
    } else {
      await addPassword(data);
    }
  };

  const handleConfirmDelete = async () => {
    if (!entryToDelete) return;
    await deletePassword(entryToDelete.id);
    setEntryToDelete(null);
  };

  // Locked screen when Main Lock is set and vault is locked
  if (hasPasswordLock && !isPasswordVaultUnlocked) {
    return (
      <div className="space-y-6 animate-in fade-in duration-150">
        <div className="pb-4 border-b border-white/[0.06] flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-white tracking-tight">Passwords</h1>
            <p className="text-xs text-zinc-400 mt-0.5 tabular-nums">
              {passwordCount} encrypted {passwordCount === 1 ? 'entry' : 'entries'} · Locked
            </p>
          </div>
        </div>

        <div className="max-w-md mx-auto pt-4 sm:pt-8">
          <div className="surface-card rounded-xl p-5 sm:p-6 space-y-5">
            {!recoveryMode ? (
              <>
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white shrink-0">
                    <Lock className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-white">Passwords Locked</h2>
                    <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                      Enter your main lock password to decrypt your saved logins from local storage.
                    </p>
                  </div>
                </div>

                <form onSubmit={handleUnlockSubmit} className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-mono text-zinc-400 mb-1.5">
                      Main Lock Password
                    </label>
                    <div className="relative">
                      <input
                        type={showUnlockPassword ? 'text' : 'password'}
                        required
                        autoFocus
                        placeholder="Enter main lock password"
                        value={unlockInput}
                        onChange={(e) => setUnlockInput(e.target.value)}
                        className="w-full px-3 py-2.5 pr-10 rounded-lg bg-black/40 border border-white/[0.08] text-sm sm:text-xs font-mono text-white placeholder-zinc-600 focus:outline-none focus:border-white/30"
                      />
                      <button
                        type="button"
                        onClick={() => setShowUnlockPassword((prev) => !prev)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-zinc-400 hover:text-white"
                        aria-label={showUnlockPassword ? 'Hide password' : 'Show password'}
                      >
                        {showUnlockPassword ? (
                          <EyeOff className="w-3.5 h-3.5" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {unlockError && (
                    <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{unlockError}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setUnlockError(null);
                        setRecoveryMode(true);
                      }}
                      className="text-xs text-zinc-400 hover:text-white transition-colors"
                    >
                      Forgot password?
                    </button>

                    <button
                      type="submit"
                      disabled={unlockBusy || !unlockInput}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white hover:bg-zinc-200 text-black text-xs font-semibold disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
                    >
                      {unlockBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Unlock className="w-3.5 h-3.5" />
                      )}
                      <span>{unlockBusy ? 'Decrypting...' : 'Unlock'}</span>
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white shrink-0">
                    <KeyRound className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-white">Reset Main Lock Password</h2>
                    <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                      Answer your saved security question to reset the main lock without losing your
                      saved passwords.
                    </p>
                  </div>
                </div>

                <form onSubmit={handleResetLockSubmit} className="space-y-4">
                  <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.08]">
                    <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-1">
                      Security Question
                    </p>
                    <p className="text-xs font-medium text-white leading-relaxed">
                      {passwordRecoveryQuestion || 'Security question not available.'}
                    </p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono text-zinc-400 mb-1.5">
                      Your Answer
                    </label>
                    <input
                      type="text"
                      required
                      autoFocus
                      placeholder="Enter your recovery answer"
                      value={recoveryAnswer}
                      onChange={(e) => setRecoveryAnswer(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg bg-black/40 border border-white/[0.08] text-sm sm:text-xs font-mono text-white placeholder-zinc-600 focus:outline-none focus:border-white/30"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-mono text-zinc-400 mb-1.5">
                        New Lock Password
                      </label>
                      <input
                        type="password"
                        required
                        minLength={4}
                        placeholder="At least 4 chars"
                        value={newLockPassword}
                        onChange={(e) => setNewLockPassword(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg bg-black/40 border border-white/[0.08] text-sm sm:text-xs font-mono text-white placeholder-zinc-600 focus:outline-none focus:border-white/30"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-mono text-zinc-400 mb-1.5">
                        Confirm Password
                      </label>
                      <input
                        type="password"
                        required
                        minLength={4}
                        placeholder="Repeat password"
                        value={confirmNewLockPassword}
                        onChange={(e) => setConfirmNewLockPassword(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg bg-black/40 border border-white/[0.08] text-sm sm:text-xs font-mono text-white placeholder-zinc-600 focus:outline-none focus:border-white/30"
                      />
                    </div>
                  </div>

                  {unlockError && (
                    <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{unlockError}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.06]">
                    <button
                      type="button"
                      onClick={() => {
                        setUnlockError(null);
                        setRecoveryMode(false);
                      }}
                      className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back to unlock</span>
                    </button>

                    <button
                      type="submit"
                      disabled={
                        unlockBusy ||
                        !recoveryAnswer.trim() ||
                        !newLockPassword ||
                        !confirmNewLockPassword
                      }
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white hover:bg-zinc-200 text-black text-xs font-semibold disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
                    >
                      {unlockBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>{unlockBusy ? 'Resetting...' : 'Reset Lock'}</span>
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/[0.06]">
        <div>
          <h1 className="text-xl font-semibold text-white tracking-tight">Passwords</h1>
          <p className="text-xs text-zinc-400 mt-0.5 tabular-nums">
            {passwords.length} saved locally ·{' '}
            {hasPasswordLock ? 'Main lock active (AES-256-GCM)' : 'No main lock set (optional)'}
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2 shrink-0">
          {!hasPasswordLock ? (
            <button
              onClick={() => setLockModalMode('setup')}
              className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-200 hover:text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Set Main Lock</span>
            </button>
          ) : (
            <>
              <button
                onClick={lockPasswordVault}
                className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-200 hover:text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Lock</span>
              </button>
              <button
                onClick={() => setLockModalMode('remove')}
                className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.08] text-zinc-400 hover:text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0"
              >
                <span>Remove Lock</span>
              </button>
            </>
          )}

          <button
            onClick={() => {
              setEditingEntry(null);
              setEntryModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg bg-white hover:bg-zinc-200 text-black text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Password</span>
          </button>
        </div>
      </div>

      {/* Search & View Toggle */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search saved websites or usernames..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 sm:py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.08] text-sm sm:text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/[0.2]"
          />
        </div>

        <div className="flex items-center self-end sm:self-auto p-0.5 rounded-lg bg-white/[0.03] border border-white/[0.08] shrink-0">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded text-xs transition-colors ${
              viewMode === 'grid' ? 'bg-white/[0.1] text-white' : 'text-zinc-500 hover:text-white'
            }`}
            title="Grid"
            aria-label="Grid view"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded text-xs transition-colors ${
              viewMode === 'list' ? 'bg-white/[0.1] text-white' : 'text-zinc-500 hover:text-white'
            }`}
            title="List"
            aria-label="List view"
          >
            <List className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Entries */}
      {filteredPasswords.length === 0 ? (
        <div className="surface-card rounded-xl p-10 text-center space-y-2.5">
          <KeyRound className="w-6 h-6 text-zinc-600 mx-auto" />
          <h3 className="text-xs font-medium text-white">
            {passwords.length === 0 ? 'No passwords saved yet' : 'No matching entries found'}
          </h3>
          <p className="text-[11px] text-zinc-500">
            {passwords.length === 0
              ? 'Save a website name, link, and password directly to encrypted local storage.'
              : 'Try adjusting your search query.'}
          </p>
          {passwords.length === 0 && (
            <button
              onClick={() => {
                setEditingEntry(null);
                setEntryModalOpen(true);
              }}
              className="mt-2 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white hover:bg-zinc-200 text-black text-xs font-medium transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add First Password</span>
            </button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredPasswords.map((entry) => {
            const revealed = Boolean(revealedIds[entry.id]);
            const host = getHostLabel(entry.link);
            const href = normalizeHref(entry.link);

            return (
              <div
                key={entry.id}
                className="surface-card rounded-xl p-4 flex flex-col justify-between gap-4 hover:border-white/[0.15] transition-all"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-zinc-200 shrink-0 font-mono text-xs font-semibold">
                        {entry.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-xs font-semibold text-white truncate">{entry.name}</h3>
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-mono text-zinc-400 hover:text-white transition-colors truncate max-w-full"
                        >
                          <span className="truncate">{host}</span>
                          <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                        </a>
                      </div>
                    </div>

                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => {
                          setEditingEntry(entry);
                          setEntryModalOpen(true);
                        }}
                        className="p-1.5 rounded text-zinc-500 hover:text-white transition-colors"
                        title="Edit"
                        aria-label={`Edit ${entry.name}`}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (settings.confirmBeforeDelete) {
                            setEntryToDelete(entry);
                          } else {
                            void deletePassword(entry.id);
                          }
                        }}
                        className="p-1.5 rounded text-zinc-500 hover:text-red-400 transition-colors"
                        title="Delete"
                        aria-label={`Delete ${entry.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {entry.username && (
                    <div className="text-[11px] font-mono text-zinc-400 truncate">
                      {entry.username}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-black/40 border border-white/[0.06]">
                    <span className="text-xs font-mono text-zinc-200 truncate select-all">
                      {revealed ? entry.password : '••••••••••••'}
                    </span>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => toggleReveal(entry.id)}
                        className="p-1.5 rounded text-zinc-400 hover:text-white transition-colors"
                        title={revealed ? 'Hide password' : 'Show password'}
                        aria-label={revealed ? 'Hide password' : 'Show password'}
                      >
                        {revealed ? (
                          <EyeOff className="w-3.5 h-3.5" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopyPassword(entry)}
                        className="p-1.5 rounded text-zinc-400 hover:text-white transition-colors"
                        title="Copy password"
                        aria-label={`Copy password for ${entry.name}`}
                      >
                        {copiedId === entry.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="pt-2.5 border-t border-white/[0.06] flex items-center justify-between text-[10px] font-mono text-zinc-500">
                  <span>
                    Saved{' '}
                    {new Date(entry.updatedAt || entry.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-zinc-400 hover:text-white flex items-center gap-1 transition-colors"
                  >
                    <span>Visit</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="surface-card rounded-xl divide-y divide-white/[0.04] overflow-hidden">
          {filteredPasswords.map((entry) => {
            const revealed = Boolean(revealedIds[entry.id]);
            const host = getHostLabel(entry.link);
            const href = normalizeHref(entry.link);

            return (
              <div
                key={entry.id}
                className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-7 h-7 rounded-md bg-white/[0.04] border border-white/[0.08] flex items-center justify-center font-mono text-[11px] text-zinc-300 font-semibold shrink-0">
                    {entry.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white truncate">
                        {entry.name}
                      </span>
                      <span className="text-[11px] font-mono text-zinc-500 truncate">
                        · {host}
                      </span>
                    </div>
                    {entry.username && (
                      <p className="text-[11px] font-mono text-zinc-400 truncate mt-0.5">
                        {entry.username}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <span className="text-xs font-mono text-zinc-300 px-2.5 py-1 rounded bg-black/40 border border-white/[0.06] max-w-[160px] truncate">
                    {revealed ? entry.password : '••••••••••'}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleReveal(entry.id)}
                    className="p-1.5 rounded text-zinc-500 hover:text-white transition-colors"
                    aria-label={revealed ? 'Hide password' : 'Show password'}
                  >
                    {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopyPassword(entry)}
                    className="p-1.5 rounded text-zinc-500 hover:text-white transition-colors"
                    aria-label={`Copy password for ${entry.name}`}
                  >
                    {copiedId === entry.id ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1.5 rounded text-zinc-500 hover:text-white transition-colors"
                    aria-label={`Open ${entry.name}`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingEntry(entry);
                      setEntryModalOpen(true);
                    }}
                    className="p-1.5 rounded text-zinc-500 hover:text-white transition-colors"
                    aria-label={`Edit ${entry.name}`}
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (settings.confirmBeforeDelete) {
                        setEntryToDelete(entry);
                      } else {
                        void deletePassword(entry.id);
                      }
                    }}
                    className="p-1.5 rounded text-zinc-500 hover:text-red-400 transition-colors"
                    aria-label={`Delete ${entry.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <PasswordModal
        isOpen={entryModalOpen}
        entryToEdit={editingEntry}
        onClose={() => {
          setEntryModalOpen(false);
          setEditingEntry(null);
        }}
        onSave={handleSaveEntry}
      />

      <MainLockModal
        mode={lockModalMode}
        onClose={() => setLockModalMode(null)}
        onSetupLock={enablePasswordMainLock}
        onRemoveLock={disablePasswordMainLock}
      />

      <ConfirmModal
        isOpen={Boolean(entryToDelete)}
        title="Delete Password?"
        description={`Are you sure you want to remove the saved password for "${entryToDelete?.name}"?`}
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
        onCancel={() => setEntryToDelete(null)}
      />
    </div>
  );
};
