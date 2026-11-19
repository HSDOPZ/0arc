import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => ({
  base: './',
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, '.') },
    extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: false,
    allowedHosts: true as const,
    hmr: process.env.DISABLE_HMR !== 'true',
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
  },
}));
