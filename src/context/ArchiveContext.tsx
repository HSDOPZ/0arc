import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  ToolItem,
  NoteItem,
  MediaItem,
  PasswordItem,
  AppSettings,
  NavigationTab,
  MediaStatus,
  ArchiveCategory,
  ArchiveSnapshot,
  ToastMessage,
} from '../types';
import { INITIAL_SETTINGS } from '../data/seedData';
import { normalizePath, pathForTab, tabFromPath, TAB_TITLES } from '../utils/appRoutes';
import {
  clearPasswordStorage,
  exportEncryptedPasswordVaultState,
  getPasswordLockStatus,
  loadUnprotectedPasswords,
  persistPasswords,
  removePasswordMainLock,
  resetPasswordMainLockWithAnswer,
  restoreEncryptedPasswordVaultRawState,
  setupPasswordMainLock,
  unlockPasswordVaultWithPassword,
} from '../utils/passwordVaultCrypto';
import {
  hydrateAndMigrateVaultKeys,
  setVaultItem,
  VAULT_STORAGE_KEYS,
} from '../utils/vaultStorage';
import {
  createEncryptedBackupFile,
  VaultBackupPayload,
} from '../utils/encryptedBackup';
import {
  isTauriEnvironment,
  loadMongoSyncConfig,
  pushVaultToMongo,
  saveMongoSyncConfig,
} from '../utils/mongoSync';

interface ArchiveContextType {
  tools: ToolItem[];
  notes: NoteItem[];
  media: MediaItem[];
  passwords: PasswordItem[];
  passwordCount: number;
  hasPasswordLock: boolean;
  isPasswordVaultUnlocked: boolean;
  passwordRecoveryQuestion: string | null;

  settings: AppSettings;
  activeTab: NavigationTab;
  setActiveTab: (tab: NavigationTab) => void;

  searchModalOpen: boolean;
  openSearchModal: () => void;
  closeSearchModal: () => void;

  quickAddModalOpen: boolean;
  quickAddInitialType: ArchiveCategory | null;
  openQuickAdd: (type?: ArchiveCategory) => void;
  closeQuickAdd: () => void;

  addTool: (tool: Omit<ToolItem, 'id' | 'createdAt' | 'updatedAt'>) => ToolItem;
  updateTool: (id: string, updates: Partial<ToolItem>) => void;
  deleteTool: (id: string) => void;
  toggleToolFavorite: (id: string) => void;

  addNote: (note: Omit<NoteItem, 'id' | 'createdAt' | 'updatedAt'>) => NoteItem;
  updateNote: (id: string, updates: Partial<NoteItem>) => void;
  deleteNote: (id: string) => void;
  duplicateNote: (id: string) => NoteItem;
  toggleNoteFavorite: (id: string) => void;

  addMedia: (media: Omit<MediaItem, 'id' | 'createdAt' | 'updatedAt'>) => MediaItem;
  updateMedia: (id: string, updates: Partial<MediaItem>) => void;
  deleteMedia: (id: string) => void;
  updateMediaProgress: (id: string, current: number, total?: number) => void;
  toggleMediaFavorite: (id: string) => void;

  addPassword: (entry: Omit<PasswordItem, 'id' | 'createdAt' | 'updatedAt'>) => Promise<PasswordItem>;
  updatePassword: (id: string, updates: Partial<PasswordItem>) => Promise<void>;
  deletePassword: (id: string) => Promise<void>;
  unlockPasswordVault: (mainPassword: string) => Promise<void>;
  lockPasswordVault: () => void;
  enablePasswordMainLock: (
    mainPassword: string,
    recoveryQuestion: string,
    recoveryAnswer: string
  ) => Promise<void>;
  resetPasswordMainLock: (recoveryAnswer: string, newMainPassword: string) => Promise<void>;
  disablePasswordMainLock: (currentPassword: string) => Promise<void>;

  updateSettings: (updates: Partial<AppSettings>) => void;

  exportAllJSON: () => void;
  exportCollectionJSON: (category: ArchiveCategory) => void;
  importJSON: (jsonString: string, mode: 'merge' | 'replace') => { success: boolean; message: string };
  buildFullVaultPayload: () => Promise<VaultBackupPayload>;
  exportEncryptedBackup: (passphrase: string) => Promise<void>;
  importVaultPayload: (
    payload: VaultBackupPayload,
    mode: 'merge' | 'replace'
  ) => Promise<{ success: boolean; message: string }>;
  clearAllData: () => void;
  resetToSampleData: () => void;

  toasts: ToastMessage[];
  addToast: (title: string, type?: ToastMessage['type'], message?: string) => void;
  dismissToast: (id: string) => void;
}

const ArchiveContext = createContext<ArchiveContextType | undefined>(undefined);

const STORAGE_PREFIX = '0arc_vault';
const VALID_TABS: NavigationTab[] = [
  'overview',
  'tools',
  'notes',
  'watchlist',
  'passwords',
  'favorites',
  'settings',
];

const generateUUID = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const optimizePosterUrl = (url: string): string => {
  if (!url) return url;
  return url
    .replace('/w92/', '/w342/')
    .replace('/w154/', '/w342/')
    .replace('/w185/', '/w342/')
    .replace('/w342/', '/w342/')
    .replace('/w500/', '/w342/')
    .replace('/w780/', '/w500/');
};

