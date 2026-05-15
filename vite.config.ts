import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

// NOTE: do NOT externalize CJS deps like `electron-updater` here.
// `electron-updater` exposes `module.exports.autoUpdater = getCurrentAutoUpdater()`
// — a dynamic assignment that Node's ESM↔CJS interop can't see as a named
// export. Bundling lets Rollup rewrite the named import as a require()+pick.
// Externalizing crashed v3.9.4 at launch with:
//   SyntaxError: Named export 'autoUpdater' not found.
// If you want to externalize again, first rewrite affected files to
//   import pkg from 'electron-updater'; const { autoUpdater } = pkg;

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
      },
      preload: {
        input: 'electron/preload.ts',
      },
      // Polyfill Electron and Node.js built-in modules for the renderer.
      // See https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: {},
    }),
  ],
})
