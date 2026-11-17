import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import packageJSON from './package.json' with { type: 'json' }

export default defineConfig(({ mode }) => ({
  plugins: [
    TanStackRouterVite({
      routeFileIgnorePattern: '(^[A-Z].*)',
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': resolve('./src'),
    },
  },
  define: {
    __appVersion: JSON.stringify(packageJSON.version),
    __envMode: JSON.stringify(mode),
  },
  // Tauri runs Vite itself, so keep its output readable.
  clearScreen: false,
  server: {
    port: 3002,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    target: 'es2022',
    // The app loads from disk, so the vendor bundle size is not a network concern.
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      input: {
        main: resolve('index.html'),
        overlay: resolve('overlay.html'),
        canvas: resolve('canvas.html'),
        capture: resolve('capture.html'),
        preview: resolve('preview.html'),
      },
    },
  },
}))
