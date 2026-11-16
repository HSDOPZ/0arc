import type { MediaType } from '../types';

export interface MediaCandidate {
  id: string;
  title: string;
  year?: number;
  type: MediaType;
  rawType?: string;
  posterUrl?: string;
  stars?: string;
}

export interface MediaDetails {
  title: string;
  type: MediaType;
  description: string;
  genre: string;
  releaseYear: number;
  rating: number;
  posterUrl: string;
  progressTotal?: number;
}

const REQUEST_TIMEOUT_MS = 6000;

interface CachedMeta {
  title: string;
  type: MediaType;
  description?: string;
  genre?: string;
  releaseYear?: number;
  rating?: number;
  posterUrl?: string;
  progressTotal?: number;
}

const candidateCache = new Map<string, CachedMeta>();
const verifiedPosterCache = new Map<string, string>();

async function fetchJsonWithTimeout<T>(url: string, init: RequestInit = {}): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractYear(value?: unknown): number | undefined {
  if (typeof value === 'number' && value >= 1888 && value <= 2100) return value;
  if (typeof value === 'string') {
    const match = value.match(/\b(18\d{2}|19\d{2}|20\d{2})\b/);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function splitTitleAndYear(rawTitle: string, explicitYear?: number): { title: string; year?: number } {
  const trimmed = rawTitle.trim();
  if (explicitYear) return { title: trimmed, year: explicitYear };
  const trailingYear = trimmed.match(/^(.*?)\s*\(?((?:19|20)\d{2})\)?$/);
  if (trailingYear && trailingYear[1].trim().length >= 2) {
    return {
      title: trailingYear[1].trim(),
      year: Number(trailingYear[2]),
    };
  }
  return { title: trimmed, year: undefined };
}

function upgradeCinemetaPoster(url?: string): string | undefined {
  if (!url || !url.startsWith('http')) return undefined;
  return url.replace('/poster/small/', '/poster/medium/');
}

function cleanPosterUrl(url?: string): string | undefined {
  if (!url || !url.startsWith('http')) return undefined;
  return url.replace(/\?utm_source=en\.wikipedia\.org[^#]*/i, '');
}

function normalizeTitleKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function roundRating(val: unknown): number {
  const num = typeof val === 'number' ? val : parseFloat(String(val ?? ''));
  if (!Number.isFinite(num) || num <= 0 || num > 10) return 0;
  return Math.round(num * 10) / 10;
}

function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\(Source:[^)]+\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Verifies in the browser/webview whether an image URL actually loads (avoiding CORS limits).
 */
export function isImageLoadable(url: string, timeoutMs = 2500): Promise<boolean> {
  if (!url || !url.startsWith('http')) return Promise.resolve(false);
  if (typeof Image === 'undefined') return Promise.resolve(true);

  return new Promise((resolve) => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    let settled = false;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve(ok);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);
    img.onload = () => finish(img.naturalWidth > 0);
    img.onerror = () => finish(false);
    img.src = url;
  });
}

async function pickFirstWorkingPoster(candidates: Array<string | undefined>): Promise<string> {
  const unique = Array.from(
    new Set(candidates.map((u) => cleanPosterUrl(u)).filter((u): u is string => Boolean(u)))
  );
  for (const url of unique) {
    if (await isImageLoadable(url)) return url;
  }
  return '';
}

interface CinemetaCatalogResponse {
  metas?: Array<{
    id?: string;
    imdb_id?: string;
    type?: string;
    name?: string;
    releaseInfo?: string;
    year?: string | number;
    poster?: string;
    cast?: string[];
  }>;
}

interface CinemetaMetaResponse {
  meta?: {
    id?: string;
    imdb_id?: string;
    type?: string;
    name?: string;
    description?: string;
    releaseInfo?: string;
    year?: string | number;
    imdbRating?: string | number;
    genres?: string[];
    genre?: string[];
    poster?: string;
    cast?: string[];
    country?: string;
    videos?: Array<unknown>;
  };
}

interface AniListResponse {
  data?: {
    Page?: {
      media?: Array<{
        id: number;
        title?: { romaji?: string; english?: string };
        description?: string;
        averageScore?: number;
        genres?: string[];
        seasonYear?: number;
        episodes?: number;
        coverImage?: { large?: string; extraLarge?: string };
      }>;
    };
  };
}

interface TvMazeSearchItem {
  score?: number;
  show?: TvMazeShow;
}

interface TvMazeShow {
  id: number;
  name?: string;
  genres?: string[];
  premiered?: string;
  summary?: string;
  rating?: { average?: number | null };
  image?: { medium?: string; original?: string };
  externals?: { imdb?: string };
}

async function searchCinemetaCatalog(
  query: string,
  catalogType: 'movie' | 'series',
  displayType: MediaType
): Promise<MediaCandidate[]> {
  const url = `https://v3-cinemeta.strem.io/catalog/${catalogType}/top/search=${encodeURIComponent(query)}.json`;
  const data = await fetchJsonWithTimeout<CinemetaCatalogResponse>(url);
  if (!Array.isArray(data?.metas)) return [];

  return data.metas
    .filter((item) => typeof (item.imdb_id || item.id) === 'string' && item.name)
    .slice(0, 8)
    .map((item) => {
      const id = String(item.imdb_id || item.id);
      const year = extractYear(item.releaseInfo) ?? extractYear(item.year);
      const posterUrl = upgradeCinemetaPoster(item.poster);
      return {
        id,
        title: String(item.name),
        year,
        type: displayType,
        rawType: displayType === 'anime' ? 'anime' : catalogType === 'series' ? 'TV series' : 'movie',
        posterUrl,
        stars: Array.isArray(item.cast) && item.cast.length > 0 ? item.cast.slice(0, 2).join(', ') : undefined,
      };
    });
}

async function searchAniList(query: string): Promise<MediaCandidate[]> {
  const gql = `query($s:String){Page(perPage:5){media(search:$s,type:ANIME,sort:POPULARITY_DESC){id title{romaji english} description(asHtml:false) averageScore genres seasonYear episodes coverImage{large extraLarge}}}}`;
  const data = await fetchJsonWithTimeout<AniListResponse>('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: gql, variables: { s: query } }),
  });

  const list = data?.data?.Page?.media;
  if (!Array.isArray(list)) return [];

  return list.map((item) => {
    const title = item.title?.english || item.title?.romaji || query;
    const id = `al:${item.id}`;
    const posterUrl = item.coverImage?.extraLarge || item.coverImage?.large;
    const rating = item.averageScore ? roundRating(item.averageScore / 10) : 0;
    const description = item.description ? stripHtml(item.description) : undefined;
    const genre = Array.isArray(item.genres) && item.genres.length > 0 ? item.genres.join(', ') : 'Animation';

    candidateCache.set(id, {
      title,
      type: 'anime',
      description,
      genre,
      releaseYear: item.seasonYear,
      rating,
      posterUrl,
      progressTotal: item.episodes || undefined,
    });

    return {
      id,
      title,
      year: item.seasonYear,
      type: 'anime' as MediaType,
      rawType: 'anime',
      posterUrl,
    };
  });
}

async function searchTvMaze(query: string): Promise<MediaCandidate[]> {
  const data = await fetchJsonWithTimeout<TvMazeSearchItem[]>(
    `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`
  );
  if (!Array.isArray(data)) return [];

  return data
    .filter((entry) => entry.show?.name)
    .slice(0, 6)
    .map(({ show }) => {
      const s = show!;
      const imdbId = s.externals?.imdb;
      const id = imdbId && imdbId.startsWith('tt') ? imdbId : `tvm:${s.id}`;
      const year = extractYear(s.premiered);
      const posterUrl = s.image?.medium || s.image?.original;
      const isAnime = (s.genres || []).some((g) => g.toLowerCase() === 'anime');
      const mediaType: MediaType = isAnime ? 'anime' : 'series';

      candidateCache.set(id, {
        title: String(s.name),
        type: mediaType,
        description: s.summary ? stripHtml(s.summary) : undefined,
        genre: s.genres?.length ? s.genres.join(', ') : undefined,
        releaseYear: year,
        rating: roundRating(s.rating?.average),
        posterUrl,
      });

      return {
        id,
        title: String(s.name),
        year,
        type: mediaType,
        rawType: isAnime ? 'anime' : 'TV series',
        posterUrl,
      };
    });
}

function rankCandidates(candidates: MediaCandidate[], query: string, targetYear?: number): MediaCandidate[] {
  const normQuery = normalizeTitleKey(query);

  const score = (c: MediaCandidate): number => {
    const normTitle = normalizeTitleKey(c.title);
    let s = 0;
    if (normTitle === normQuery) s += 100;
    else if (normTitle.startsWith(normQuery)) s += 50;
    else if (normTitle.includes(normQuery)) s += 20;
    if (targetYear && c.year === targetYear) s += 40;
    if (c.posterUrl) s += 10;
    if (c.id.startsWith('tt')) s += 5;
    return s;
  };

  const seen = new Set<string>();
  return [...candidates]
    .sort((a, b) => score(b) - score(a))
    .filter((c) => {
      const key = c.id.startsWith('tt') ? c.id : `${normalizeTitleKey(c.title)}:${c.year || ''}:${c.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
}

/**
 * Zero-API-key, zero-server media search running directly in the browser/device.
 * Uses CORS-enabled open catalogs (Cinemeta, AniList, TVMaze).
 */
export async function searchMedia(query: string, type?: MediaType): Promise<MediaCandidate[]> {
  const clean = query.trim();
  if (!clean) return [];

  const { title: parsedTitle, year: parsedYear } = splitTitleAndYear(clean);

  const tasks: Promise<MediaCandidate[]>[] = [];
  if (!type || type === 'movie') {
    tasks.push(searchCinemetaCatalog(clean, 'movie', 'movie'));
  }
  if (!type || type === 'series') {
    tasks.push(searchCinemetaCatalog(clean, 'series', 'series'));
  }
  if (type === 'anime') {
    tasks.push(searchAniList(parsedTitle));
    tasks.push(searchCinemetaCatalog(clean, 'series', 'anime'));
  }

  let results = (await Promise.all(tasks)).flat();

  // Fallback to TVMaze / AniList if Cinemeta returned nothing
  if (results.length === 0) {
    const fallbackTasks: Promise<MediaCandidate[]>[] = [searchTvMaze(parsedTitle)];
    if (type !== 'movie') {
      fallbackTasks.push(searchAniList(parsedTitle));
    }
    results = (await Promise.all(fallbackTasks)).flat();
  }

  return rankCandidates(results, parsedTitle, parsedYear);
}

async function fetchCinemetaMeta(
  imdbId: string,
  preferredType: MediaType
): Promise<CinemetaMetaResponse['meta'] | null> {
  const firstKind = preferredType === 'movie' ? 'movie' : 'series';
  const secondKind = firstKind === 'movie' ? 'series' : 'movie';

  const primary = await fetchJsonWithTimeout<CinemetaMetaResponse>(
    `https://v3-cinemeta.strem.io/meta/${firstKind}/${encodeURIComponent(imdbId)}.json`
  );
  if (primary?.meta?.name) return primary.meta;

  const secondary = await fetchJsonWithTimeout<CinemetaMetaResponse>(
    `https://v3-cinemeta.strem.io/meta/${secondKind}/${encodeURIComponent(imdbId)}.json`
  );
  return secondary?.meta?.name ? secondary.meta : null;
}

interface WikiSearchResponse {
  query?: {
    search?: Array<{
      title: string;
      snippet?: string;
    }>;
  };
}

interface WikiSummaryResponse {
  type?: string;
  title?: string;
  extract?: string;
  thumbnail?: { source?: string };
  originalimage?: { source?: string };
}

/**
 * Searches Wikipedia explicitly using "<title> <year> <film|TV series|anime>"
 * so ambiguous names like "Dune" resolve to "Dune (2021 film)" rather than a sand hill.
 */
async function lookupWikipediaMeta(
  title: string,
  type: MediaType,
  year?: number
): Promise<{ description?: string; posterUrl?: string }> {
  const typeWords =
    type === 'anime'
      ? ['anime', 'animated series']
      : type === 'series'
        ? ['TV series', 'television series']
        : ['film', 'movie'];

  const queries = typeWords.map((word) =>
    [title, year ? String(year) : '', word].filter(Boolean).join(' ')
  );

  const mediaKeywordRegex =
    type === 'anime'
      ? /\b(anime|manga|animated|animation|television|series|film)\b/i
      : type === 'series'
        ? /\b(tv series|television|miniseries|season|episodes?|sitcom|drama series)\b/i
        : /\b(film|movie|directed by|starring|motion picture|cinematography|box office)\b/i;

  const normTitle = normalizeTitleKey(title);

  for (const q of queries) {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      q
    )}&format=json&origin=*&srlimit=6`;

    const searchData = await fetchJsonWithTimeout<WikiSearchResponse>(searchUrl);
    const hits = searchData?.query?.search || [];
    if (hits.length === 0) continue;

    const bestHit =
      hits.find((hit) => {
        const hitTitleLower = hit.title.toLowerCase();
        const hitSnippetClean = stripHtml(hit.snippet || '').toLowerCase();
        const combined = `${hitTitleLower} ${hitSnippetClean}`;
        const mentionsTitle = normalizeTitleKey(hit.title).includes(normTitle);
        const matchesMedia = mediaKeywordRegex.test(combined);
        const matchesYear = !year || combined.includes(String(year));
        return mentionsTitle && matchesMedia && matchesYear;
      }) ||
      hits.find((hit) => {
        const combined = `${hit.title} ${stripHtml(hit.snippet || '')}`;
        return normalizeTitleKey(hit.title).includes(normTitle) && mediaKeywordRegex.test(combined);
      });

    if (!bestHit) continue;

    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      bestHit.title.replace(/ /g, '_')
    )}`;
    const summary = await fetchJsonWithTimeout<WikiSummaryResponse>(summaryUrl);
    if (
      summary &&
      summary.type !== 'disambiguation' &&
      summary.extract &&
      !summary.extract.includes('may refer to:')
    ) {
      return {
        description: summary.extract.trim(),
        posterUrl: cleanPosterUrl(summary.thumbnail?.source || summary.originalimage?.source),
      };
    }
  }

  return {};
}

