import { describe, it, expect } from 'vitest'
import {
    isAllowedHost,
    isAllowedOrigin,
    isAppOwnOrigin,
    isIpLiteralOrLocalhost,
    localRequestVerdict,
} from './localServerGuard'

describe('isAllowedHost: DNS rebinding em porta fixa', () => {
    it('domínio no Host é recusado — é a assinatura do rebinding', () => {
        // A página fica em http://evil.com:8974/, o DNS re-resolve pro IP da
        // vítima e o navegador passa a tratar tudo como same-origin. O que NÃO
        // muda é o Host: continua sendo o domínio da barra de endereço.
        expect(isAllowedHost('evil.com:8974', 8974)).toBe(false)
        expect(isAllowedHost('rebind.attacker.tld:8974', 8974)).toBe(false)
        expect(isAllowedHost('neostream.local:8974', 8974)).toBe(false)
    })

    it('IP literal e localhost passam — é como todo cliente real chega', () => {
        expect(isAllowedHost('192.168.0.10:8974', 8974)).toBe(true)
        expect(isAllowedHost('127.0.0.1:8974', 8974)).toBe(true)
        expect(isAllowedHost('localhost:8974', 8974)).toBe(true)
        expect(isAllowedHost('LocalHost:8974', 8974)).toBe(true)
        expect(isAllowedHost('[::1]:8974', 8974)).toBe(true)
    })

    it('porta diferente da que o servidor escuta é recusada', () => {
        expect(isAllowedHost('192.168.0.10:80', 8974)).toBe(false)
        expect(isAllowedHost('192.168.0.10:8975', 8974)).toBe(false)
    })

    it('Host ausente passa (cliente que não é navegador)', () => {
        // Nenhum navegador omite Host; o rebinding sempre traz um domínio.
        expect(isAllowedHost(undefined, 8974)).toBe(true)
        expect(isAllowedHost('', 8974)).toBe(true)
    })

    it('Host malformado ou octeto fora da faixa não vira IP', () => {
        expect(isAllowedHost('999.1.1.1:8974', 8974)).toBe(false)
        expect(isAllowedHost('1.2.3:8974', 8974)).toBe(false)
        expect(isAllowedHost('192.168.0.10:porta', 8974)).toBe(false)
        expect(isAllowedHost('::1:8974', 8974)).toBe(false)
    })

    it('sem porta conhecida ainda exige IP literal', () => {
        expect(isAllowedHost('evil.com:8974', null)).toBe(false)
        expect(isAllowedHost('192.168.0.10:41234', null)).toBe(true)
    })

    it('isIpLiteralOrLocalhost separa IP de domínio', () => {
        expect(isIpLiteralOrLocalhost('10.0.0.1')).toBe(true)
        expect(isIpLiteralOrLocalhost('localhost')).toBe(true)
        expect(isIpLiteralOrLocalhost('localhost.evil.com')).toBe(false)
        expect(isIpLiteralOrLocalhost('192.168.0.10.evil.com')).toBe(false)
        expect(isIpLiteralOrLocalhost('[]')).toBe(false)
    })
})

describe('isAllowedOrigin: WebSocket e POST cross-origin', () => {
    it('página de terceiro é recusada mesmo batendo direto no IP', () => {
        // ws://192.168.0.10:8974/?pin=NNNN aberto de uma aba em evil.com: o
        // WebSocket não passa por CORS, só o Origin do upgrade barra isso.
        expect(isAllowedOrigin('http://evil.com', '192.168.0.10:8974')).toBe(false)
        expect(isAllowedOrigin('https://evil.com:8974', '192.168.0.10:8974')).toBe(false)
        // Prefixo/sufixo que "parece" a origem certa não pode passar.
        expect(isAllowedOrigin('http://192.168.0.10.evil.com:8974', '192.168.0.10:8974')).toBe(false)
        expect(isAllowedOrigin('http://192.168.0.100:8974', '192.168.0.10:8974')).toBe(false)
    })

    it('origem opaca (null) é recusada — é o <iframe sandbox>', () => {
        // Aceitar 'null' devolveria o buraco: basta um iframe sandbox pra
        // qualquer página falar com o controle. Nenhum cliente real manda isso.
        expect(isAllowedOrigin('null', '192.168.0.10:8974')).toBe(false)
        expect(isAllowedOrigin('file://', '192.168.0.10:8974')).toBe(false)
    })

    it('a origem do próprio servidor passa (navegador do celular e PWA)', () => {
        expect(isAllowedOrigin('http://192.168.0.10:8974', '192.168.0.10:8974')).toBe(true)
        expect(isAllowedOrigin('https://192.168.0.10:8974', '192.168.0.10:8974')).toBe(true)
        expect(isAllowedOrigin('http://localhost:8974', 'localhost:8974')).toBe(true)
    })

    it('Origin ausente passa — o app do celular não manda o header', () => {
        expect(isAllowedOrigin(undefined, '192.168.0.10:8974')).toBe(true)
    })

    it('esquema exótico não passa por origem própria', () => {
        expect(isAllowedOrigin('neostream://setup', '192.168.0.10:8974')).toBe(false)
        expect(isAllowedOrigin('http://192.168.0.10:8974', undefined)).toBe(false)
    })
})

describe('localRequestVerdict', () => {
    it('separa o motivo da recusa', () => {
        expect(localRequestVerdict('192.168.0.10:8974', undefined, 8974)).toBe('ok')
        expect(localRequestVerdict('evil.com:8974', undefined, 8974)).toBe('bad-host')
        expect(localRequestVerdict('192.168.0.10:8974', 'http://evil.com', 8974)).toBe('bad-origin')
    })
})

describe('isAppOwnOrigin: servidores de loopback (timeshift/transcode)', () => {
    it('página de terceiro varrendo a porta efêmera é recusada', () => {
        expect(isAppOwnOrigin('http://evil.com')).toBe(false)
        expect(isAppOwnOrigin('https://evil.com', 'http://localhost:5173')).toBe(false)
    })

    it('o renderer do app passa (file:// vira origem null)', () => {
        expect(isAppOwnOrigin('null')).toBe(true)
        expect(isAppOwnOrigin('file://')).toBe(true)
        expect(isAppOwnOrigin(undefined)).toBe(true)
    })

    it('em dev, o servidor do Vite passa', () => {
        expect(isAppOwnOrigin('http://localhost:5173', 'http://localhost:5173/')).toBe(true)
        expect(isAppOwnOrigin('http://localhost:5174', 'http://localhost:5173/')).toBe(false)
    })
})
