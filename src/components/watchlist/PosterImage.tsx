import React, { useState, useEffect } from 'react';
import { MediaType } from '../../types';
import { findFallbackPoster } from '../../lib/mediaLookup';

interface PosterImageProps {
  src?: string;
  alt: string;
  title?: string;
  year?: number;
  type?: MediaType;
  className?: string;
  loading?: 'eager' | 'lazy';
  fetchPriority?: 'high' | 'low' | 'auto';
  fallback: React.ReactNode;
}

export const PosterImage: React.FC<PosterImageProps> = ({
  src,
  alt,
  title,
  year,
  type,
  className,
  loading,
  fetchPriority,
  fallback,
}) => {
  const [resolvedSrc, setResolvedSrc] = useState<string>(src || '');
  const [triedFallback, setTriedFallback] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setResolvedSrc(src || '');
    setTriedFallback(false);
    setFailed(false);
  }, [src, title, year, type]);

  useEffect(() => {
    let active = true;
    if (!src && title && !triedFallback) {
      setTriedFallback(true);
      findFallbackPoster({ title, year, type })
        .then((nextUrl) => {
          if (active && nextUrl) {
            setResolvedSrc(nextUrl);
            setFailed(false);
          }
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [src, title, year, type, triedFallback]);

  const handleError = () => {
    if (!triedFallback && title) {
      setTriedFallback(true);
      findFallbackPoster({
        title,
        year,
        type,
        failedUrl: resolvedSrc,
      })
        .then((nextUrl) => {
          if (nextUrl && nextUrl !== resolvedSrc) {
            setResolvedSrc(nextUrl);
            setFailed(false);
          } else {
            setFailed(true);
          }
        })
        .catch(() => setFailed(true));
    } else {
      setFailed(true);
    }
  };

  if (!resolvedSrc || failed) {
    return <>{fallback}</>;
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      loading={loading}
      decoding="async"
      fetchPriority={fetchPriority}
      referrerPolicy="no-referrer"
      onError={handleError}
      className={className}
    />
  );
};
