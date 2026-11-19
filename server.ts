/**
 * 0arc Local Development, Static & MongoDB Sync Server
 * Serves the Vite frontend in development / static dist bundle in production,
 * and provides /api/sync/* endpoints to connect web & Tauri apps to MongoDB.
 */
import express, { type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '25mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');

  // Allow Tauri desktop/mobile WebViews (tauri://localhost, http://tauri.localhost) to call /api/sync/*
  if (req.path.startsWith('/api/sync')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
  }
  next();
});

interface SyncRequestBody {
  mongoUri?: string;
  dbName?: string;
  collectionName?: string;
  vaultId?: string;
  document?: Record<string, unknown>;
}

interface StoredVaultDoc {
  _id: string;
  encrypted?: boolean;
  packet?: string;
  payload?: Record<string, unknown>;
  updatedAt?: string;
  counts?: {
    tools?: number;
    notes?: number;
    media?: number;
    passwords?: number;
  };
}

function resolveSyncParams(body: SyncRequestBody) {
  const rawUri = (body.mongoUri || process.env.MONGODB_URI || '').trim();
  if (!rawUri) {
    throw new Error('MongoDB connection URI is required.');
  }
  if (!rawUri.startsWith('mongodb://') && !rawUri.startsWith('mongodb+srv://')) {
    throw new Error('MongoDB URI must start with mongodb:// or mongodb+srv://');
  }

  const dbName = (body.dbName || 'zeroarc').trim().replace(/[^a-zA-Z0-9_-]/g, '') || 'zeroarc';
  const collectionName =
    (body.collectionName || 'vaults').trim().replace(/[^a-zA-Z0-9_.-]/g, '') || 'vaults';
  const vaultId = (body.vaultId || '').trim();
  if (!vaultId) {
    throw new Error('Vault ID is required.');
  }

  return { mongoUri: rawUri, dbName, collectionName, vaultId };
}

async function withMongoCollection<T>(
  mongoUri: string,
  dbName: string,
  collectionName: string,
  fn: (collection: ReturnType<ReturnType<MongoClient['db']>['collection']>, client: MongoClient) => Promise<T>
): Promise<T> {
  const client = new MongoClient(mongoUri, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
    socketTimeoutMS: 15000,
  });
  try {
    await client.connect();
    const db = client.db(dbName);
    await db.command({ ping: 1 });
    const collection = db.collection(collectionName);
    return await fn(collection, client);
  } finally {
    await client.close().catch(() => {});
  }
}

app.get('/api/sync/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: '0arc-sync-server',
    hasDefaultMongoUri: Boolean(process.env.MONGODB_URI),
  });
});

app.post('/api/sync/test', async (req: Request, res: Response) => {
  try {
    const { mongoUri, dbName, collectionName, vaultId } = resolveSyncParams(req.body as SyncRequestBody);
    const result = await withMongoCollection(mongoUri, dbName, collectionName, async (collection) => {
      const existing = (await collection.findOne({ _id: vaultId as unknown as never })) as StoredVaultDoc | null;
      return {
        ok: true,
        exists: Boolean(existing),
        updatedAt: existing?.updatedAt ?? null,
        encrypted: Boolean(existing?.encrypted),
        counts: existing?.counts ?? null,
      };
    });
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to connect to MongoDB.';
    res.status(400).json({ ok: false, error: message });
  }
});

app.post('/api/sync/push', async (req: Request, res: Response) => {
  try {
    const body = req.body as SyncRequestBody;
    const { mongoUri, dbName, collectionName, vaultId } = resolveSyncParams(body);
    if (!body.document || typeof body.document !== 'object') {
      res.status(400).json({ ok: false, error: 'Missing vault document payload.' });
      return;
    }

    const updatedAt = new Date().toISOString();
    const docToStore: StoredVaultDoc = {
      ...(body.document as Omit<StoredVaultDoc, '_id'>),
      _id: vaultId,
      updatedAt,
    };

    await withMongoCollection(mongoUri, dbName, collectionName, async (collection) => {
      await collection.replaceOne(
        { _id: vaultId as unknown as never },
        docToStore as unknown as Record<string, unknown>,
        { upsert: true }
      );
    });

    res.json({ ok: true, updatedAt, vaultId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to push archive to MongoDB.';
    res.status(400).json({ ok: false, error: message });
  }
});

app.post('/api/sync/pull', async (req: Request, res: Response) => {
  try {
    const { mongoUri, dbName, collectionName, vaultId } = resolveSyncParams(req.body as SyncRequestBody);
    const doc = await withMongoCollection(mongoUri, dbName, collectionName, async (collection) => {
      return (await collection.findOne({ _id: vaultId as unknown as never })) as StoredVaultDoc | null;
    });

    if (!doc) {
      res.json({ ok: true, found: false, document: null });
      return;
    }

    res.json({ ok: true, found: true, document: doc });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to pull archive from MongoDB.';
    res.status(400).json({ ok: false, error: message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile('dist/index.html', { root: '.' });
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`0arc server active on http://0.0.0.0:${PORT}`);
  });
}

startServer();
