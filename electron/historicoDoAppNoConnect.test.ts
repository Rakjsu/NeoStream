import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as protocolo from './webRemoteProtocol'

/**
 * 📱 O "conectou" do celular no histórico de conexões (#D104).
 *
 * O servidor grava o histórico com atraso: `pushHistory` só enfileira num
 * buffer e agenda o flush pra ~1 s depois. O connect nasce como
 * `role:'browser', name:null` e o helloMobile do app chega MILISSEGUNDOS
 * depois — quando esse connect ainda está só no buffer. `applyMobileHello`
 * lia o histórico direto do disco, então:
 *   1. a conexão atual nunca ganhava o nome do celular (ficava "navegador");
 *   2. se o mesmo IP tinha um connect antigo no disco, ESSE era carimbado.
 *
 * Os quatro primeiros testes simulam exatamente esse estado (buffer com o
 * connect novo, disco com o antigo) sobre o helper puro. O último amarra o
 * helper a `applyMobileHello` — estrutural, como os outros testes deste
 * servidor (socketDeUpgrade, webRemoteRoutes), porque o módulo importa
 * electron, electron-store e dezenas de handlers.
 */

interface Evento {
    name: string | null
    ip: string
    role: string
    at: number
    event: 'connect' | 'disconnect'
}

const connect = (ip: string, at: number, role = 'browser', name: string | null = null): Evento =>
    ({ ip, at, role, name, event: 'connect' })
const disconnect = (ip: string, at: number, role = 'browser', name: string | null = null): Evento =>
    ({ ip, at, role, name, event: 'disconnect' })

type Marcador = (
    pending: Evento[],
    readStored: () => Evento[],
    ip: string,
    name: string,
) => { pending: Evento[]; stored: Evento[] | null }

function marcador(): Marcador {
    const fn = (protocolo as Record<string, unknown>).markMobileInPendingHistory
    expect(typeof fn, 'webRemoteProtocol não exporta markMobileInPendingHistory').toBe('function')
    return fn as Marcador
}

describe('helloMobile marca a conexão ATUAL, mesmo antes do flush do histórico', () => {
    it('connect ainda no buffer: ele ganha o nome do celular e o disco nem é lido', () => {
        const marcar = marcador()
        // No disco: uma sessão antiga da PÁGINA do navegador no mesmo IP.
        const disco = [connect('10.0.0.5', 100), disconnect('10.0.0.5', 200)]
        let leuDisco = false
        // No buffer: o connect que acabou de entrar (flush ainda não rodou).
        const buffer = [connect('10.0.0.5', 1_000)]

        const out = marcar(buffer, () => { leuDisco = true; return disco }, '10.0.0.5', 'Pixel 8')

        expect(out.pending[0]).toMatchObject({ ip: '10.0.0.5', at: 1_000, role: 'mobile', name: 'Pixel 8' })
        // A linha antiga do navegador NÃO pode ser carimbada como o celular.
        expect(out.stored).toBeNull()
        expect(disco[0]).toMatchObject({ role: 'browser', name: null })
        expect(leuDisco).toBe(false)
    })

    it('o histórico que o painel mostra (disco + buffer) fica com a linha certa marcada', () => {
        const marcar = marcador()
        const disco = [connect('10.0.0.5', 100), disconnect('10.0.0.5', 200), connect('10.0.0.9', 300)]
        const buffer = [connect('10.0.0.5', 1_000)]

        const out = marcar(buffer, () => disco, '10.0.0.5', 'Pixel 8')
        // O que o flushHistory grava e o painel lê: disco (talvez regravado) + buffer.
        const painel = [...(out.stored ?? disco), ...out.pending]

        const marcadas = painel.filter(e => e.role === 'mobile')
        expect(marcadas).toHaveLength(1)
        expect(marcadas[0]).toMatchObject({ at: 1_000, name: 'Pixel 8', event: 'connect' })
    })

    it('connect já gravado (hello atrasado depois do flush): cai no disco e marca lá', () => {
        const marcar = marcador()
        const disco = [connect('10.0.0.9', 100), connect('10.0.0.5', 1_000)]
        const buffer: Evento[] = []

        const out = marcar(buffer, () => disco, '10.0.0.5', 'Pixel 8')

        expect(out.pending).toBe(buffer)
        expect(out.stored).not.toBeNull()
        expect(out.stored?.[1]).toMatchObject({ ip: '10.0.0.5', role: 'mobile', name: 'Pixel 8' })
        expect(out.stored?.[0]).toMatchObject({ role: 'browser', name: null })
    })

    it('IP sem connect em lugar nenhum: não regrava o disco à toa', () => {
        const marcar = marcador()
        const buffer = [disconnect('10.0.0.5', 1_000)]
        const out = marcar(buffer, () => [connect('10.0.0.9', 100)], '10.0.0.5', 'Pixel 8')
        expect(out.pending).toBe(buffer)
        expect(out.stored).toBeNull()
    })

    it('applyMobileHello passa o buffer pelo marcador, guarda o resultado e só grava o disco se mudou', () => {
        // Sem isto o helper puro fica verde e o painel continua errado: basta
        // o servidor esquecer de devolver o buffer marcado, passar outra lista
        // no lugar dele ou voltar a regravar o disco a cada hello.
        const fonte = fs.readFileSync(path.join(__dirname, 'webRemoteServer.ts'), 'utf8')
            .split(String.fromCharCode(13)).join('')
        const inicio = fonte.indexOf('function applyMobileHello(')
        expect(inicio, 'applyMobileHello sumiu — reaponte o teste').toBeGreaterThan(-1)
        const fim = fonte.indexOf('\n}\n', inicio)
        expect(fim, 'fim de applyMobileHello não encontrado').toBeGreaterThan(inicio)
        // Sem comentários (eles citam os mesmos nomes) e com espaços colapsados.
        const corpo = fonte.slice(inicio, fim)
            .split('\n').map(l => l.replace(/\/\/.*$/, '')).join(' ')
            .replace(/\s+/g, ' ')

        // Os quatro argumentos: o buffer, o disco como reserva, o IP DESTA
        // conexão e o nome que o app anunciou.
        const chamada = new RegExp(
            'const (\\w+) = markMobileInPendingHistory\\( ?historyBuffer, ' +
            "\\(\\) => \\(store\\.get\\('connectionHistory'\\) as ConnectionEvent\\[\\] \\| undefined\\) \\?\\? \\[\\], " +
            "client\\.ip \\?\\? '\\?', hello\\.name,? ?\\)",
        ).exec(corpo)
        expect(chamada, 'applyMobileHello não marca o historyBuffer (com o disco como reserva, IP e nome do hello)').not.toBeNull()
        const r = chamada![1]
        expect(corpo.includes(`historyBuffer = ${r}.pending`), 'o buffer marcado não volta pro historyBuffer').toBe(true)
        expect(corpo.includes(`if (${r}.stored) store.set('connectionHistory', ${r}.stored)`),
            'o disco tem que ser regravado só quando o marcador devolve uma lista nova').toBe(true)
        // Nenhuma outra escrita no histórico nem marcação direta do disco. Um
        // flushHistory() aqui também "funcionaria", mas regravaria o JSON a
        // cada hello — o martelo de I/O que o buffer existe pra evitar (Item 14).
        expect(corpo.split("store.set('connectionHistory'").length - 1).toBe(1)
        expect(corpo.includes('markMobileInHistory(')).toBe(false)
        expect(corpo.includes('flushHistory(')).toBe(false)
    })
})
