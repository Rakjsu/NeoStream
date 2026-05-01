import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    // hls.js is isolated in its own lazy media chunk and is slightly above Vite's
    // default 500 kB warning threshold after minification.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined

          if (/[\\/]node_modules[\\/](react|react-dom|react-router-dom)[\\/]/.test(id)) {
            return 'vendor-react'
          }

          if (/[\\/]node_modules[\\/]hls\.js[\\/]/.test(id)) {
            return 'vendor-hls'
          }

          if (/[\\/]node_modules[\\/](@vidstack|vidstack)[\\/]/.test(id)) {
            return 'vendor-vidstack'
          }

          if (/[\\/]node_modules[\\/](lucide-react|react-icons)[\\/]/.test(id)) {
            return 'vendor-ui'
          }

          if (/[\\/]node_modules[\\/](i18next|react-i18next|i18next-browser-languagedetector)[\\/]/.test(id)) {
            return 'vendor-i18n'
          }

          return 'vendor'
        },
      },
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        input: 'electron/preload.ts',
      },
      // Ployfill the Electron and Node.js built-in modules for Renderer process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: {},
    }),
  ],
})
