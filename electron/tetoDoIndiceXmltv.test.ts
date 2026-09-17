import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 📺 O teto de índices de XMLTV vivos tem que caber em TODOS os grupos.
 *
 * O `XMLTV_INDEX_MAX` do main limita quantos índices de XMLTV ficam em memória
 * ao mesmo tempo, e o despejo é LRU. Quem escolhe o grupo é o renderer, por
 * CANAL: `user-external` (o XMLTV que a pessoa configurou, consultado antes de
 * todo canal) mais um país por canal — portugal, argentina, usa, brazil.
 *
 * O teto nasceu em 2 (#370) com a conta errada de "o país corrente + o do
 * usuário". Com 5 grupos possíveis e 2 slots, uma grade misturada despeja o
 * índice do vizinho a cada linha e cada miss relê e reparseia o grupo inteiro
 * de forma síncrona no main (até 2 s de thread travada no guia dos EUA, ver o
 * cabeçalho de `electron/epgIndexProtocol.ts`).
 *
 * O invariante é ENTRE dois arquivos e o compilador não liga um no outro, por
 * isso o guarda é estrutural: quem acrescentar um `'espanha'` em `epgService`
 * sem subir o teto fica vermelho aqui, em vez de o thrash voltar em silêncio.
 */
const RAIZ = path.join(__dirname, '..')
const EPG_SERVICE = path.join(RAIZ, 'src', 'services', 'epgService.ts')
const IPC_HANDLERS = path.join(RAIZ, 'electron', 'ipcHandlers.ts')

/** Os literais de grupo que o renderer manda em `epg:channel-programs`. */
function gruposDoRenderer(): string[] {
    const fonte = fs.readFileSync(EPG_SERVICE, 'utf-8')
    // O `this.` é de propósito: sem ele a regex casaria também a DEFINIÇÃO do
    // método e contaria um grupo fantasma chamado `grupo`.
    const re = /this\.fetchIndexedChannel\(\s*'([^']+)'/g
    const grupos = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = re.exec(fonte)) !== null) grupos.add(m[1])
    return [...grupos].sort()
}

/** O teto de índices vivos declarado no main. */
function tetoDoMain(): number {
    const fonte = fs.readFileSync(IPC_HANDLERS, 'utf-8')
    const m = /const XMLTV_INDEX_MAX\s*=\s*(\d+)/.exec(fonte)
    if (!m) throw new Error('XMLTV_INDEX_MAX sumiu de electron/ipcHandlers.ts')
    return Number(m[1])
}

describe('teto do índice de XMLTV', () => {
    it('cabe em todos os grupos que o renderer sabe pedir', () => {
        const grupos = gruposDoRenderer()
        expect(grupos.length).toBeGreaterThan(0)
        expect(tetoDoMain()).toBeGreaterThanOrEqual(grupos.length)
    })

    it('a lista de grupos é a conhecida (pino: mexeu num lado, mexa no outro)', () => {
        expect(gruposDoRenderer()).toEqual(
            ['argentina', 'brazil', 'portugal', 'usa', 'user-external'],
        )
    })
})
