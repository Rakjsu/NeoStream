/**
 * 🔗 Ecossistema: leva as contas do desktop pro celular. Gera o MESMO deep
 * link que o "compartilhar config" do NeoStream Mobile já entende
 * (neostream://setup?d=base64(JSON)) e a pagininha de handoff servida pelo
 * controle web em /setup — o QR nas Configurações → Playlists aponta pra ela.
 */

export interface SetupAccountSource {
    id: string
    name: string
    url: string
    username: string
    password: string
    type?: 'xtream' | 'm3u' | 'stalker'
}

export function buildSetupDeepLink(playlists: SetupAccountSource[], activeId: string | null): string {
    const accounts = playlists
        .filter(p => typeof p.url === 'string' && p.url.trim().length > 0)
        .map(p => ({
            id: p.id,
            url: p.url,
            username: p.username || '',
            password: p.password || '',
            type: p.type === 'm3u' || p.type === 'stalker' ? p.type : 'xtream',
            alias: p.name || undefined,
        }))
    const payload = { accounts, activeId }
    const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    return `neostream://setup?d=${encodeURIComponent(b64)}`
}

const HANDOFF_STRINGS = {
    pt: {
        title: 'Levar pro celular',
        open: '📲 Abrir no NeoStream',
        hint: 'Se nada acontecer, toque no botão. É preciso ter o NeoStream Mobile instalado.',
    },
    en: {
        title: 'Take to your phone',
        open: '📲 Open in NeoStream',
        hint: 'If nothing happens, tap the button. The NeoStream Mobile app must be installed.',
    },
    es: {
        title: 'Llevar al celular',
        open: '📲 Abrir en NeoStream',
        hint: 'Si no pasa nada, toca el botón. Necesitas la app NeoStream Mobile instalada.',
    },
} as const

/** Tiny LAN page that bounces straight into the mobile app's deep link. */
export function renderSetupHandoffPage(deepLink: string, lang?: string): string {
    const t = HANDOFF_STRINGS[lang === 'en' || lang === 'es' ? lang : 'pt']
    return `<!doctype html>
<html lang="${lang === 'en' ? 'en' : lang === 'es' ? 'es' : 'pt-BR'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NeoStream — ${t.title}</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 18px; font-family: -apple-system, system-ui, sans-serif;
    background: radial-gradient(120% 80% at 50% 0%, #1a1a2e, #0a0a0f); color: #fff;
    padding: 24px; text-align: center; }
  a.open { padding: 16px 28px; border-radius: 16px; background: linear-gradient(135deg, #4f46e5, #6366f1);
    color: #fff; text-decoration: none; font-size: 17px; font-weight: 700; }
  p { color: rgba(255,255,255,.6); font-size: 14px; max-width: 320px; }
</style>
</head>
<body>
<div style="font-size:44px">📺</div>
<a class="open" href="${deepLink}">${t.open}</a>
<p>${t.hint}</p>
<script>location.href = ${JSON.stringify(deepLink)}</script>
</body>
</html>`
}
