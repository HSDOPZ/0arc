import React, { useState, useEffect } from 'react';
import { NoteItem } from '../../types';
import { X } from 'lucide-react';

interface NoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (noteData: Omit<NoteItem, 'id' | 'createdAt' | 'updatedAt'>) => void;
}

const NOTE_CATEGORIES = ['General', 'Ideas', 'Design', 'Engineering', 'Writing', 'Inbox'];

export const NoteModal: React.FC<NoteModalProps> = ({ isOpen, onClose, onSave }) => {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('General');
  const [content, setContent] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setTitle('');
    setCategory('General');
    setContent('');
    setIsFavorite(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    onSave({
      title: title.trim(),
      content: content.trim(),
      category: category.trim() || 'General',
      tags: [],
      isFavorite,
    });
    onClose();
  };

  const inputClass =
    'w-full px-3 py-2.5 rounded-lg bg-black/40 border border-white/[0.08] text-sm sm:text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 transition-colors';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm sm:p-4 animate-in fade-in duration-150">
      <div className="w-full sm:max-w-lg surface-elevated rounded-t-2xl sm:rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[92dvh] border border-white/[0.08] pb-[env(safe-area-inset-bottom)] sm:pb-0">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/15 sm:hidden shrink-0" />

        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-white/[0.06] shrink-0">
          <h2 className="text-sm font-semibold text-white tracking-tight">Add Note</h2>
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
              Title <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              placeholder="Note title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono text-zinc-400 mb-1.5">Category</label>
            <input
              type="text"
              list="note-category-suggestions"
              placeholder="General"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputClass}
            />
            <datalist id="note-category-suggestions">
              {NOTE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-[11px] font-mono text-zinc-400 mb-1.5">Content</label>
            <textarea
              rows={5}
              placeholder="Write your note here..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className={`${inputClass} resize-none`}
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="note-modal-fav"
              checked={isFavorite}
              onChange={(e) => setIsFavorite(e.target.checked)}
              className="rounded bg-black/40 border-white/[0.2] accent-white"
            />
            <label htmlFor="note-modal-fav" className="text-xs text-zinc-300 cursor-pointer select-none">
              Favorite
            </label>
          </div>

          <div className="flex items-center gap-2 pt-3 border-t border-white/[0.06]">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none px-3 py-2.5 sm:py-1.5 text-xs text-zinc-400 hover:text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 sm:flex-none px-3.5 py-2.5 sm:py-1.5 text-xs font-medium text-black bg-white hover:bg-zinc-200 rounded-lg transition-colors"
            >
              Add Note
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
