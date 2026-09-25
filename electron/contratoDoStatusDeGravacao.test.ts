import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { STATUS_DE_GRAVACAO, sanitizarArquivoDeGravacao } from './webRemoteProtocol'

/**
 * 📼 Trava estrutural do contrato de QUATRO camadas do controle web.
 *
 * Tudo que chega no celular atravessa quatro arquivos que nenhum compilador
 * cruza: o bridge do renderer monta o payload e manda pelo IPC, o handler do
 * main recorta campo a campo (whitelist em `webRemoteProtocol.ts`), o mesmo
 * handler remonta um envelope e faz `broadcast`, e a página do celular
 * consome — e a página é uma STRING de JavaScript dentro de
 * `webRemotePage.ts`, onde o tsc nem olha.
 *
 * Foi por aí que os defeitos entraram calados: os status 'renamed' /
 * 'protected' / 'unprotected' e o campo `locked` morriam no handler do main
 * sem uma linha vermelha (consertado no #462, commit 9001365). E o defeito
 * nasceu exatamente na CAMADA DO MEIO — o handler tinha a lista de status
 * escrita à mão, em vez de chamar o sanitizador. Uma trava que só case
 * "bridge × whitelist × página" deixa esse renascimento passar verde: basta
 * alguém reescrever a lista dentro de `webRemoteServer.ts`.
 *
 * Por isso este teste lê os QUATRO fontes e confere, nos dois sentidos:
 *  - o canal em que o bridge manda é o canal que o main escuta;
 *  - as chaves do payload do bridge são as que o handler lê;
 *  - o handler DELEGA aos sanitizadores (nada de whitelist inline);
 *  - o `type` do envelope tem ramo na página;
 *  - os campos do envelope são exatamente os que a página lê;
 *  - todo status do bridge está na whitelist, toda entrada da whitelist é
 *    emitida, todo status tem ramo na página e todo ramo é alcançável.
 */

const RAIZ = path.join(__dirname, '..')
// Os fontes são CRLF: sem normalizar, os recortes por marcador erram em
// silêncio no Windows e o teste passa por acidente.
const semCR = (texto: string) => texto.split(String.fromCharCode(13)).join('')

/**
 * Remove comentários (mantendo o que está dentro de string), porque os
 * recortes abaixo procuram marcadores de código: um `// ... (the phone's ⏺)`
 * no meio de um handler desalinhava o contador de aspas e de parênteses.
 */
function semComentarios(fonte: string): string {
    let saida = ''
    let aspas = ''
    for (let i = 0; i < fonte.length; i++) {
        const c = fonte[i]
        if (aspas) {
            saida += c
            if (c === '\\') { saida += fonte[i + 1] ?? ''; i++ }
            else if (c === aspas) aspas = ''
            continue
        }
        if (c === "'" || c === '"' || c === '`') { aspas = c; saida += c; continue }
        if (c === '/' && fonte[i + 1] === '/') {
            while (i < fonte.length && fonte[i] !== '\n') i++
            saida += '\n'
            continue
        }
        if (c === '/' && fonte[i + 1] === '*') {
            i += 2
            while (i < fonte.length && !(fonte[i] === '*' && fonte[i + 1] === '/')) i++
            i++
            saida += ' '
            continue
        }
        saida += c
    }
    return saida
}

const BRIDGE = semComentarios(semCR(fs.readFileSync(path.join(RAIZ, 'src', 'components', 'WebRemoteBridge.tsx'), 'utf8')))
const SERVIDOR = semComentarios(semCR(fs.readFileSync(path.join(__dirname, 'webRemoteServer.ts'), 'utf8')))
// A página é lida COM comentários: o que interessa nela são os ramos
// `msg.status === '...'`, e o JS servido pro celular quase não tem comentário.
const PAGINA = semCR(fs.readFileSync(path.join(__dirname, 'webRemotePage.ts'), 'utf8'))

/** Fallback do sanitizador: não está na whitelist, mas a página trata no `else`. */
const FALLBACK = 'error'

const CANAL_RESULTADO = 'web-remote:record-result'
const CANAL_LISTA = 'web-remote:recordings'

/** Do índice de um `(`, devolve o trecho até o `)` que o fecha. */
function grupoBalanceado(fonte: string, abre: number, ab: string, fe: string): string {
    let nivel = 0
    let aspas = ''
    let j = abre
    for (; j < fonte.length; j++) {
        const c = fonte[j]
        if (aspas) {
            if (c === '\\') j++
            else if (c === aspas) aspas = ''
            continue
        }
        if (c === "'" || c === '"' || c === '`') { aspas = c; continue }
        if (c === ab) nivel++
        else if (c === fe) { nivel--; if (nivel === 0) break }
    }
    return fonte.slice(abre, j + 1)
}

