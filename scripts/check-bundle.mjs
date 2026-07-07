// Guarda de bundle: falha quando o vite embute o ffmpeg-static no main.js.
// O módulo inline calcula o caminho do binário com um __dirname que aponta
// pra dist-electron — caminho inexistente, DVR/transcode mortos (#242).
// Resolvers corretos usam createRequire(import.meta.url) em runtime.
import { readFileSync } from 'node:fs'

const bundle = readFileSync(new URL('../dist-electron/main.js', import.meta.url), 'utf-8')

// Assinatura do index.js do ffmpeg-static (só existe quando foi embutido).
if (bundle.includes('binary-path-env-var')) {
    console.error('[check-bundle] ffmpeg-static foi EMBUTIDO no main.js — o caminho do binário quebra em runtime.')
    console.error('[check-bundle] Use createRequire(import.meta.url) no lugar de require() direto (ver #242).')
    process.exit(1)
}
console.log('[check-bundle] ok — ffmpeg-static resolvido em runtime, nada embutido.')
