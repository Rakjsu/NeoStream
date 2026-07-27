/**
 * 🔗 Ecossistema: leva as contas do desktop pro celular. Gera o MESMO deep
 * link que o "compartilhar config" do NeoStream Mobile já entende
 * (neostream://setup?d=base64(JSON)) e a pagininha de handoff servida pelo
 * controle web em /setup — o QR nas Configurações → Playlists aponta pra ela.
 *
 * 🔐 O QR das Configurações NÃO leva mais o PIN nem o payload em claro: leva
 * um ticket de uso único (query) + a chave AES no FRAGMENTO da URL. Fragmento
 * não é enviado no request HTTP, então quem fareja a LAN vê só o ciphertext, e
 * quem fotografa a tela depois cai num ticket já consumido/expirado. O caminho
 * antigo `/setup?pin=` continua servindo o `d=` puro porque é o pareamento
 * manual do app (o usuário digita o PIN, que já autentica o WebSocket).
 */
import crypto from 'node:crypto'

export interface SetupAccountSource {
    id: string
    name: string
    url: string
    username: string
    password: string
    type?: 'xtream' | 'm3u' | 'stalker'
}

/** Versão do envelope selado — o app rejeita com mensagem clara o que não entende. */
export const SETUP_ENVELOPE_VERSION = 2

/** Ticket de uso único do QR: token vai na query, chave só no fragmento. */
export interface SetupTicket {
    token: string
    key: string
    expiresAt: number
}

const TICKET_TTL_MS = 120_000
/** Teto de tickets vivos: o painel do QR renova enquanto estiver aberto. */
const TICKET_MAX = 8
const tickets = new Map<string, { key: string; expiresAt: number }>()

function setupPayloadObject(playlists: SetupAccountSource[], activeId: string | null): object {
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
    return { accounts, activeId }
}

export function buildSetupDeepLink(playlists: SetupAccountSource[], activeId: string | null): string {
    const b64 = Buffer.from(JSON.stringify(setupPayloadObject(playlists, activeId)), 'utf8').toString('base64')
    return `neostream://setup?d=${encodeURIComponent(b64)}`
}

/** Emite um ticket novo (e limpa os expirados/excedentes). */
export function issueSetupTicket(now: number = Date.now()): SetupTicket {
    for (const [token, entry] of tickets) {
        if (entry.expiresAt <= now) tickets.delete(token)
    }
    while (tickets.size >= TICKET_MAX) tickets.delete(tickets.keys().next().value as string)
    // 12 e 22 chars base64url: a URL inteira do QR precisa caber no encoder v4
    // (ver SETUP_QR_MAX_BYTES), e o token ainda tem 72 bits de aleatoriedade.
    const ticket: SetupTicket = {
        token: crypto.randomBytes(9).toString('base64url'),
        key: crypto.randomBytes(16).toString('base64url'),
        expiresAt: now + TICKET_TTL_MS,
    }
    tickets.set(ticket.token, { key: ticket.key, expiresAt: ticket.expiresAt })
    return ticket
}

/** Troca o token pela chave — só na PRIMEIRA vez e dentro da validade. */
export function consumeSetupTicket(token: string, now: number = Date.now()): string | null {
    const entry = tickets.get(token)
    if (!entry) return null
    tickets.delete(token)
    return entry.expiresAt > now ? entry.key : null
}

/** Só pra testes: zera os tickets vivos. */
export function resetSetupTickets(): void {
    tickets.clear()
}

/** Chaves de cifra e de MAC derivadas do segredo do QR (nunca o segredo cru). */
function subKeys(key: string): { enc: Buffer; mac: Buffer } {
    const raw = Buffer.from(key, 'base64url')
    const derive = (label: string) =>
        crypto.createHash('sha256').update(Buffer.concat([raw, Buffer.from(label, 'utf8')])).digest()
    return { enc: derive('neostream-setup-enc'), mac: derive('neostream-setup-mac') }
}

/**
 * Sela o payload com AES-256-CBC + HMAC-SHA256 (encrypt-then-MAC). CBC+HMAC e
 * não GCM porque o lado do celular usa crypto-js, que não tem GCM.
 */
export function sealSetupPayload(json: string, key: string): string {
    const { enc, mac } = subKeys(key)
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-cbc', enc, iv)
    const ct = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()])
    const envelope = {
        v: SETUP_ENVELOPE_VERSION,
        iv: iv.toString('base64'),
        ct: ct.toString('base64'),
        mac: crypto.createHmac('sha256', mac).update(Buffer.concat([iv, ct])).digest('base64'),
    }
    return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64')
}

/** Deep link selado — a chave NÃO vai aqui; a página a anexa vinda do fragmento. */
export function buildSealedSetupDeepLink(playlists: SetupAccountSource[], activeId: string | null, key: string): string {
    const sealed = sealSetupPayload(JSON.stringify(setupPayloadObject(playlists, activeId)), key)
    return `neostream://setup?e=${encodeURIComponent(sealed)}`
}