/** Todas as chamadas `.send('<canal>', …)` do bridge, com parênteses balanceados. */
function chamadasDeSend(fonte: string, canal: string): string[] {
    const saida: string[] = []
    const marca = `.send('${canal}'`
    let i = fonte.indexOf(marca)
    while (i !== -1) {
        const trecho = grupoBalanceado(fonte, fonte.indexOf('(', i), '(', ')')
        saida.push(trecho)
        i = fonte.indexOf(marca, i + trecho.length)
    }
    return saida
}

/** O objeto literal de 1º nível dentro de um trecho (o payload do send). */
function objetoLiteral(trecho: string, apartirDe = 0): string {
    const abre = trecho.indexOf('{', apartirDe)
    return abre === -1 ? '' : grupoBalanceado(trecho, abre, '{', '}')
}

/** Partes de 1º nível de um objeto literal (`{ a: x, b, c: y ? 1 : 2 }`). */
function partesDoObjeto(objeto: string): string[] {
    const corpo = objeto.slice(1, -1)
    const partes: string[] = []
    let nivel = 0
    let aspas = ''
    let atual = ''
    for (let i = 0; i < corpo.length; i++) {
        const c = corpo[i]
        if (aspas) {
            atual += c
            if (c === '\\') { atual += corpo[i + 1] ?? ''; i++ }
            else if (c === aspas) aspas = ''
            continue
        }
        if (c === "'" || c === '"' || c === '`') { aspas = c; atual += c; continue }
        if (c === '{' || c === '(' || c === '[') nivel++
        else if (c === '}' || c === ')' || c === ']') nivel--
        if (c === ',' && nivel === 0) { partes.push(atual); atual = ''; continue }
        atual += c
    }
    if (atual.trim()) partes.push(atual)
    return partes.filter(p => p.trim())
}

/** Chaves de 1º nível, contando as abreviadas (`{ status: x, name }`). */
function chavesDoObjeto(objeto: string): string[] {
    return partesDoObjeto(objeto).map(p => {
        const dp = p.indexOf(':')
        return (dp === -1 ? p : p.slice(0, dp)).trim()
    }).filter(k => /^\w+$/.test(k))
}

/** O valor bruto de uma chave de 1º nível. */
function valorDaChave(objeto: string, chave: string): string {
    for (const p of partesDoObjeto(objeto)) {
        const dp = p.indexOf(':')
        if (dp !== -1 && p.slice(0, dp).trim() === chave) return p.slice(dp + 1)
    }
    return ''
}

/**
 * O corpo de um `ipcMain.on('<canal>', …)` do servidor: da marca até o
 * PRÓXIMO `ipcMain.` (mesma técnica do webRemoteRoutes.test.ts, que fatia até
 * a próxima rota em vez de contar parênteses de um bloco enorme).
 */
function handlerDoMain(canal: string): string {
    const inicio = SERVIDOR.indexOf(`ipcMain.on('${canal}'`)
    expect(
        inicio,
        `o main não escuta mais '${canal}' — o send do bridge cai no vazio (ou o teste precisa ser reapontado)`,
    ).toBeGreaterThan(-1)
    const proximo = SERVIDOR.indexOf('ipcMain.', inicio + 10)
    return SERVIDOR.slice(inicio, proximo > inicio ? proximo : SERVIDOR.length)
}

/** O envelope que o handler manda pro celular: `broadcast(JSON.stringify({ … }))`. */
function envelopeDoHandler(corpo: string): string {
    const k = corpo.indexOf('broadcast(JSON.stringify(')
    expect(k, 'o handler não faz mais broadcast — reaponte o teste').toBeGreaterThan(-1)
    return objetoLiteral(corpo, k)
}

/** O ramo `msg.type === '<tipo>'` da página, até o próximo `msg.type ===`. */
function ramoDaPagina(tipo: string): string {
    const marca = `msg.type === '${tipo}'`
    const inicio = PAGINA.indexOf(marca)
    expect(inicio, `a página não tem ramo para o envelope '${tipo}'`).toBeGreaterThan(-1)
    const proximo = PAGINA.indexOf('msg.type ===', inicio + marca.length)
    return PAGINA.slice(inicio, proximo > inicio ? proximo : PAGINA.length)
}

/** Campos `msg.<x>` lidos dentro de um ramo da página. */
function camposLidos(ramo: string): string[] {
    return [...new Set([...ramo.matchAll(/msg\.(\w+)/g)].map(m => m[1]))]
}

