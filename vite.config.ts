import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

// Native / Node-only deps that must NOT be bundled into the main process.
// They stay in node_modules and are loaded at runtime by Electron.
const MAIN_EXTERNALS = [
  'electron',
  'electron-log',
  'electron-store',
  'electron-updater',
  'peer-ssdp',
  'upnp-mediarenderer-client',
  'airplay-protocol',
  'node-fetch',
]

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('hls.js')) return 'vendor-hls';
            if (id.includes('vidstack')) return 'vendor-vidstack';
          }
        },
      },
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: MAIN_EXTERNALS,
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            rollupOptions: {
              external: MAIN_EXTERNALS,
            },
          },
        },
      },
      // Polyfill Electron and Node.js built-in modules for the renderer.
      // See https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: {},
    }),
  ],
})
