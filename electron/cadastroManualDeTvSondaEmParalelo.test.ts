/**
 * 📺 "Adicionar TV" por IP não pode ficar minutos mudo, nem salvar um palpite
 * como se a TV tivesse respondido (D199).
 *
 * O `dlna:add-device` sondava 4-5 portas × 4 caminhos de descrição UPnP em
 * DOIS for aninhados com await — uma sonda por vez, cada uma com 10 s de
 * prazo. Com o IP digitado errado ou a TV desligada (justamente quem recorre
 * ao cadastro manual), eram 16 sondas × 10 s ≈ 2,5 minutos de botão parado,
 * e no fim o handler devolvia `success: true` com o endereço-palpite
 * `http://IP:9197/dmr`, idêntico ao de uma TV que respondeu.
 *
 * O teste roda o HANDLER DE VERDADE (só `electron`, `node-fetch`, o logger,
 * a política de certificado e o caminho do ffmpeg são falsos). O `node-fetch`
 * falso faz o papel da LAN:
 *  - IP sem ninguém (`rede.hostVivo = false`) ou porta FILTRADA: a sonda fica
 *    pendurada até o sinal de abort do chamador (o SYN nunca volta);
 *  - TV ligada: porta fechada RECUSA na hora (ECONNREFUSED);
 *  - `rede.respondem`: URL → atraso da resposta com a descrição.
 * O relógio é o de `vi.useFakeTimers`, então o prazo de cada sonda anda
 * quando o teste manda.
 *
 * O que fica preso:
 *  - todas as sondas saem JUNTAS (não em fila);
 *  - com ninguém respondendo, o cadastro termina no prazo de UMA sonda
 *    (≤ 3 s de LAN) e devolve `unverified: true` — a TV é salva (pode só estar
 *    desligada), mas a tela fica sabendo que ninguém respondeu;
 *  - TV ligada: o cadastro acaba assim que a descrição chega, e as sondas que
 *    ainda estão no ar são canceladas (nada de sonda órfã batendo na LAN);
 *  - quem vence é a PRIMEIRA NA ORDEM (porta digitada, depois 9197...), não a
 *    mais rápida — a mesma TV publica mais de uma descrição, e a corrida
 *    salvaria uma qualquer (e trocaria o id `manual-IP-porta`);
 *  - guarda contra corrigir demais: TV que responde continua cadastrada sem
 *    aviso, e a porta que o dono digitou continua sendo sondada primeiro.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/** Uma TV na LAN responde a descrição em ms; o cadastro inteiro cabe nisto. */
const PRAZO_DO_CADASTRO_MS = 3000

const rede = vi.hoisted(() => ({
    /** false = ninguém no IP: toda sonda fica muda até o abort. */
    hostVivo: false,
    /** Portas que o firewall da TV descarta (mudas até o abort mesmo com a TV ligada). */
    filtradas: new Set<number>(),
    /** URL de descrição → atraso (ms) até ela responder. */
    respondem: new Map<string, { atrasoMs: number; nome: string }>(),
    /** Toda sonda que saiu, na ordem. */
    sondas: [] as string[],
    /** Sondas no ar agora (saíram e ainda não voltaram nem foram abortadas). */
    emVoo: new Set<string>(),
    /** Sondas que o chamador abortou (prazo ou desistência). */
    abortadas: [] as string[],
}))

const ipc = vi.hoisted(() => ({
    handlers: new Map<string, (evento: unknown, carga?: unknown) => unknown>(),
}))

vi.mock('electron', () => ({
    ipcMain: {
        handle: (canal: string, fn: (evento: unknown, carga?: unknown) => unknown) => {
            ipc.handlers.set(canal, fn)
        },
        on: () => undefined,
    },
}))

vi.mock('./logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('./certificatePolicy', () => ({
    resolveProviderHttpsAgent: async () => undefined,
    getCertificateSettings: () => ({ approvedProviderHosts: [] }),
}))

vi.mock('./ffmpegPath', () => ({ resolveFfmpegPath: () => 'ffmpeg' }))

function descricao(nome: string) {
    return `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0"><device>
  <friendlyName>${nome}</friendlyName>
  <manufacturer>LG Electronics</manufacturer>
  <modelName>OLED55C1</modelName>
</device></root>`
}

