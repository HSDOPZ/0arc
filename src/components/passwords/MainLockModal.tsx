import React, { useState, useEffect } from 'react';
import { pickRandomSecurityQuestion } from '../../utils/passwordVaultCrypto';
import { X, Lock, ShieldCheck, Eye, EyeOff, RefreshCw, AlertTriangle, Loader2 } from 'lucide-react';

interface MainLockModalProps {
  mode: 'setup' | 'remove' | null;
  onClose: () => void;
  onSetupLock: (
    mainPassword: string,
    recoveryQuestion: string,
    recoveryAnswer: string
  ) => Promise<void>;
  onRemoveLock: (currentPassword: string) => Promise<void>;
}

export const MainLockModal: React.FC<MainLockModalProps> = ({
  mode,
  onClose,
  onSetupLock,
  onRemoveLock,
}) => {
  const [step, setStep] = useState<'password' | 'question'>('password');
  const [mainPassword, setMainPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [randomQuestion, setRandomQuestion] = useState(() => pickRandomSecurityQuestion());
  const [recoveryAnswer, setRecoveryAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!mode) return;
    setStep('password');
    setMainPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setRandomQuestion(pickRandomSecurityQuestion());
    setRecoveryAnswer('');
    setError(null);
    setBusy(false);
  }, [mode]);

  if (!mode) return null;

  const inputClass =
    'w-full px-3 py-2.5 rounded-lg bg-black/40 border border-white/[0.08] text-sm sm:text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 transition-colors font-mono';

  const handleStepOneSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mainPassword.length < 4) {
      setError('Main lock password must be at least 4 characters.');
      return;
    }
    if (mainPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setRandomQuestion(pickRandomSecurityQuestion());
    setStep('question');
  };

  const handleActivateLock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!recoveryAnswer.trim()) {
      setError('Please enter an answer so you can reset the lock if you forget it.');
      return;
    }
    setBusy(true);
    try {
      await onSetupLock(mainPassword, randomQuestion, recoveryAnswer);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable main lock.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveLock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!mainPassword) {
      setError('Enter your current main lock password.');
      return;
    }
    setBusy(true);
    try {
      await onRemoveLock(mainPassword);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incorrect main lock password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm sm:p-4 animate-in fade-in duration-150">
      <div className="w-full sm:max-w-md surface-elevated rounded-t-2xl sm:rounded-xl shadow-2xl overflow-hidden flex flex-col border border-white/[0.08] pb-[env(safe-area-inset-bottom)] sm:pb-0">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/15 sm:hidden shrink-0" />

        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            {mode === 'setup' ? (
              <ShieldCheck className="w-4 h-4 text-zinc-300" />
            ) : (
              <Lock className="w-4 h-4 text-zinc-300" />
            )}
            <h2 className="text-sm font-semibold text-white tracking-tight">
              {mode === 'setup'
                ? step === 'password'
                  ? 'Set Passwords Main Lock'
                  : 'Recovery Security Question'
                : 'Remove Main Lock'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-zinc-400 hover:text-white p-2 -mr-2 rounded-md hover:bg-white/[0.06] transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {mode === 'setup' && step === 'password' && (
          <form onSubmit={handleStepOneSubmit} className="p-4 sm:p-5 space-y-4">
            <p className="text-xs text-zinc-400 leading-relaxed">
              This optional main lock encrypts only the Passwords section in local storage using
              AES-256-GCM and PBKDF2-SHA-512. Your main lock password is saved once — in the next
              step you will answer a random recovery question in case you forget it.
            </p>

            <div>
              <label className="block text-[11px] font-mono text-zinc-400 mb-1.5">
                Main Lock Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoFocus
                  minLength={4}
                  placeholder="Choose a strong lock password"
                  value={mainPassword}
                  onChange={(e) => setMainPassword(e.target.value)}
                  className={`${inputClass} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-zinc-400 hover:text-white"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-mono text-zinc-400 mb-1.5">
                Confirm Lock Password
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={4}
                placeholder="Re-enter lock password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass}
              />
            </div>

            {error && (
              <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 sm:flex-none px-4 py-2.5 sm:py-1.5 text-xs text-zinc-400 hover:text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 sm:flex-none px-4 py-2.5 sm:py-1.5 text-xs font-semibold text-black bg-white hover:bg-zinc-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Save & Continue
              </button>
            </div>
          </form>
        )}

        {mode === 'setup' && step === 'question' && (
          <form onSubmit={handleActivateLock} className="p-4 sm:p-5 space-y-4">
            <p className="text-xs text-zinc-400 leading-relaxed">
              Your main lock password is ready and can only be saved once. Answer this random
              question so you can reset the lock if you ever forget your password.
            </p>

            <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.08] space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                  Random Question
                </span>
                <button
                  type="button"
                  onClick={() => setRandomQuestion((prev) => pickRandomSecurityQuestion(prev))}
                  className="flex items-center gap-1 text-[11px] font-mono text-zinc-400 hover:text-white transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>New question</span>
                </button>
              </div>
              <p className="text-xs font-medium text-white leading-relaxed">{randomQuestion}</p>
            </div>

            <div>
              <label className="block text-[11px] font-mono text-zinc-400 mb-1.5">
                Your Answer (case-insensitive)
              </label>
              <input
                type="text"
                required
                autoFocus
                placeholder="Type an answer you will remember"
                value={recoveryAnswer}
                onChange={(e) => setRecoveryAnswer(e.target.value)}
                className={inputClass}
              />
            </div>

            {error && (
              <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="flex-1 sm:flex-none px-4 py-2.5 sm:py-1.5 text-xs text-zinc-400 hover:text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !recoveryAnswer.trim()}
                className="flex-1 sm:flex-none px-4 py-2.5 sm:py-1.5 text-xs font-semibold text-black bg-white hover:bg-zinc-200 disabled:opacity-40 rounded-lg transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{busy ? 'Encrypting Vault...' : 'Activate Main Lock'}</span>
              </button>
            </div>
          </form>
        )}

        {mode === 'remove' && (
          <form onSubmit={handleRemoveLock} className="p-4 sm:p-5 space-y-4">
            <p className="text-xs text-zinc-400 leading-relaxed">
              Enter your current main lock password to remove the optional lock from the Passwords
              section. Your saved website passwords will stay stored locally.
            </p>

            <div>
              <label className="block text-[11px] font-mono text-zinc-400 mb-1.5">
                Current Main Lock Password
              </label>
              <input
                type="password"
                required
                autoFocus
                placeholder="Enter main lock password"
                value={mainPassword}
                onChange={(e) => setMainPassword(e.target.value)}
                className={inputClass}
              />
            </div>

            {error && (
              <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="flex-1 sm:flex-none px-4 py-2.5 sm:py-1.5 text-xs text-zinc-400 hover:text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !mainPassword}
                className="flex-1 sm:flex-none px-4 py-2.5 sm:py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-40 rounded-lg transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{busy ? 'Verifying...' : 'Remove Main Lock'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
