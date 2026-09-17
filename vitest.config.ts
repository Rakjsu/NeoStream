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
    // Fuso fixo, e de proposito NAO-UTC: o app carimba o dia no fuso do
    // aparelho (utils/diaLocal.ts). Com o fuso da maquina, um teste de data
    // passa aqui (UTC-4) e falha no CI (UTC) — ou, pior, passa nos dois e
    // deixa passar um bug que so aparece pra quem mora fora de Greenwich.
    env: { TZ: 'America/Sao_Paulo' },
    // electron is a runtime, not something we want to import in unit tests
    // (any module that imports 'electron' should be unit-tested via mocks).
  },
})