const normalizeMediaStatus = (status?: string): MediaStatus => {
  switch (status) {
    case 'watching':
    case 'reading':
      return 'watching';
    case 'completed':
    case 'watched':
      return 'completed';
    case 'on_hold':
      return 'on_hold';
    case 'dropped':
      return 'dropped';
    default:
      return 'want_to_watch';
  }
};

const normalizeMediaItems = (items: unknown): MediaItem[] => {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .filter((item) => item.type !== 'manga')
    .map((item) => ({
      id: String(item.id || generateUUID()),
      title: String(item.title || 'Untitled'),
      type: item.type === 'series' || item.type === 'anime' ? item.type : 'movie',
      posterUrl: (() => {
        const poster =
          typeof item.posterUrl === 'string'
            ? item.posterUrl
            : typeof item.poster_url === 'string'
              ? item.poster_url
              : '';
        return poster ? optimizePosterUrl(poster) : undefined;
      })(),
      description: String(item.description || ''),
      genre: String(item.genre || ''),
      releaseYear: Number(item.releaseYear || item.release_year) || new Date().getFullYear(),
      rating: Number(item.rating) || 0,
      status: normalizeMediaStatus(typeof item.status === 'string' ? item.status : undefined),
      notes: typeof item.notes === 'string' ? item.notes : undefined,
      progressCurrent: Number(item.progressCurrent ?? item.progress_current ?? 0),
      progressTotal: Number(item.progressTotal ?? item.progress_total ?? 0),
      isFavorite: Boolean(item.isFavorite ?? item.is_favorite),
      createdAt: String(item.createdAt || item.created_at || new Date().toISOString()),
      updatedAt: String(item.updatedAt || item.updated_at || new Date().toISOString()),
    }));
};

const normalizePasswordItems = (items: unknown): PasswordItem[] => {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .filter((item) => typeof item.name === 'string' && typeof item.link === 'string' && typeof item.password === 'string')
    .map((item) => ({
      id: String(item.id || generateUUID()),
      name: String(item.name).trim(),
      link: String(item.link).trim(),
      username: typeof item.username === 'string' && item.username.trim() ? item.username.trim() : undefined,
      password: String(item.password),
      createdAt: String(item.createdAt || new Date().toISOString()),
      updatedAt: String(item.updatedAt || new Date().toISOString()),
    }));
};

const normalizeSettings = (raw: unknown): AppSettings => {
  if (!raw || typeof raw !== 'object') return INITIAL_SETTINGS;
  const parsed = { ...INITIAL_SETTINGS, ...(raw as Partial<AppSettings>) };
  if (!VALID_TABS.includes(parsed.defaultArchiveView)) {
    parsed.defaultArchiveView = 'overview';
  }
  return parsed;
};

