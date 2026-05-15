import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Only pick up tests under src/; ignore electron/ and build artifacts.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'dist-electron', 'release'],
    // electron is a runtime, not something we want to import in unit tests
    // (any module that imports 'electron' should be unit-tested via mocks).
  },
})