vi.mock('node-fetch', () => ({
    default: (url: string, init?: { signal?: AbortSignal }) => {
        const alvo = String(url)
        rede.sondas.push(alvo)
        const porta = Number(new URL(alvo).port)
        const resposta = rede.respondem.get(alvo)

        if (rede.hostVivo && !resposta && !rede.filtradas.has(porta)) {
            // TV ligada, porta fechada: o RST volta na hora.
            return Promise.reject(Object.assign(new Error(`connect ECONNREFUSED ${alvo}`), { code: 'ECONNREFUSED' }))
        }

        rede.emVoo.add(alvo)
        return new Promise((resolve, reject) => {
            let relogio: ReturnType<typeof setTimeout> | undefined
            const abortar = () => {
                if (relogio) clearTimeout(relogio)
                rede.emVoo.delete(alvo)
                rede.abortadas.push(alvo)
                reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))
            }
            if (init?.signal?.aborted) { abortar(); return }
            init?.signal?.addEventListener('abort', abortar, { once: true })
            if (resposta && rede.hostVivo) {
                relogio = setTimeout(() => {
                    init?.signal?.removeEventListener('abort', abortar)
                    rede.emVoo.delete(alvo)
                    resolve({ ok: true, status: 200, text: async () => descricao(resposta.nome) })
                }, resposta.atrasoMs)
            }
        })
    },
}))

type RespostaDoCadastro = {
    success: boolean
    error?: string
    unverified?: boolean
    device?: { id: string; name: string; port?: number; location?: string }
}

function cadastrar(carga: { name?: string; ip: string; port?: number }) {
    const handler = ipc.handlers.get('dlna:add-device')
    if (!handler) throw new Error('handler dlna:add-device não registrado')
    let terminou = false
    const promessa = (handler(null, carga) as Promise<RespostaDoCadastro>).then(resposta => {
        terminou = true
        return resposta
    })
    return { promessa, terminou: () => terminou }
}

const IP = '192.168.0.77'