/**
 * Capacidade do QR das Configurações (byte mode, EC L): v4 = 80 codewords − 2
 * de overhead. O encoder próprio para na v4, então a URL PRECISA caber aqui,
 * senão o qrToSvg lança e o usuário fica sem o QR (o catch some com ele).
 */
export const SETUP_QR_MAX_BYTES = 78

/** URL do QR: ticket na query, chave no fragmento (fragmento não vai no request). */
export function buildSetupQrUrl(baseUrl: string, ticket: SetupTicket): string {
    return `${baseUrl.replace(/\/+$/, '')}/setup?t=${ticket.token}#k=${ticket.key}`
}

const HANDOFF_STRINGS = {
    pt: {
        title: 'Levar pro celular',
        open: '📲 Abrir no NeoStream',
        hint: 'Se nada acontecer, toque no botão. É preciso ter o NeoStream Mobile instalado.',
        needsApp: 'Este QR é protegido: precisa do NeoStream Mobile v0.21 ou mais novo. Se o app disser que o link é inválido, atualize-o.',
        expired: 'Este QR já foi usado ou expirou (vale 2 minutos e uma vez só). Abra de novo o "Levar pro celular" no desktop.',
    },
    en: {
        title: 'Take to your phone',
        open: '📲 Open in NeoStream',
        hint: 'If nothing happens, tap the button. The NeoStream Mobile app must be installed.',
        needsApp: 'This QR is encrypted: it needs NeoStream Mobile v0.21 or newer. If the app says the link is invalid, update it.',
        expired: 'This QR was already used or has expired (it lasts 2 minutes, once). Open "Take to your phone" again on the desktop.',
    },
    es: {
        title: 'Llevar al celular',
        open: '📲 Abrir en NeoStream',
        hint: 'Si no pasa nada, toca el botón. Necesitas la app NeoStream Mobile instalada.',
        needsApp: 'Este QR está cifrado: necesita NeoStream Mobile v0.21 o superior. Si la app dice que el enlace no es válido, actualízala.',
        expired: 'Este QR ya se usó o caducó (dura 2 minutos y una sola vez). Abre de nuevo "Llevar al celular" en el escritorio.',
    },
} as const

const PAGE_STYLE = `
  body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 18px; font-family: -apple-system, system-ui, sans-serif;
    background: radial-gradient(120% 80% at 50% 0%, #1a1a2e, #0a0a0f); color: #fff;
    padding: 24px; text-align: center; }
  a.open { padding: 16px 28px; border-radius: 16px; background: linear-gradient(135deg, #4f46e5, #6366f1);
    color: #fff; text-decoration: none; font-size: 17px; font-weight: 700; }
  p { color: rgba(255,255,255,.6); font-size: 14px; max-width: 320px; }`

const pageLang = (lang?: string): 'pt' | 'en' | 'es' => (lang === 'en' || lang === 'es' ? lang : 'pt')

const pageHtml = (lang: string | undefined, title: string, body: string): string => `<!doctype html>
<html lang="${lang === 'en' ? 'en' : lang === 'es' ? 'es' : 'pt-BR'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NeoStream — ${title}</title>
<style>${PAGE_STYLE}
</style>
</head>
<body>
${body}
</body>
</html>`

/**
 * Tiny LAN page that bounces straight into the mobile app's deep link.
 * No link selado (`?e=`) a chave vem do fragmento (`#k=`) desta própria URL —
 * ela nunca chegou ao servidor, então é aqui, no celular, que o link final é
 * montado. Sem JS o botão ainda abre o app (aí sem a chave, e o app avisa).
 */
export function renderSetupHandoffPage(deepLink: string, lang?: string): string {
    const t = HANDOFF_STRINGS[pageLang(lang)]
    const sealed = deepLink.includes('setup?e=')
    return pageHtml(lang, t.title, `<div style="font-size:44px">📺</div>
<a class="open" id="open" href="${deepLink}">${t.open}</a>
<p>${t.hint}</p>
${sealed ? `<p>${t.needsApp}</p>` : ''}
<script>(function () {
  var base = ${JSON.stringify(deepLink)};
  var k = (location.hash.match(/[#&]k=([A-Za-z0-9_-]+)/) || [])[1];
  var link = k ? base + '&k=' + k : base;
  document.getElementById('open').href = link;
  location.href = link;
})()</script>`)
}

/** QR já usado ou vencido: explica em vez de devolver um 403 seco. */
export function renderSetupExpiredPage(lang?: string): string {
    const t = HANDOFF_STRINGS[pageLang(lang)]
    return pageHtml(lang, t.title, `<div style="font-size:44px">⏳</div>
<p>${t.expired}</p>`)
}