const CHAMADAS = chamadasDeSend(BRIDGE, CANAL_RESULTADO)
const PAYLOADS = CHAMADAS.map(c => objetoLiteral(c))
const STATUS_DO_BRIDGE = [...new Set(
    PAYLOADS.flatMap(p => [...valorDaChave(p, 'status').matchAll(/'([^']*)'/g)].map(m => m[1])),
)]
const RAMO_RESULTADO = ramoDaPagina('recordResult')
const STATUS_DA_PAGINA = [...new Set(
    [...RAMO_RESULTADO.matchAll(/msg\.status === '([^']+)'/g)].map(m => m[1]),
)]
const ACEITOS = [...STATUS_DE_GRAVACAO, FALLBACK]

describe('contrato de status de gravação: bridge → IPC → handler → página', () => {
    it('os extratores acharam as quatro pontas (senão o teste passaria vazio)', () => {
        // Sem esta âncora, qualquer refactor que quebre um recorte deixa os
        // conjuntos vazios e o teste vira verde justamente quando não deveria.
        expect(CHAMADAS.length, `nenhum send de ${CANAL_RESULTADO} no bridge`).toBeGreaterThanOrEqual(8)
        expect(STATUS_DO_BRIDGE.length, 'nenhum literal de status extraído do bridge').toBeGreaterThanOrEqual(7)
        expect(STATUS_DA_PAGINA.length, 'nenhum ramo msg.status na página').toBeGreaterThanOrEqual(7)
        for (const payload of PAYLOADS) {
            expect(
                valorDaChave(payload, 'status').includes("'"),
                `send sem literal de status (status dinâmico não dá pra conferir): ${payload.slice(0, 120)}`,
            ).toBe(true)
        }
    })

    it('todo status que o bridge emite passa pelo sanitizador', () => {
        // Este é o defeito do #462 acontecendo de novo: status novo no bridge
        // que a whitelist não conhece vira 'error' e a página mente pro dono.
        const engolidos = STATUS_DO_BRIDGE.filter(s => !ACEITOS.includes(s))
        expect(
            engolidos,
            `status emitido pelo bridge e ausente da whitelist (vira 'error' calado): ${engolidos.join(', ')}`,
        ).toHaveLength(0)
    })

    it('toda entrada da whitelist é realmente emitida por alguém', () => {
        const ociosos = STATUS_DE_GRAVACAO.filter(s => !STATUS_DO_BRIDGE.includes(s))
        expect(
            ociosos,
            `whitelist aceita status que ninguém emite (fonte morta ou bridge que parou de mandar): ${ociosos.join(', ')}`,
        ).toHaveLength(0)
    })

    it('a página sabe desenhar cada status da whitelist', () => {
        const semRamo = STATUS_DE_GRAVACAO.filter(s => !STATUS_DA_PAGINA.includes(s))
        expect(
            semRamo,
            `status entregue ao celular e sem ramo na página (cai no else = "Falha ao iniciar a gravação"): ${semRamo.join(', ')}`,
        ).toHaveLength(0)
    })

    it('nenhum ramo da página espera um status que o servidor nunca entrega', () => {
        const mortos = STATUS_DA_PAGINA.filter(s => !ACEITOS.includes(s))
        expect(
            mortos,
            `ramo da página inalcançável — o sanitizador nunca deixa passar: ${mortos.join(', ')}`,
        ).toHaveLength(0)
    })
})

describe('a camada do meio (webRemoteServer) não pode reescrever o contrato', () => {
    // O #462 NASCEU aqui: o handler tinha a lista de status escrita à mão e
    // engolia três status que a página já sabia desenhar. Enquanto o handler
    // puder decidir sozinho, casar "bridge × whitelist × página" não prova
    // nada — o dado nem passa por onde o teste olha.
    const CORPO_RESULTADO = handlerDoMain(CANAL_RESULTADO)
    const CORPO_LISTA = handlerDoMain(CANAL_LISTA)

    it('o handler do resultado DELEGA ao sanitizador de status', () => {
        expect(
            CORPO_RESULTADO.includes('sanitizarStatusDeGravacao('),
            'o handler de record-result decide o status sozinho — é a whitelist inline do #462 renascendo, '
            + 'e a lista congelada em gravacaoNoCelular.test.ts deixa de valer pro que chega no celular',
        ).toBe(true)
    })

    it('o handler da lista DELEGA ao sanitizador de arquivo', () => {
        expect(
            CORPO_LISTA.includes('sanitizarArquivoDeGravacao'),
            'o handler de recordings remonta o arquivo à mão — foi assim que o campo `locked` sumiu antes do #462',
        ).toBe(true)
    })

    it.each([
        [CANAL_RESULTADO, CORPO_RESULTADO],
        [CANAL_LISTA, CORPO_LISTA],
    ])('o payload que o bridge manda em %s é exatamente o que o handler lê', (canal, corpo) => {
        const enviadas = [...new Set(chamadasDeSend(BRIDGE, canal).flatMap(c => chavesDoObjeto(objetoLiteral(c))))]
        expect(enviadas.length, `nenhuma chave extraída do payload de ${canal}`).toBeGreaterThan(0)
        const lidas = [...new Set([...corpo.matchAll(/obj\.(\w+)/g)].map(m => m[1]))]
        const ignoradas = enviadas.filter(k => !lidas.includes(k))
        expect(ignoradas, `campo que o bridge manda e o handler nunca lê: ${ignoradas.join(', ')}`).toHaveLength(0)
        const inventadas = lidas.filter(k => !enviadas.includes(k))
        expect(inventadas, `campo que o handler lê e ninguém manda (fica sempre vazio): ${inventadas.join(', ')}`).toHaveLength(0)
    })

    it.each([
        [CANAL_RESULTADO, CORPO_RESULTADO],
        [CANAL_LISTA, CORPO_LISTA],
    ])('o envelope que %s manda pro celular é exatamente o que a página lê', (_canal, corpo) => {
        const envelope = envelopeDoHandler(corpo)
        const tipo = (valorDaChave(envelope, 'type').match(/'([^']+)'/) ?? [])[1] ?? ''
        expect(tipo, 'o envelope não tem um `type` literal — a página casa por string').not.toBe('')
        // ramoDaPagina falha aqui se o `type` mudar no servidor e a página
        // continuar esperando o nome antigo (o celular fica mudo, sem erro).
        const lidos = camposLidos(ramoDaPagina(tipo))
        const enviados = chavesDoObjeto(envelope)
        const perdidos = lidos.filter(k => !enviados.includes(k))
        expect(perdidos, `a página lê msg.${perdidos.join(', msg.')} e o envelope '${tipo}' não manda`).toHaveLength(0)
        const mudos = enviados.filter(k => !lidos.includes(k))
        expect(mudos, `o envelope '${tipo}' manda campo que a página nunca lê: ${mudos.join(', ')}`).toHaveLength(0)
    })
})

describe('contrato do arquivo de gravação: bridge → sanitizador → página', () => {
    const CHAMADA_RECS = chamadasDeSend(BRIDGE, CANAL_LISTA)[0] ?? ''

    /** O objeto literal do `.map` do campo `files:` do bridge. */
    function objetoDeArquivo(): string {
        const payload = objetoLiteral(CHAMADA_RECS)
        const files = valorDaChave(payload, 'files')
        expect(files, `o campo files sumiu do send ${CANAL_LISTA} — reaponte o teste`).not.toBe('')
        const abre = files.indexOf('({')
        expect(abre, 'o .map do files não é mais um objeto literal — reaponte o teste').toBeGreaterThan(-1)
        return grupoBalanceado(files, abre + 1, '{', '}')
    }

    const CHAVES_DO_BRIDGE = chavesDoObjeto(objetoDeArquivo())

    /** O laço que desenha as gravações prontas no cartão do celular. */
    function lacoDosArquivos(): string {
        const inicio = PAGINA.indexOf('for (var fi = 0; fi < recsData.files.length')
        expect(inicio, 'o laço dos arquivos sumiu da página — reaponte o teste').toBeGreaterThan(-1)
        const fim = PAGINA.indexOf('recfilesEl.innerHTML', inicio)
        return PAGINA.slice(inicio, fim > inicio ? fim : PAGINA.length)
    }

    it('o extrator achou o payload do arquivo', () => {
        expect(CHAVES_DO_BRIDGE.length, 'nenhuma chave extraída do files do bridge').toBeGreaterThanOrEqual(3)
    })

    it('o sanitizador repassa exatamente as chaves que o bridge manda', () => {
        // `locked` nascia aqui e morria no sanitizador: o 🔐 nunca aparecia na
        // lista do celular e o 🗑 recusava o arquivo sem a tela saber por quê.
        const repassadas = Object.keys(sanitizarArquivoDeGravacao(null))
        const perdidas = CHAVES_DO_BRIDGE.filter(c => !repassadas.includes(c))
        expect(perdidas, `campo montado pelo bridge e descartado pelo sanitizador: ${perdidas.join(', ')}`).toHaveLength(0)
        const inventadas = repassadas.filter(c => !CHAVES_DO_BRIDGE.includes(c))
        expect(inventadas, `campo que o sanitizador cria e ninguém alimenta: ${inventadas.join(', ')}`).toHaveLength(0)
    })

    it('a página lê cada campo do arquivo DENTRO do laço que desenha a lista', () => {
        // Escopado de propósito: um `f.name` de outro renderizador não pode
        // dar por satisfeito o campo que ESTA lista precisa.
        const laco = lacoDosArquivos()
        const ignoradas = CHAVES_DO_BRIDGE.filter(c => !laco.includes(`f.${c}`))
        expect(ignoradas, `campo entregue ao celular e nunca lido pela lista: ${ignoradas.join(', ')}`).toHaveLength(0)
    })
})
