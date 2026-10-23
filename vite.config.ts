import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
  server: {
    watch: process.env.VITE_FS_WATCH_POLLING === 'true'
      ? { usePolling: true, interval: 1000 }
      : undefined,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
})
