import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🧯 Recusar um upgrade não pode derrubar o app.
 *
 * Os três caminhos de recusa do controle web — PIN errado (401), teto de
 * conexões (503) e guarda de Host/Origin (403) — escrevem num `net.Socket`
 * CRU, não num `http.ServerResponse`. Escrever num socket que o outro lado já
 * fechou emite `'error'` no tick seguinte, e um EventEmitter que emite
 * `'error'` sem listener LANÇA: no processo principal isso é
 * uncaughtException, e reprodução, DVR e cast caem junto.
 *
 * E são justamente os caminhos que um peer desleixado provoca: scanner de LAN
 * que manda o upgrade e fecha, celular reconectando com PIN velho durante uma
 * rotação, script batendo no teto de conexões.
 *
 * O teste é estrutural — como os outros deste arquivo de servidor — porque o
 * que precisa ser garantido é a ORDEM: o listener antes do primeiro write.
 */
const SERVIDOR = path.join(__dirname, 'webRemoteServer.ts')
// Normaliza CRLF: no Windows o recorte por marcador falha em silêncio e o
// teste passa por acidente (a lição do guarda do release, 09/2026).
const fonte = fs.readFileSync(SERVIDOR, 'utf8').split(String.fromCharCode(13)).join('')

/** Corpo de uma função/callback, do marcador até a chave de fechamento na coluna dada. */
function corpo(marcador: string, fechamento: string): string {
    const inicio = fonte.indexOf(marcador)
    expect(inicio, `marcador sumiu — reaponte o teste: ${marcador}`).toBeGreaterThan(-1)
    const fim = fonte.indexOf(fechamento, inicio)
    expect(fim, `fechamento não encontrado após ${marcador}`).toBeGreaterThan(inicio)
    return fonte.slice(inicio, fim)
}

describe('socket de upgrade: listener de error antes de qualquer write', () => {
    it('handleUpgrade protege o socket antes de escrever a recusa', () => {
        const fn = corpo('function handleUpgrade(', '\n}\n')
        const protecao = fn.indexOf('protegerSocket(socket)')
        const primeiroWrite = fn.indexOf('socket.write(')
        expect(protecao, 'handleUpgrade não chama protegerSocket').toBeGreaterThan(-1)
        expect(primeiroWrite, 'handleUpgrade deixou de escrever no socket — reaponte o teste').toBeGreaterThan(-1)
        expect(protecao).toBeLessThan(primeiroWrite)
    })

    it('o guarda de Host/Origin protege antes do 403', () => {
        const cb = corpo("server.on('upgrade'", '\n        })')
        const protecao = cb.indexOf('protegerSocket(')
        const primeiroWrite = cb.indexOf('socket.write(')
        expect(protecao).toBeGreaterThan(-1)
        expect(primeiroWrite).toBeGreaterThan(-1)
        expect(protecao).toBeLessThan(primeiroWrite)
    })

    it('protegerSocket destrói o socket em vez de deixar o erro subir', () => {
        const fn = corpo('function protegerSocket(', '\n}\n')
        expect(fn).toContain("socket.on('error'")
        expect(fn).toContain('socket.destroy()')
    })
})
