import React from 'react';
import { MediaItem } from '../../types';
import { PosterImage } from './PosterImage';
import { X, Shuffle, Play, ArrowUpRight, Star } from 'lucide-react';

interface PickTonightModalProps {
  item: MediaItem | null;
  poolSize: number;
  onClose: () => void;
  onPickAnother: () => void;
  onStartWatching: (item: MediaItem) => void;
  onViewDetails: (item: MediaItem) => void;
}

const TYPE_LABELS: Record<MediaItem['type'], string> = {
  movie: 'Movie',
  series: 'Series',
  anime: 'Anime',
};

const STATUS_LABELS: Record<MediaItem['status'], string> = {
  want_to_watch: 'Watchlist',
  watching: 'Watching',
  completed: 'Completed',
  on_hold: 'On Hold',
  dropped: 'Dropped',
};

export const PickTonightModal: React.FC<PickTonightModalProps> = ({
  item,
  poolSize,
  onClose,
  onPickAnother,
  onStartWatching,
  onViewDetails,
}) => {
  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg surface-elevated border border-white/[0.1] rounded-t-2xl sm:rounded-xl overflow-hidden shadow-2xl pb-[env(safe-area-inset-bottom)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shuffle className="w-3.5 h-3.5 text-zinc-400" />
            <span className="text-xs font-semibold text-white">Tonight&apos;s Pick</span>
            <span className="text-[11px] font-mono text-zinc-500">
              · {poolSize} {poolSize === 1 ? 'candidate' : 'candidates'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 -mr-1.5 text-zinc-400 hover:text-white rounded-lg transition-colors"
            aria-label="Close picker"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex gap-4">
          <div className="w-24 sm:w-28 aspect-[2/3] rounded-lg overflow-hidden bg-[#0c0c0e] border border-white/[0.06] shrink-0">
            <PosterImage
              src={item.posterUrl}
              alt={item.title}
              title={item.title}
              year={item.releaseYear}
              type={item.type}
              className="w-full h-full object-cover"
              fallback={
                <div className="w-full h-full flex items-center justify-center text-[10px] font-mono text-zinc-600 uppercase">
                  {TYPE_LABELS[item.type]}
                </div>
              }
            />
          </div>

          <div className="min-w-0 flex-1 flex flex-col justify-between">
            <div className="space-y-1.5">
              <h2 className="text-base sm:text-lg font-semibold text-white leading-snug">
                {item.title}
              </h2>

              <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-zinc-400">
                <span>{TYPE_LABELS[item.type]}</span>
                {item.releaseYear > 0 && (
                  <>
                    <span className="text-zinc-600">·</span>
                    <span>{item.releaseYear}</span>
                  </>
                )}
                <span className="text-zinc-600">·</span>
                <span>{STATUS_LABELS[item.status]}</span>
                {item.rating > 0 && (
                  <>
                    <span className="text-zinc-600">·</span>
                    <span className="inline-flex items-center gap-1 text-amber-400">
                      <Star className="w-3 h-3 fill-amber-400" />
                      {item.rating}
                    </span>
                  </>
                )}
              </div>

              {item.genre && (
                <p className="text-[11px] text-zinc-500 truncate">{item.genre}</p>
              )}

              {item.description && (
                <p className="text-xs text-zinc-300 leading-relaxed line-clamp-3 pt-1">
                  {item.description}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-white/[0.06] bg-white/[0.01] flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={onPickAnother}
            disabled={poolSize <= 1}
            className="inline-flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-40 text-xs text-zinc-200 transition-colors whitespace-nowrap"
          >
            <Shuffle className="w-3.5 h-3.5 text-zinc-400" />
            <span>Pick Another</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onViewDetails(item)}
              className="inline-flex items-center gap-1 px-3 py-2 sm:py-1.5 rounded-lg border border-white/[0.08] hover:border-white/[0.2] text-xs text-zinc-300 hover:text-white transition-colors whitespace-nowrap"
            >
              <span>Details</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>

            {item.status !== 'watching' && (
              <button
                type="button"
                onClick={() => onStartWatching(item)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 sm:py-1.5 rounded-lg bg-white hover:bg-zinc-200 text-black text-xs font-medium transition-colors whitespace-nowrap"
              >
                <Play className="w-3 h-3 fill-black" />
                <span>Start Watching</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
