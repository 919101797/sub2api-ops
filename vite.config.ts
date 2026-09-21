import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: 'web',
  base: process.env.VITE_BASE_PATH || '/ops/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./web/src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/ops/api': 'http://127.0.0.1:8080',
      '/health': 'http://127.0.0.1:8080',
    },
  },
  test: {
    // Bound concurrent jsdom work so layout-heavy UI suites do not starve async assertions.
    maxWorkers: 4,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['../server/**/*.test.ts', './src/**/*.test.ts', './src/**/*.test.tsx'],
  },
})
