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

/**
 * CSP do renderer — injetada SÓ no build, e por <meta>, não por cabeçalho.
 *
 * O app empacotado carrega o index.html por file:// (electron/main.ts,
 * `win.loadFile`) e o `webRequest.onHeadersReceived` só enxerga cabeçalho de
 * resposta HTTP — que file:// não tem. Uma CSP por cabeçalho na defaultSession
 * protegeria o `npm run dev` e ficaria ausente justamente no build que as
 * pessoas rodam, em silêncio.
 *
 * Em dev ela fica de fora de propósito: o @vitejs/plugin-react injeta um
 * <script type="module"> inline (preâmbulo do Fast Refresh) e um `script-src`
 * sem 'unsafe-inline' mataria o HMR.
 *
 * Cada afrouxamento abaixo tem dono. Não apertar sem reler o motivo — e sem
 * rodar `npm run test:e2e:build`, que é o único portão que enxerga isto.
 */
const RENDERER_CSP = [
  "default-src 'self'",
  // `file:` explícito ao lado de 'self': o documento é file:// no build, e não
  // se aposta o app inteiro na semântica de 'self' em origem de arquivo.
  "script-src 'self' file:",
  // 54 blocos <style>{...}</style> em 39 componentes: React monta cada um como
  // folha inline. Sem 'unsafe-inline' a interface some — sem erro de build.
  "style-src 'self' file: 'unsafe-inline'",
  // data: (poster placeholder e avatares), blob: (hls.js), file: (miniatura de
  // gravação), http:/https: (capas de provedor arbitrário).
  "img-src 'self' file: data: blob: http: https:",
  // blob: = MediaSource do hls.js; file: = gravação local; http:/https: = stream.
  "media-src 'self' file: blob: http: https:",
  "font-src 'self' file: data:",
  // Escancarado de propósito: o renderer fala com host arbitrário do provedor
  // (player_api.php, segmentos HLS, CDN de legenda) e com outro PC por ws://.
  // Ou seja: esta CSP dificulta o XSS acontecer, NÃO impede exfiltração.
  "connect-src 'self' file: blob: http: https: ws: wss:",
  // hls.js monta o worker de demuxagem a partir de um Blob. Sem blob: a
  // demuxagem cai fora do worker — vídeo engasgando e nenhum aviso na tela.
  "worker-src 'self' blob:",
  // Trailer embutido (ContentDetailModal).
  "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self' file:",
].join('; ')

/** Põe a <meta> da CSP logo depois do charset, só no build. */
function rendererCsp() {
  return {
    name: 'neostream:renderer-csp',
    apply: 'build' as const,
    transformIndexHtml: {
      // 'post': o vite:build-html já injetou as tags de asset quando este hook
      // roda, então o que sai daqui é o HTML final.
      order: 'post' as const,
      handler: (html: string) => {
        // Logo DEPOIS do charset, não no topo do <head>: a política tem ~700
        // bytes e empurraria o `<meta charset>` para perto do limite de 1024
        // bytes em que o parser ainda o respeita. E antes de qualquer
        // <script>, senão não governa o bundle.
        const [, charset] = /(<meta\s+charset=[^>]*>)/i.exec(html) ?? []
        if (!charset) {
          // Falhar o build é o ponto: uma CSP que some em silêncio é pior que
          // não ter CSP, porque ninguém volta a olhar.
          throw new Error('neostream:renderer-csp — <meta charset> não encontrado no index.html')
        }
        return html.replace(
          charset,
          `${charset}
  <meta http-equiv="Content-Security-Policy" content="${RENDERER_CSP}">`,
        )
      },
    },
  }
}

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
          }
        },
      },
    },
  },
  plugins: [
    rendererCsp(),
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
