import React, { useState, useEffect } from 'react';
import { PasswordItem } from '../../types';
import { generateStrongPassword } from '../../utils/passwordVaultCrypto';
import { X, Eye, EyeOff, RefreshCw } from 'lucide-react';

interface PasswordModalProps {
  isOpen: boolean;
  entryToEdit?: PasswordItem | null;
  onClose: () => void;
  onSave: (data: Omit<PasswordItem, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void> | void;
}

export const PasswordModal: React.FC<PasswordModalProps> = ({
  isOpen,
  entryToEdit,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (entryToEdit) {
      setName(entryToEdit.name);
      setLink(entryToEdit.link);
      setUsername(entryToEdit.username || '');
      setPassword(entryToEdit.password);
    } else {
      setName('');
      setLink('');
      setUsername('');
      setPassword('');
    }
    setShowPassword(false);
    setSubmitting(false);
  }, [entryToEdit, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !link.trim() || !password) return;
    setSubmitting(true);
    try {
      await onSave({
        name: name.trim(),
        link: link.trim(),
        username: username.trim() || undefined,
        password,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2.5 rounded-lg bg-black/40 border border-white/[0.08] text-sm sm:text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 transition-colors';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm sm:p-4 animate-in fade-in duration-150">
      <div className="w-full sm:max-w-lg surface-elevated rounded-t-2xl sm:rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[92dvh] border border-white/[0.08] pb-[env(safe-area-inset-bottom)] sm:pb-0">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/15 sm:hidden shrink-0" />

        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-white/[0.06] shrink-0">
          <h2 className="text-sm font-semibold text-white tracking-tight">
            {entryToEdit ? 'Edit Password' : 'Add Password'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-2 -mr-2 rounded-md hover:bg-white/[0.06] transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4"
        >
          <div>
            <label className="block text-[11px] font-mono text-zinc-400 mb-1.5">
              Website Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              placeholder="e.g. GitHub, Gmail, Linear"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono text-zinc-400 mb-1.5">
              Website Link <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              required
              inputMode="url"
              placeholder="https://github.com/login"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              className={`${inputClass} font-mono sm:text-[11px]`}
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono text-zinc-400 mb-1.5">
              Username or Email (optional)
            </label>
            <input
              type="text"
              placeholder="you@example.com"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={`${inputClass} font-mono sm:text-[11px]`}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-mono text-zinc-400">
                Password <span className="text-red-400">*</span>
              </label>
              <button
                type="button"
                onClick={() => {
                  setPassword(generateStrongPassword());
                  setShowPassword(true);
                }}
                className="flex items-center gap-1 text-[11px] font-mono text-zinc-300 hover:text-white transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Generate</span>
              </button>
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputClass} font-mono pr-10 sm:text-[11px]`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-zinc-400 hover:text-white transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-3 border-t border-white/[0.06]">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-2.5 sm:py-1.5 text-xs text-zinc-400 hover:text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim() || !link.trim() || !password}
              className="flex-1 sm:flex-none px-4 py-2.5 sm:py-1.5 text-xs font-semibold text-black bg-white hover:bg-zinc-200 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {submitting ? 'Encrypting...' : entryToEdit ? 'Save Changes' : 'Save Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