export const ArchiveProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tools, setTools] = useState<ToolItem[]>(() => {
    try {
      const stored = localStorage.getItem(`${STORAGE_PREFIX}_tools`);
      return stored ? (JSON.parse(stored) as ToolItem[]) : [];
    } catch {
      return [];
    }
  });

  const [notes, setNotes] = useState<NoteItem[]>(() => {
    try {
      const stored = localStorage.getItem(`${STORAGE_PREFIX}_notes`);
      return stored ? (JSON.parse(stored) as NoteItem[]) : [];
    } catch {
      return [];
    }
  });

  const [media, setMedia] = useState<MediaItem[]>(() => {
    try {
      const stored = localStorage.getItem(`${STORAGE_PREFIX}_media`);
      return stored ? normalizeMediaItems(JSON.parse(stored)) : [];
    } catch {
      return [];
    }
  });

  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const stored = localStorage.getItem(`${STORAGE_PREFIX}_settings`);
      return stored ? normalizeSettings(JSON.parse(stored)) : INITIAL_SETTINGS;
    } catch {
      return INITIAL_SETTINGS;
    }
  });

  // Encrypted local password vault state
  const [passwords, setPasswords] = useState<PasswordItem[]>([]);
  const [passwordCount, setPasswordCount] = useState<number>(0);
  const [hasPasswordLock, setHasPasswordLock] = useState<boolean>(false);
  const [isPasswordVaultUnlocked, setIsPasswordVaultUnlocked] = useState<boolean>(true);
  const [passwordRecoveryQuestion, setPasswordRecoveryQuestion] = useState<string | null>(null);
  const activeDekRef = useRef<CryptoKey | null>(null);

  const [isStorageHydrated, setIsStorageHydrated] = useState(false);
  const userMutatedBeforeHydrationRef = useRef(false);
  const userNavigatedRef = useRef(false);

  // Hydrate and migrate from legacy localStorage -> IndexedDB on mount
  useEffect(() => {
    let mounted = true;

    async function hydrate() {
      try {
        const loaded = await hydrateAndMigrateVaultKeys(VAULT_STORAGE_KEYS);
        if (!mounted) return;

        if (!userMutatedBeforeHydrationRef.current) {
          const rawTools = loaded[`${STORAGE_PREFIX}_tools`];
          if (rawTools) {
            try {
              const parsed = JSON.parse(rawTools);
              if (Array.isArray(parsed)) setTools(parsed as ToolItem[]);
            } catch {
              // ignore malformed stored tools
            }
          }

          const rawNotes = loaded[`${STORAGE_PREFIX}_notes`];
          if (rawNotes) {
            try {
              const parsed = JSON.parse(rawNotes);
              if (Array.isArray(parsed)) setNotes(parsed as NoteItem[]);
            } catch {
              // ignore malformed stored notes
            }
          }

          const rawMedia = loaded[`${STORAGE_PREFIX}_media`];
          if (rawMedia) {
            try {
              setMedia(normalizeMediaItems(JSON.parse(rawMedia)));
            } catch {
              // ignore malformed stored media
            }
          }

          const rawSettings = loaded[`${STORAGE_PREFIX}_settings`];
          if (rawSettings) {
            try {
              const hydratedSettings = normalizeSettings(JSON.parse(rawSettings));
              setSettings(hydratedSettings);
              if (
                !userNavigatedRef.current &&
                typeof window !== 'undefined' &&
                normalizePath(window.location.pathname) === '/' &&
                hydratedSettings.defaultArchiveView &&
                hydratedSettings.defaultArchiveView !== 'settings' &&
                hydratedSettings.defaultArchiveView !== 'overview'
              ) {
                setActiveTabState(hydratedSettings.defaultArchiveView);
                if (!isTauriEnvironment()) {
                  window.history.replaceState(
                    { tab: hydratedSettings.defaultArchiveView },
                    '',
                    pathForTab(hydratedSettings.defaultArchiveView)
                  );
                }
              }
            } catch {
              // ignore malformed stored settings
            }
          }
        }

        const status = await getPasswordLockStatus();
        if (!mounted) return;

        setHasPasswordLock(status.hasLock);
        setPasswordRecoveryQuestion(status.recoveryQuestion);
        setPasswordCount(status.storedCount);

        if (!status.hasLock) {
          const { entries, dek } = await loadUnprotectedPasswords().catch(() => ({
            entries: [] as PasswordItem[],
            dek: null as CryptoKey | null,
          }));
          if (!mounted) return;
          activeDekRef.current = dek;
          setPasswords(entries);
          setPasswordCount(entries.length);
          setIsPasswordVaultUnlocked(true);
        } else {
          setPasswords([]);
          setIsPasswordVaultUnlocked(false);
        }
      } finally {
        if (mounted) {
          setIsStorageHydrated(true);
        }
      }
    }

    void hydrate();

    return () => {
      mounted = false;
    };
  }, []);

  const [activeTab, setActiveTabState] = useState<NavigationTab>(() => {
    if (typeof window !== 'undefined') {
      const routedTab = tabFromPath(window.location.pathname);
      if (routedTab) return routedTab;
    }
    const fallback = settings.defaultArchiveView;
    return fallback && fallback !== 'settings' ? fallback : 'overview';
  });
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [quickAddModalOpen, setQuickAddModalOpen] = useState(false);
  const [quickAddInitialType, setQuickAddInitialType] = useState<ArchiveCategory | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const setActiveTab = useCallback((tab: NavigationTab) => {
    userNavigatedRef.current = true;
    setActiveTabState(tab);
    if (typeof window === 'undefined' || isTauriEnvironment()) return;
    const path = pathForTab(tab);
    if (normalizePath(window.location.pathname) !== path) {
      window.history.pushState({ tab }, '', path);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || isTauriEnvironment()) return;
    const path = pathForTab(activeTab);
    if (normalizePath(window.location.pathname) !== path) {
      window.history.replaceState({ tab: activeTab }, '', path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || isTauriEnvironment()) return;
    const handlePopState = () => {
      const routedTab = tabFromPath(window.location.pathname);
      if (routedTab) {
        setActiveTabState(routedTab);
      } else {
        window.history.replaceState({ tab: 'overview' }, '', '/');
        setActiveTabState('overview');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    document.title =
      activeTab === 'overview' ? '0arc — Personal Digital Archive' : `${TAB_TITLES[activeTab]} — 0arc`;
  }, [activeTab]);

  const addToast = useCallback(
    (title: string, type: ToastMessage['type'] = 'info', message?: string) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const newToast: ToastMessage = { id, title, type, message };
      setToasts((prev) => [...prev, newToast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3500);
    },
    []
  );

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Persist archive sections to unified IndexedDB vault storage once hydrated
  useEffect(() => {
    if (!isStorageHydrated) return;
    void Promise.all([
      setVaultItem(`${STORAGE_PREFIX}_tools`, JSON.stringify(tools)),
      setVaultItem(`${STORAGE_PREFIX}_notes`, JSON.stringify(notes)),
      setVaultItem(`${STORAGE_PREFIX}_media`, JSON.stringify(media)),
      setVaultItem(`${STORAGE_PREFIX}_settings`, JSON.stringify(settings)),
    ]).catch(() => {
      // Gracefully handled inside vaultStorage fallback
    });
  }, [tools, notes, media, settings, isStorageHydrated]);

  // Debounced Auto-Sync to MongoDB when enabled by the user
  const autoSyncBaselineReadyRef = useRef(false);
  const autoSyncErrorShownRef = useRef(false);
  const latestPayloadBuilderRef = useRef<(() => Promise<VaultBackupPayload>) | null>(null);

  useEffect(() => {
    latestPayloadBuilderRef.current = async () => {
      const passwordVault = await exportEncryptedPasswordVaultState();
      const includePlainPasswords = !hasPasswordLock || isPasswordVaultUnlocked;
      return {
        version: '2.0.0',
        exportedAt: new Date().toISOString(),
        tools,
        notes,
        media,
        settings,
        ...(includePlainPasswords ? { passwords } : {}),
        passwordVault,
      };
    };
  }, [tools, notes, media, settings, passwords, hasPasswordLock, isPasswordVaultUnlocked]);

  useEffect(() => {
    if (!isStorageHydrated) return;
    if (!autoSyncBaselineReadyRef.current) {
      autoSyncBaselineReadyRef.current = true;
      return;
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const config = await loadMongoSyncConfig();
          if (!config.autoSync || !config.connected || !config.mongoUri.trim()) return;
          const builder = latestPayloadBuilderRef.current;
          if (!builder) return;
          const payload = await builder();
          const { updatedAt } = await pushVaultToMongo(config, payload);
          await saveMongoSyncConfig({
            ...config,
            connected: true,
            lastSyncedAt: updatedAt,
          });
          autoSyncErrorShownRef.current = false;
        } catch (err: unknown) {
          if (!autoSyncErrorShownRef.current) {
            autoSyncErrorShownRef.current = true;
            addToast(
              'Auto-Sync Paused',
              'warning',
              err instanceof Error ? err.message : 'Could not reach MongoDB sync server.'
            );
          }
        }
      })();
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [tools, notes, media, passwords, settings, isStorageHydrated, addToast]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchModalOpen((prev) => !prev);
        return;
      }

      if (isInput) return;

      if (e.key === 'c' || e.key === 'C') {
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          setQuickAddInitialType(null);
          setQuickAddModalOpen(true);
        }
      } else if (e.key === '1') {
        setActiveTab('overview');
      } else if (e.key === '2') {
        setActiveTab('tools');
      } else if (e.key === '3') {
        setActiveTab('notes');
      } else if (e.key === '4') {
        setActiveTab('watchlist');
      } else if (e.key === '5') {
        setActiveTab('passwords');
      } else if (e.key === '6') {
        setActiveTab('favorites');
      } else if (e.key === '7') {
        setActiveTab('settings');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setActiveTab]);

  const openSearchModal = () => setSearchModalOpen(true);
  const closeSearchModal = () => setSearchModalOpen(false);

  const openQuickAdd = (type?: ArchiveCategory) => {
    setQuickAddInitialType(type || null);
    setQuickAddModalOpen(true);
  };
  const closeQuickAdd = () => {
    setQuickAddModalOpen(false);
    setQuickAddInitialType(null);
  };

  // ---------- TOOLS CRUD ----------

  const addTool = (toolData: Omit<ToolItem, 'id' | 'createdAt' | 'updatedAt'>): ToolItem => {
    userMutatedBeforeHydrationRef.current = true;
    const now = new Date().toISOString();
    const newTool: ToolItem = {
      ...toolData,
      id: generateUUID(),
      createdAt: now,
      updatedAt: now,
    };
    setTools((prev) => [newTool, ...prev]);
    addToast('Tool Saved', 'success', `"${newTool.title}" saved.`);
    return newTool;
  };

  const updateTool = (id: string, updates: Partial<ToolItem>) => {
    userMutatedBeforeHydrationRef.current = true;
    setTools((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, ...updates, updatedAt: new Date().toISOString() } : item
      )
    );
    addToast('Tool Updated', 'info');
  };

  const deleteTool = (id: string) => {
    userMutatedBeforeHydrationRef.current = true;
    const item = tools.find((t) => t.id === id);
    setTools((prev) => prev.filter((t) => t.id !== id));
    addToast('Tool Removed', 'info', item ? `"${item.title}" removed.` : undefined);
  };

  const toggleToolFavorite = (id: string) => {
    userMutatedBeforeHydrationRef.current = true;
    setTools((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, isFavorite: !item.isFavorite, updatedAt: new Date().toISOString() }
          : item
      )
    );
  };

  // ---------- NOTES CRUD ----------

  const addNote = (noteData: Omit<NoteItem, 'id' | 'createdAt' | 'updatedAt'>): NoteItem => {
    userMutatedBeforeHydrationRef.current = true;
    const now = new Date().toISOString();
    const newNote: NoteItem = {
      ...noteData,
      id: generateUUID(),
      createdAt: now,
      updatedAt: now,
    };
    setNotes((prev) => [newNote, ...prev]);
    addToast('Note Created', 'success', `"${newNote.title || 'Untitled Note'}" saved.`);
    return newNote;
  };

  const updateNote = (id: string, updates: Partial<NoteItem>) => {
    userMutatedBeforeHydrationRef.current = true;
    setNotes((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, ...updates, updatedAt: new Date().toISOString() } : item
      )
    );
  };

  const deleteNote = (id: string) => {
    userMutatedBeforeHydrationRef.current = true;
    const item = notes.find((n) => n.id === id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
    addToast('Note Deleted', 'info', item ? `"${item.title || 'Untitled Note'}" deleted.` : undefined);
  };

  const duplicateNote = (id: string): NoteItem => {
    userMutatedBeforeHydrationRef.current = true;
    const target = notes.find((n) => n.id === id);
    if (!target) throw new Error('Note not found');
    const now = new Date().toISOString();
    const duplicated: NoteItem = {
      ...target,
      id: generateUUID(),
      title: `${target.title} (Copy)`,
      createdAt: now,
      updatedAt: now,
    };
    setNotes((prev) => [duplicated, ...prev]);
    addToast('Note Duplicated', 'success', `Created copy of "${target.title}".`);
    return duplicated;
  };

  const toggleNoteFavorite = (id: string) => {
    userMutatedBeforeHydrationRef.current = true;
    setNotes((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, isFavorite: !item.isFavorite, updatedAt: new Date().toISOString() }
          : item
      )
    );
  };

  // ---------- WATCHLIST CRUD ----------

  const addMedia = (mediaData: Omit<MediaItem, 'id' | 'createdAt' | 'updatedAt'>): MediaItem => {
    userMutatedBeforeHydrationRef.current = true;
    const now = new Date().toISOString();
    const newMedia: MediaItem = {
      ...mediaData,
      id: generateUUID(),
      createdAt: now,
      updatedAt: now,
    };
    setMedia((prev) => [newMedia, ...prev]);
    addToast('Added to Watchlist', 'success', `"${newMedia.title}" saved.`);
    return newMedia;
  };

  const updateMedia = (id: string, updates: Partial<MediaItem>) => {
    userMutatedBeforeHydrationRef.current = true;
    setMedia((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, ...updates, updatedAt: new Date().toISOString() } : item
      )
    );
    addToast('Watchlist Updated', 'info');
  };

  const deleteMedia = (id: string) => {
    userMutatedBeforeHydrationRef.current = true;
    const item = media.find((m) => m.id === id);
    setMedia((prev) => prev.filter((m) => m.id !== id));
    addToast('Item Removed', 'info', item ? `"${item.title}" removed.` : undefined);
  };

  const updateMediaProgress = (id: string, current: number, total?: number) => {
    userMutatedBeforeHydrationRef.current = true;
    setMedia((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const newCurrent = Math.max(0, current);
          const newTotal = total !== undefined ? total : item.progressTotal;
          let newStatus = item.status;
          if (newTotal && newCurrent >= newTotal && newStatus === 'watching') {
            newStatus = 'completed';
          }
          return {
            ...item,
            progressCurrent: newCurrent,
            progressTotal: newTotal,
            status: newStatus,
            updatedAt: new Date().toISOString(),
          };
        }
        return item;
      })
    );
  };

  const toggleMediaFavorite = (id: string) => {
    userMutatedBeforeHydrationRef.current = true;
    setMedia((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, isFavorite: !item.isFavorite, updatedAt: new Date().toISOString() }
          : item
      )
    );
  };

  // ---------- PASSWORDS CRUD & ENCRYPTED LOCK ----------

  const addPassword = async (
    entry: Omit<PasswordItem, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<PasswordItem> => {
    if (hasPasswordLock && !isPasswordVaultUnlocked) {
      throw new Error('Unlock the Passwords section before adding entries.');
    }
    const now = new Date().toISOString();
    const created: PasswordItem = {
      id: generateUUID(),
      name: entry.name.trim(),
      link: entry.link.trim(),
      username: entry.username?.trim() || undefined,
      password: entry.password,
      createdAt: now,
      updatedAt: now,
    };
    const next = [created, ...passwords];
    await persistPasswords(next, activeDekRef.current);
    setPasswords(next);
    setPasswordCount(next.length);
    addToast('Password Saved', 'success', `Encrypted "${created.name}" in local storage.`);
    return created;
  };

  const updatePassword = async (id: string, updates: Partial<PasswordItem>) => {
    if (hasPasswordLock && !isPasswordVaultUnlocked) {
      throw new Error('Unlock the Passwords section before editing entries.');
    }
    const next = passwords.map((item) =>
      item.id === id
        ? {
            ...item,
            ...updates,
            name: updates.name !== undefined ? updates.name.trim() : item.name,
            link: updates.link !== undefined ? updates.link.trim() : item.link,
            username:
              updates.username !== undefined
                ? updates.username.trim() || undefined
                : item.username,
            updatedAt: new Date().toISOString(),
          }
        : item
    );
    await persistPasswords(next, activeDekRef.current);
    setPasswords(next);
    addToast('Password Updated', 'info');
  };

  const deletePassword = async (id: string) => {
    if (hasPasswordLock && !isPasswordVaultUnlocked) {
      throw new Error('Unlock the Passwords section before deleting entries.');
    }
    const target = passwords.find((p) => p.id === id);
    const next = passwords.filter((p) => p.id !== id);
    await persistPasswords(next, activeDekRef.current);
    setPasswords(next);
    setPasswordCount(next.length);
    addToast('Password Deleted', 'info', target ? `"${target.name}" removed.` : undefined);
  };

  const unlockPasswordVault = async (mainPassword: string) => {
    const { dek, entries } = await unlockPasswordVaultWithPassword(mainPassword);
    activeDekRef.current = dek;
    setPasswords(entries);
    setPasswordCount(entries.length);
    setIsPasswordVaultUnlocked(true);
    addToast('Passwords Unlocked', 'success');
  };

  const lockPasswordVault = () => {
    if (!hasPasswordLock) return;
    activeDekRef.current = null;
    setPasswords([]);
    setIsPasswordVaultUnlocked(false);
    addToast('Passwords Locked', 'info');
  };

  const enablePasswordMainLock = async (
    mainPassword: string,
    recoveryQuestion: string,
    recoveryAnswer: string
  ) => {
    const { dek } = await setupPasswordMainLock(
      mainPassword,
      recoveryQuestion,
      recoveryAnswer,
      passwords
    );
    activeDekRef.current = dek;
    setHasPasswordLock(true);
    setPasswordRecoveryQuestion(recoveryQuestion);
    setIsPasswordVaultUnlocked(true);
    addToast('Main Lock Activated', 'success', 'Passwords vault encrypted with PBKDF2 + AES-256-GCM.');
  };

  const resetPasswordMainLock = async (recoveryAnswer: string, newMainPassword: string) => {
    const { dek, entries, nextQuestion } = await resetPasswordMainLockWithAnswer(
      recoveryAnswer,
      newMainPassword
    );
    activeDekRef.current = dek;
    setPasswords(entries);
    setPasswordCount(entries.length);
    setHasPasswordLock(true);
    setPasswordRecoveryQuestion(nextQuestion);
    setIsPasswordVaultUnlocked(true);
    addToast('Main Lock Reset', 'success', 'New main lock password saved and vault unlocked.');
  };

  const disablePasswordMainLock = async (currentPassword: string) => {
    const { dek, entries } = await removePasswordMainLock(currentPassword);
    activeDekRef.current = dek;
    setPasswords(entries);
    setPasswordCount(entries.length);
    setHasPasswordLock(false);
    setPasswordRecoveryQuestion(null);
    setIsPasswordVaultUnlocked(true);
    addToast('Main Lock Removed', 'info', 'Optional main lock has been turned off.');
  };

  const updateSettings = (updates: Partial<AppSettings>) => {
    userMutatedBeforeHydrationRef.current = true;
    setSettings((prev) => ({ ...prev, ...updates }));
    addToast('Preferences Saved', 'success');
  };

  // ---------- BACKUPS, ENCRYPTED .0ARC & DEVICE SYNC ----------

  const buildFullVaultPayload = async (): Promise<VaultBackupPayload> => {
    const passwordVault = await exportEncryptedPasswordVaultState();
    const includePlainPasswords = !hasPasswordLock || isPasswordVaultUnlocked;
    return {
      version: '2.0.0',
      exportedAt: new Date().toISOString(),
      tools,
      notes,
      media,
      settings,
      ...(includePlainPasswords ? { passwords } : {}),
      passwordVault,
    };
  };

  const exportEncryptedBackup = async (passphrase: string) => {
    const payload = await buildFullVaultPayload();
    const encryptedText = await createEncryptedBackupFile(payload, passphrase);
    const blob = new Blob([encryptedText], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `0arc-vault-${dateStr}.0arc`;
    a.click();
    URL.revokeObjectURL(url);
    addToast(
      'Encrypted Backup Saved',
      'success',
      'All archive sections and encrypted passwords saved to .0arc file.'
    );
  };

  const importVaultPayload = async (
    payload: VaultBackupPayload,
    mode: 'merge' | 'replace'
  ): Promise<{ success: boolean; message: string }> => {
    userMutatedBeforeHydrationRef.current = true;

    const importedTools = Array.isArray(payload.tools) ? payload.tools : [];
    const importedNotes = Array.isArray(payload.notes) ? payload.notes : [];
    const importedMedia = normalizeMediaItems(payload.media);
    const importedPasswords = normalizePasswordItems(payload.passwords);

    if (mode === 'replace') {
      setTools(importedTools);
      setNotes(importedNotes);
      setMedia(importedMedia);
      if (payload.settings) {
        setSettings(normalizeSettings(payload.settings));
      }

      if (payload.passwordVault) {
        await restoreEncryptedPasswordVaultRawState(payload.passwordVault);
        const status = await getPasswordLockStatus();
        setHasPasswordLock(status.hasLock);
        setPasswordRecoveryQuestion(status.recoveryQuestion);
        setPasswordCount(status.storedCount);

        if (!status.hasLock) {
          const { entries, dek } = await loadUnprotectedPasswords();
          activeDekRef.current = dek;
          setPasswords(entries);
          setPasswordCount(entries.length);
          setIsPasswordVaultUnlocked(true);
        } else {
          activeDekRef.current = null;
          setPasswords([]);
          setIsPasswordVaultUnlocked(false);
        }
      } else if (importedPasswords.length > 0) {
        await clearPasswordStorage();
        setHasPasswordLock(false);
        setPasswordRecoveryQuestion(null);
        const { dek } = await loadUnprotectedPasswords();
        activeDekRef.current = dek;
        await persistPasswords(importedPasswords, dek);
        setPasswords(importedPasswords);
        setPasswordCount(importedPasswords.length);
        setIsPasswordVaultUnlocked(true);
      } else {
        await clearPasswordStorage();
        setHasPasswordLock(false);
        setPasswordRecoveryQuestion(null);
        const { dek } = await loadUnprotectedPasswords();
        activeDekRef.current = dek;
        setPasswords([]);
        setPasswordCount(0);
        setIsPasswordVaultUnlocked(true);
      }

      const restoredPwCount = payload.passwordVault?.cipherRaw
        ? (await getPasswordLockStatus()).storedCount
        : importedPasswords.length;
      const total = importedTools.length + importedNotes.length + importedMedia.length + restoredPwCount;
      const msg = `Restored ${total} items (including Passwords & Main Lock).`;
      addToast('Vault Restored', 'success', msg);
      return { success: true, message: msg };
    }

    // Merge mode
    if (importedTools.length) {
      setTools((prev) => {
        const existingIds = new Set(prev.map((t) => t.id));
        const fresh = importedTools.filter((t) => !existingIds.has(t.id));
        return [...fresh, ...prev];
      });
    }
    if (importedNotes.length) {
      setNotes((prev) => {
        const existingIds = new Set(prev.map((n) => n.id));
        const fresh = importedNotes.filter((n) => !existingIds.has(n.id));
        return [...fresh, ...prev];
      });
    }
    if (importedMedia.length) {
      setMedia((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const fresh = importedMedia.filter((m) => !existingIds.has(m.id));
        return [...fresh, ...prev];
      });
    }

    let mergedPwCount = 0;
    if (importedPasswords.length && (!hasPasswordLock || isPasswordVaultUnlocked)) {
      const existingIds = new Set(passwords.map((p) => p.id));
      const fresh = importedPasswords.filter((p) => !existingIds.has(p.id));
      const next = [...fresh, ...passwords];
      await persistPasswords(next, activeDekRef.current);
      setPasswords(next);
      setPasswordCount(next.length);
      mergedPwCount = fresh.length;
    } else if (
      payload.passwordVault &&
      (payload.passwordVault.cipherRaw || payload.passwordVault.lockRaw) &&
      passwordCount === 0 &&
      !hasPasswordLock
    ) {
      // Adopt locked/encrypted password vault cleanly when current device has no passwords yet
      await restoreEncryptedPasswordVaultRawState(payload.passwordVault);
      const status = await getPasswordLockStatus();
      setHasPasswordLock(status.hasLock);
      setPasswordRecoveryQuestion(status.recoveryQuestion);
      setPasswordCount(status.storedCount);
      mergedPwCount = status.storedCount;

      if (!status.hasLock) {
        const { entries, dek } = await loadUnprotectedPasswords();
        activeDekRef.current = dek;
        setPasswords(entries);
        setPasswordCount(entries.length);
        setIsPasswordVaultUnlocked(true);
      } else {
        activeDekRef.current = null;
        setPasswords([]);
        setIsPasswordVaultUnlocked(false);
      }
    }

    const total = importedTools.length + importedNotes.length + importedMedia.length + mergedPwCount;
    const msg = `Merged ${total} items into your local vault.`;
    addToast('Vault Merged', 'success', msg);
    return { success: true, message: msg };
  };

  const exportAllJSON = () => {
    const includePasswords = !hasPasswordLock || isPasswordVaultUnlocked;
    const snapshot: ArchiveSnapshot = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      tools,
      notes,
      media,
      ...(includePasswords ? { passwords } : {}),
      settings,
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `0arc-backup-${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addToast(
      'Export Complete',
      'success',
      includePasswords
        ? 'All local vault data downloaded.'
        : 'Tools, notes, and watchlist exported (use .0arc backup to include locked passwords).'
    );
  };

  const exportCollectionJSON = (category: ArchiveCategory) => {
    if (category === 'passwords' && hasPasswordLock && !isPasswordVaultUnlocked) {
      addToast('Passwords Locked', 'warning', 'Unlock the Passwords section before exporting.');
      return;
    }

    let data: unknown = [];
    if (category === 'tools') data = tools;
    if (category === 'notes') data = notes;
    if (category === 'watchlist') data = media;
    if (category === 'passwords') data = passwords;

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `0arc-${category}-${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addToast(`${category.charAt(0).toUpperCase() + category.slice(1)} Exported`, 'success');
  };

  const importJSON = (jsonString: string, mode: 'merge' | 'replace') => {
    userMutatedBeforeHydrationRef.current = true;
    try {
      const parsed = JSON.parse(jsonString);
      let importedTools: ToolItem[] = [];
      let importedNotes: NoteItem[] = [];
      let importedMedia: MediaItem[] = [];
      let importedPasswords: PasswordItem[] = [];

      if (parsed.version && (parsed.tools || parsed.notes || parsed.media || parsed.passwords)) {
        importedTools = Array.isArray(parsed.tools) ? parsed.tools : [];
        importedNotes = Array.isArray(parsed.notes) ? parsed.notes : [];
        importedMedia = normalizeMediaItems(parsed.media);
        importedPasswords = normalizePasswordItems(parsed.passwords);
      } else if (Array.isArray(parsed)) {
        const sample = parsed[0];
        if (!sample) return { success: false, message: 'JSON array is empty.' };
        if ('password' in sample && 'link' in sample && 'name' in sample) {
          importedPasswords = normalizePasswordItems(parsed);
        } else if ('category' in sample && 'url' in sample) {
          importedTools = parsed as ToolItem[];
        } else if ('content' in sample) {
          importedNotes = parsed as NoteItem[];
        } else if ('type' in sample && 'genre' in sample) {
          importedMedia = normalizeMediaItems(parsed);
        } else {
          return { success: false, message: 'Unrecognized archive data structure.' };
        }
      } else {
        return { success: false, message: 'Invalid 0arc JSON archive format.' };
      }

      if (mode === 'replace') {
        if (importedTools.length) setTools(importedTools);
        if (importedNotes.length) setNotes(importedNotes);
        if (importedMedia.length) setMedia(importedMedia);
        if (importedPasswords.length && (!hasPasswordLock || isPasswordVaultUnlocked)) {
          setPasswords(importedPasswords);
          setPasswordCount(importedPasswords.length);
          void persistPasswords(importedPasswords, activeDekRef.current);
        }
      } else {
        if (importedTools.length) {
          setTools((prev) => {
            const existingIds = new Set(prev.map((t) => t.id));
            const fresh = importedTools.filter((t) => !existingIds.has(t.id));
            return [...fresh, ...prev];
          });
        }
        if (importedNotes.length) {
          setNotes((prev) => {
            const existingIds = new Set(prev.map((n) => n.id));
            const fresh = importedNotes.filter((n) => !existingIds.has(n.id));
            return [...fresh, ...prev];
          });
        }
        if (importedMedia.length) {
          setMedia((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const fresh = importedMedia.filter((m) => !existingIds.has(m.id));
            return [...fresh, ...prev];
          });
        }
        if (importedPasswords.length && (!hasPasswordLock || isPasswordVaultUnlocked)) {
          const existingIds = new Set(passwords.map((p) => p.id));
          const fresh = importedPasswords.filter((p) => !existingIds.has(p.id));
          const next = [...fresh, ...passwords];
          setPasswords(next);
          setPasswordCount(next.length);
          void persistPasswords(next, activeDekRef.current);
        }
      }

      const count =
        importedTools.length +
        importedNotes.length +
        importedMedia.length +
        (!hasPasswordLock || isPasswordVaultUnlocked ? importedPasswords.length : 0);
      addToast('Import Successful', 'success', `Imported ${count} items.`);
      return { success: true, message: `Successfully imported ${count} items.` };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Invalid JSON file format';
      addToast('Import Failed', 'error', errMsg);
      return { success: false, message: errMsg };
    }
  };

  const clearAllData = () => {
    userMutatedBeforeHydrationRef.current = true;
    setTools([]);
    setNotes([]);
    setMedia([]);
    setPasswords([]);
    setPasswordCount(0);
    activeDekRef.current = null;
    setHasPasswordLock(false);
    setPasswordRecoveryQuestion(null);
    setIsPasswordVaultUnlocked(true);
    void clearPasswordStorage().then(() =>
      loadUnprotectedPasswords().then(({ dek }) => {
        activeDekRef.current = dek;
      })
    );
    addToast('Vault Cleared', 'warning', 'All local archive entries have been erased.');
  };

  const resetToSampleData = () => {
    userMutatedBeforeHydrationRef.current = true;
    setSettings(INITIAL_SETTINGS);
    addToast('Preferences Reset', 'info', 'Vault preferences restored to defaults.');
  };

  return (
    <ArchiveContext.Provider
      value={{
        tools,
        notes,
        media,
        passwords,
        passwordCount,
        hasPasswordLock,
        isPasswordVaultUnlocked,
        passwordRecoveryQuestion,
        settings,
        activeTab,
        setActiveTab,
        searchModalOpen,
        openSearchModal,
        closeSearchModal,
        quickAddModalOpen,
        quickAddInitialType,
        openQuickAdd,
        closeQuickAdd,
        addTool,
        updateTool,
        deleteTool,
        toggleToolFavorite,
        addNote,
        updateNote,
        deleteNote,
        duplicateNote,
        toggleNoteFavorite,
        addMedia,
        updateMedia,
        deleteMedia,
        updateMediaProgress,
        toggleMediaFavorite,
        addPassword,
        updatePassword,
        deletePassword,
        unlockPasswordVault,
        lockPasswordVault,
        enablePasswordMainLock,
        resetPasswordMainLock,
        disablePasswordMainLock,
        updateSettings,
        exportAllJSON,
        exportCollectionJSON,
        importJSON,
        buildFullVaultPayload,
        exportEncryptedBackup,
        importVaultPayload,
        clearAllData,
        resetToSampleData,
        toasts,
        addToast,
        dismissToast,
      }}
    >
      {children}
    </ArchiveContext.Provider>
  );
};

export const useArchive = () => {
  const context = useContext(ArchiveContext);
  if (!context) {
    throw new Error('useArchive must be used within an ArchiveProvider');
  }
  return context;
};