describe('cadastro manual de TV por IP (D199)', () => {
    beforeEach(async () => {
        vi.resetModules()
        ipc.handlers.clear()
        rede.hostVivo = false
        rede.filtradas.clear()
        rede.respondem.clear()
        rede.sondas.length = 0
        rede.emVoo.clear()
        rede.abortadas.length = 0
        const modulo = await import('./dlnaHandlers')
        modulo.setupDLNAHandlers()
        // O node-fetch falso já carregado ANTES do relógio falso: sob a carga
        // da suíte, carregar o módulo leva tempo real, e cada volta do
        // vi.waitFor anda 50 ms do relógio falso — o prazo das sondas
        // venceria antes de elas saírem.
        await import('node-fetch')
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('IP que ninguém responde: as sondas saem juntas, o cadastro acaba no prazo de UMA sonda e avisa que não foi verificado', async () => {
        const inicio = Date.now()
        const cadastro = cadastrar({ name: '', ip: IP, port: 9197 })

        // Todas no ar ao mesmo tempo: 4 portas (9197 digitada + 7676, 8001,
        // 8080) × 4 caminhos. Em fila, só a primeira estaria no ar.
        await vi.waitFor(() => {
            expect(rede.emVoo.size, `sondas no ar: ${[...rede.emVoo].join(', ')}`).toBe(16)
        })
        expect(cadastro.terminou()).toBe(false)

        // O prazo de uma sonda passa — e é o prazo do cadastro inteiro.
        await vi.advanceTimersByTimeAsync(PRAZO_DO_CADASTRO_MS - (Date.now() - inicio))
        await vi.waitFor(() => expect(cadastro.terminou(), 'o cadastro ainda estava sondando').toBe(true))
        expect(Date.now() - inicio).toBeLessThanOrEqual(PRAZO_DO_CADASTRO_MS + 100)

        const resposta = await cadastro.promessa
        // Salvo (a TV pode só estar desligada)...
        expect(resposta.success).toBe(true)
        expect(resposta.device?.location).toBe(`http://${IP}:9197/dmr`)
        expect(resposta.device?.id).toBe(`manual-${IP}-9197`)
        // ...mas sem fingir que alguém respondeu.
        expect(resposta.unverified, 'o palpite voltou igual a uma TV que respondeu').toBe(true)
        // E nenhuma sonda sobrou pendurada na LAN.
        expect(rede.emVoo.size).toBe(0)
        expect(rede.sondas).toHaveLength(16)
    })

    it('TV ligada: acaba assim que a descrição chega e cancela as sondas que ainda estão no ar', async () => {
        const certa = `http://${IP}:7676/description.xml`
        rede.hostVivo = true
        rede.respondem.set(certa, { atrasoMs: 20, nome: 'TV do Quarto' })
        // 8001 e 8080 descartadas pelo firewall: ficariam 3 s no ar.
        rede.filtradas.add(8001)
        rede.filtradas.add(8080)
        const inicio = Date.now()

        const cadastro = cadastrar({ name: '', ip: IP, port: 9197 })
        await vi.waitFor(() => expect(cadastro.terminou(), 'esperou as sondas mudas antes de fechar o cadastro').toBe(true))
        // Não esperou o prazo das mudas.
        expect(Date.now() - inicio).toBeLessThan(PRAZO_DO_CADASTRO_MS)

        const resposta = await cadastro.promessa
        expect(resposta.success).toBe(true)
        expect(resposta.unverified ?? false).toBe(false)
        expect(resposta.device?.location).toBe(certa)
        expect(resposta.device?.port).toBe(7676)
        expect(resposta.device?.id).toBe(`manual-${IP}-7676`)

        // As 8 sondas das portas filtradas foram canceladas na hora.
        await vi.waitFor(() => expect(rede.emVoo.size).toBe(0))
        expect(rede.abortadas.filter(url => url.includes(':8001/') || url.includes(':8080/'))).toHaveLength(8)
        expect(Date.now() - inicio).toBeLessThan(PRAZO_DO_CADASTRO_MS)
        expect(rede.sondas).toHaveLength(16)
        // E nenhum prazo de sonda ficou armado depois do cadastro: cada
        // leitura desarma o seu relógio (e o ouvinte do sinal-pai) ao terminar.
        expect(vi.getTimerCount(), 'prazo de sonda ficou armado depois do cadastro').toBe(0)
    })

    it('vence a PRIMEIRA NA ORDEM, não a mais rápida: a descrição da 9197 ganha da 7676 que respondeu antes', async () => {
        const preferida = `http://${IP}:9197/dmr`
        const outroServico = `http://${IP}:7676/description.xml`
        rede.hostVivo = true
        rede.respondem.set(preferida, { atrasoMs: 200, nome: 'TV da Sala' })
        rede.respondem.set(outroServico, { atrasoMs: 1, nome: 'Servico Qualquer' })

        const cadastro = cadastrar({ name: '', ip: IP, port: 9197 })
        await vi.waitFor(() => expect(cadastro.terminou()).toBe(true))
        const resposta = await cadastro.promessa

        expect(resposta.unverified ?? false).toBe(false)
        expect(resposta.device?.location, 'a corrida escolheu a descrição mais rápida').toBe(preferida)
        expect(resposta.device?.id).toBe(`manual-${IP}-9197`)
    })

    it('porta preferida filtrada: a de trás que respondeu entra, e o custo não passa do prazo de uma sonda', async () => {
        const certa = `http://${IP}:7676/description.xml`
        rede.hostVivo = true
        rede.filtradas.add(9197)
        rede.respondem.set(certa, { atrasoMs: 5, nome: 'TV do Quarto' })
        const inicio = Date.now()

        const cadastro = cadastrar({ name: '', ip: IP, port: 9197 })
        await vi.waitFor(() => expect(cadastro.terminou()).toBe(true), { timeout: 5000 })
        expect(Date.now() - inicio).toBeLessThanOrEqual(PRAZO_DO_CADASTRO_MS + 100)

        const resposta = await cadastro.promessa
        expect(resposta.unverified ?? false).toBe(false)
        expect(resposta.device?.location).toBe(certa)
        expect(rede.emVoo.size).toBe(0)
    })

    it('guarda: a porta que o dono digitou é sondada primeiro, e a TV que responde nela entra sem aviso', async () => {
        const certa = `http://${IP}:52235/dmr`
        rede.hostVivo = true
        rede.respondem.set(certa, { atrasoMs: 5, nome: 'TV do Quarto' })

        const cadastro = cadastrar({ name: 'Sala', ip: IP, port: 52235 })
        await vi.waitFor(() => expect(cadastro.terminou()).toBe(true))
        const resposta = await cadastro.promessa

        expect(resposta.success).toBe(true)
        expect(resposta.unverified ?? false).toBe(false)
        expect(resposta.device?.location).toBe(certa)
        expect(resposta.device?.id).toBe(`manual-${IP}-52235`)
        // O nome digitado pelo dono vence o friendlyName.
        expect(resposta.device?.name).toBe('Sala')
        // A porta digitada continua na frente da fila de sondas.
        expect(rede.sondas[0]).toBe(certa)
    })
})
