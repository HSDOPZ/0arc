/**
 * 0arc Local Development & Static Server
 * Serves the Vite frontend in development / static dist bundle in production.
 * All data, media lookups, encryption, and device sync run 100% client-side.
 */
import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  next();
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
    app.get('*', (_req, res) => {
      res.sendFile('dist/index.html', { root: '.' });
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`0arc server active on http://0.0.0.0:${PORT}`);
  });
}

startServer();