/**
 * Resolves a fallback poster for a title when an item has no poster or its poster URL fails to load.
 */
export async function findFallbackPoster(input: {
  title: string;
  year?: number;
  type?: MediaType;
  failedUrl?: string;
}): Promise<string> {
  const key = `${normalizeTitleKey(input.title)}:${input.year || ''}:${input.type || 'movie'}`;
  if (verifiedPosterCache.has(key)) {
    const cached = verifiedPosterCache.get(key)!;
    if (cached !== input.failedUrl) return cached;
  }

  const candidateUrls: Array<string | undefined> = [];

  // 1. If Metahub URL failed, extract ttId and try live.metahub.space / small / medium
  if (input.failedUrl) {
    const ttMatch = input.failedUrl.match(/\/(tt\d+)\//);
    if (ttMatch) {
      const id = ttMatch[1];
      candidateUrls.push(
        `https://live.metahub.space/poster/medium/${id}/img`,
        `https://images.metahub.space/poster/small/${id}/img`
      );
    }
  }

  const quickLocal = await pickFirstWorkingPoster(
    candidateUrls.filter((u) => u && u !== input.failedUrl)
  );
  if (quickLocal) {
    verifiedPosterCache.set(key, quickLocal);
    return quickLocal;
  }

  // 2. Search Cinemeta + TVMaze/AniList + Wikipedia
  const mediaType: MediaType = input.type || 'movie';
  const searchCandidates = await searchMedia(
    input.year ? `${input.title} ${input.year}` : input.title,
    mediaType
  );
  const norm = normalizeTitleKey(input.title);
  const matched =
    searchCandidates.find(
      (c) => normalizeTitleKey(c.title) === norm && (!input.year || c.year === input.year)
    ) ||
    searchCandidates.find((c) => normalizeTitleKey(c.title) === norm) ||
    searchCandidates[0];

  const deepUrls: Array<string | undefined> = [];
  if (matched?.id.startsWith('tt')) {
    deepUrls.push(
      `https://images.metahub.space/poster/medium/${matched.id}/img`,
      `https://live.metahub.space/poster/medium/${matched.id}/img`,
      `https://images.metahub.space/poster/small/${matched.id}/img`
    );
  } else if (matched?.posterUrl) {
    deepUrls.push(matched.posterUrl);
  }

  if (mediaType === 'anime') {
    const ani = await searchAniList(input.title);
    if (ani[0]?.posterUrl) deepUrls.push(ani[0].posterUrl);
  }

  if (mediaType === 'series' || mediaType === 'anime') {
    const tv = await searchTvMaze(input.title);
    if (tv[0]?.posterUrl) deepUrls.push(tv[0].posterUrl);
  }

  const firstDeep = await pickFirstWorkingPoster(
    deepUrls.filter((u) => u && u !== input.failedUrl)
  );
  if (firstDeep) {
    verifiedPosterCache.set(key, firstDeep);
    return firstDeep;
  }

  // 3. Wikipedia article poster (film/TV series/anime)
  const wiki = await lookupWikipediaMeta(input.title, mediaType, input.year);
  if (wiki.posterUrl && wiki.posterUrl !== input.failedUrl && (await isImageLoadable(wiki.posterUrl))) {
    verifiedPosterCache.set(key, wiki.posterUrl);
    return wiki.posterUrl;
  }

  return '';
}

/**
 * Resolves full title details (real description, real IMDb/AniList/TVMaze rating,
 * genre, release year, verified poster) directly in the browser with zero API keys or server needed.
 */
export async function lookupMediaDetails(input: {
  title: string;
  year?: number;
  type?: MediaType;
  imdbId?: string;
  posterUrl?: string;
}): Promise<MediaDetails | null> {
  const { title: cleanTitle, year: parsedYear } = splitTitleAndYear(input.title, input.year);
  if (!cleanTitle) return null;

  let resolvedTitle = cleanTitle;
  let resolvedType: MediaType = input.type || 'movie';
  let resolvedYear = parsedYear;
  let description = '';
  let genre = '';
  let rating = 0;
  let progressTotal: number | undefined;
  const posterCandidates: Array<string | undefined> = [input.posterUrl];

  let imdbId = input.imdbId;

  // Apply cached metadata from AniList/TVMaze if present
  if (imdbId && candidateCache.has(imdbId)) {
    const cached = candidateCache.get(imdbId)!;
    resolvedTitle = cached.title || resolvedTitle;
    resolvedType = cached.type || resolvedType;
    if (cached.description) description = cached.description;
    if (cached.genre) genre = cached.genre;
    if (cached.releaseYear && !resolvedYear) resolvedYear = cached.releaseYear;
    if (cached.rating && cached.rating > 0) rating = cached.rating;
    if (cached.posterUrl) posterCandidates.push(cached.posterUrl);
    if (cached.progressTotal) progressTotal = cached.progressTotal;
  }

  // Find IMDb ID via Cinemeta if caller only supplied title/year/type
  if (!imdbId || !imdbId.startsWith('tt')) {
    const candidates = await searchMedia(
      resolvedYear ? `${cleanTitle} ${resolvedYear}` : cleanTitle,
      input.type
    );
    const normClean = normalizeTitleKey(cleanTitle);
    const best =
      candidates.find(
        (c) =>
          normalizeTitleKey(c.title) === normClean &&
          (!resolvedYear || c.year === resolvedYear)
      ) ||
      candidates.find((c) => normalizeTitleKey(c.title) === normClean) ||
      candidates[0];

    if (best) {
      if (best.id.startsWith('tt')) {
        imdbId = best.id;
      } else if (candidateCache.has(best.id)) {
        const cached = candidateCache.get(best.id)!;
        resolvedTitle = cached.title || resolvedTitle;
        resolvedType = input.type || cached.type || resolvedType;
        if (cached.description) description = cached.description;
        if (cached.genre) genre = cached.genre;
        if (cached.releaseYear && !resolvedYear) resolvedYear = cached.releaseYear;
        if (cached.rating && cached.rating > 0) rating = cached.rating;
        if (cached.posterUrl) posterCandidates.push(cached.posterUrl);
        if (cached.progressTotal) progressTotal = cached.progressTotal;
      }
      if (!resolvedYear && best.year) resolvedYear = best.year;
      if (best.posterUrl) posterCandidates.push(best.posterUrl);
    }
  }

  // 1. Primary source: Stremio Cinemeta (real IMDb description, real IMDb rating, genres, year, poster)
  if (imdbId && imdbId.startsWith('tt')) {
    posterCandidates.push(
      `https://images.metahub.space/poster/medium/${imdbId}/img`,
      `https://live.metahub.space/poster/medium/${imdbId}/img`,
      `https://images.metahub.space/poster/small/${imdbId}/img`
    );

    const meta = await fetchCinemetaMeta(imdbId, resolvedType);
    if (meta) {
      if (meta.name) resolvedTitle = meta.name;
      if (!input.type && (meta.type === 'movie' || meta.type === 'series')) {
        resolvedType = meta.type;
      }
      if (meta.description && !description) {
        description = String(meta.description).trim();
      }
      const metaGenres = meta.genres?.length ? meta.genres : meta.genre;
      if (Array.isArray(metaGenres) && metaGenres.length > 0 && !genre) {
        genre = metaGenres.join(', ');
      }
      const metaYear = extractYear(meta.year) ?? extractYear(meta.releaseInfo);
      if (metaYear && (!resolvedYear || !parsedYear)) {
        resolvedYear = metaYear;
      }
      const realImdbRating = roundRating(meta.imdbRating);
      if (realImdbRating > 0) {
        rating = realImdbRating;
      }
      if (meta.poster) {
        posterCandidates.push(upgradeCinemetaPoster(meta.poster), meta.poster);
      }
      if (Array.isArray(meta.videos) && meta.videos.length > 0 && resolvedType !== 'movie') {
        progressTotal = meta.videos.length;
      }
    }
  }

  // 2. TVMaze enrichment for series/anime
  if (resolvedType === 'series' || resolvedType === 'anime') {
    let tvShow: TvMazeShow | null = null;
    if (imdbId && imdbId.startsWith('tt')) {
      tvShow = await fetchJsonWithTimeout<TvMazeShow>(
        `https://api.tvmaze.com/lookup/shows?imdb=${encodeURIComponent(imdbId)}`
      );
    }
    if (!tvShow) {
      const list = await fetchJsonWithTimeout<TvMazeSearchItem[]>(
        `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(resolvedTitle)}`
      );
      if (Array.isArray(list) && list.length > 0) {
        tvShow =
          list.find((entry) => {
            const y = extractYear(entry.show?.premiered);
            return resolvedYear && y === resolvedYear;
          })?.show ||
          list[0]?.show ||
          null;
      }
    }
    if (tvShow) {
      if (!description && tvShow.summary) description = stripHtml(tvShow.summary);
      if (rating === 0) {
        const tvRating = roundRating(tvShow.rating?.average);
        if (tvRating > 0) rating = tvRating;
      }
      if (!genre && tvShow.genres?.length) genre = tvShow.genres.join(', ');
      if (!resolvedYear) resolvedYear = extractYear(tvShow.premiered);
      if (tvShow.image?.original || tvShow.image?.medium) {
        posterCandidates.push(tvShow.image.original, tvShow.image.medium);
      }
    }
  }

  // 3. AniList enrichment for anime
  if (resolvedType === 'anime') {
    const aniCandidates = await searchAniList(resolvedTitle);
    const normRes = normalizeTitleKey(resolvedTitle);
    const bestAni =
      aniCandidates.find(
        (c) =>
          normalizeTitleKey(c.title) === normRes &&
          (!resolvedYear || c.year === resolvedYear)
      ) || aniCandidates[0];
    if (bestAni && candidateCache.has(bestAni.id)) {
      const cached = candidateCache.get(bestAni.id)!;
      if (!description && cached.description) description = cached.description;
      if (rating === 0 && cached.rating && cached.rating > 0) rating = cached.rating;
      if (!genre && cached.genre) genre = cached.genre;
      if (cached.posterUrl) posterCandidates.push(cached.posterUrl);
      if (!progressTotal && cached.progressTotal) progressTotal = cached.progressTotal;
    }
  }

  // Verify poster actually loads in browser first
  let posterUrl = await pickFirstWorkingPoster(posterCandidates);

  // 4. Typed + year-scoped Wikipedia lookup if description OR poster is still missing
  if (!description || !posterUrl) {
    const wiki = await lookupWikipediaMeta(resolvedTitle, resolvedType, resolvedYear);
    if (!description && wiki.description) description = wiki.description;
    if (!posterUrl && wiki.posterUrl && (await isImageLoadable(wiki.posterUrl))) {
      posterUrl = wiki.posterUrl;
    }
  }

  return {
    title: resolvedTitle,
    type: resolvedType,
    description: description || 'Saved to your watchlist.',
    genre: genre || (resolvedType === 'anime' ? 'Animation' : 'Uncategorized'),
    releaseYear: resolvedYear || new Date().getFullYear(),
    rating,
    posterUrl,
    ...(progressTotal ? { progressTotal } : {}),
  };
}
