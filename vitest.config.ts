import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // src/ tests + pure electron modules (no 'electron' import allowed there).
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'electron/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist', 'dist-electron', 'release'],
    // electron is a runtime, not something we want to import in unit tests
    // (any module that imports 'electron' should be unit-tested via mocks).
  },
})
