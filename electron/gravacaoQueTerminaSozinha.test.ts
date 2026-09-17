import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * ⏺ Quem DESENHA `rec.recording` também ESCUTA o fim da gravação.
 *
 * A lista de gravações é uma fotografia do `dvr:list-files`: o campo
 * `recording` só vale no instante da consulta (dvrHandlers.ts monta
 * `activeFiles` a partir do mapa `active` e responde). Quando a gravação
 * termina SOZINHA — fim do agendamento, provedor caiu, ⏹ dado em outra
 * janela — o painel "🔴 ao vivo" esvazia pelo poll de 2 s, mas a linha do
 * arquivo continua com o selo GRAVANDO e com ✏️/🎞️/📤/🗑 travados por
 * `disabled={rec.recording}`, até alguém fechar e reabrir o painel.
 *
 * O main já avisa: `broadcast('dvr:stopped', ...)` em todos os desfechos do
 * ffmpeg (close, exit-sem-close e error), hoje centralizados no
 * `finalizeRecording`; canal já liberado no preload (`receiveChannels`) e já
 * consumido pelo DvrNotifyBridge. Faltava a página assinar.
 *
 * O guarda é estrutural porque o repositório não tem `@testing-library/react`
 * (não há um único `*.test.tsx` na árvore), então não dá pra montar a página
 * num teste. Ele mora em `electron/` pelo motivo já documentado no
 * `i18nKeys.test.ts`: o `tsconfig.app.json` não dá `node:fs` a `src/`.
 *
 * `expect(x.includes(y)).toBe(true)` em vez de `toContain`: com `toContain` o
 * vitest despeja o arquivo inteiro no log quando falha.
 */
const DOWNLOADS = path.join(__dirname, '..', 'src', 'pages', 'Downloads.tsx')
const DVR_HANDLERS = path.join(__dirname, 'dvrHandlers.ts')
const PRELOAD = path.join(__dirname, 'preload.ts')

function fonte(arquivo: string): string {
    return fs.readFileSync(arquivo, 'utf-8').split('\r\n').join('\n')
}

describe('gravação que termina sozinha perde o selo GRAVANDO', () => {
    it('a pré-condição continua de pé: o selo e os botões saem de `rec.recording`', () => {
        // Se isto cair, o guarda abaixo virou letra morta e precisa ser
        // REESCRITO contra a nova fonte da verdade — não apagado.
        const texto = fonte(DOWNLOADS)
        expect(texto.includes('{rec.recording && <span')).toBe(true)
        expect((texto.match(/disabled=\{rec\.recording/g) ?? []).length).toBeGreaterThanOrEqual(3)
    })

    it('o main de fato avisa o fim da gravação em TODOS os desfechos do ffmpeg', () => {
        // O conserto do renderer só existe porque este broadcast existe. Se
        // alguém trocar o nome do canal ou remover um dos ramos, o listener
        // da página cala sem avisar.
        //
        // O aviso é UM só desde o grace pós-'exit' (mora no `finalizeRecording`,
        // que é idempotente de propósito); os desfechos do processo é que são
        // três. Quem não passar pelo helper deixa a entrada órfã no mapa — o
        // comportamento está coberto em `dvrHandlers.test.ts`, aqui fica a
        // ponta estrutural: nenhum dos três ramos pode sumir.
        const main = fonte(DVR_HANDLERS)
        const inicio = main.indexOf("ipcMain.handle('dvr:start'")
        const fim = main.indexOf("ipcMain.handle('dvr:rename-file'")
        expect(inicio).toBeGreaterThan(-1)
        expect(fim).toBeGreaterThan(inicio)
        const gravar = main.slice(inicio, fim)
        for (const evento of ["proc.on('close'", "proc.on('exit'", "proc.on('error'"]) {
            expect(gravar.includes(evento), `dvr:start não trata ${evento})`).toBe(true)
        }
        expect((gravar.match(/finalizeRecording\(/g) ?? []).length).toBeGreaterThanOrEqual(3)
        expect((main.match(/broadcast\('dvr:stopped'/g) ?? []).length).toBeGreaterThanOrEqual(1)
        // ...e o canal está liberado para o renderer (senão o `on` lança).
        expect(fonte(PRELOAD).includes("'dvr:stopped',")).toBe(true)
    })

    it('a página de Downloads assina esse aviso', () => {
        const texto = fonte(DOWNLOADS)
        expect(texto.includes("window.ipcRenderer.on('dvr:stopped'")).toBe(true)
        expect(texto.includes("window.ipcRenderer.off('dvr:stopped'")).toBe(true)
    })

    it('e o assinante RECARREGA a lista — não só limpa o painel ao vivo', () => {
        // Recorta só o efeito que assina o canal: do `useEffect(` anterior ao
        // `on` até o `off` correspondente. Sem `split('useEffect(')`, que
        // deixaria o último pedaço vazar até o fim do arquivo.
        const texto = fonte(DOWNLOADS)
        const assina = texto.indexOf("window.ipcRenderer.on('dvr:stopped'")
        expect(assina).toBeGreaterThan(-1)
        const inicio = texto.lastIndexOf('useEffect(', assina)
        const fim = texto.indexOf("window.ipcRenderer.off('dvr:stopped'", assina)
        expect(inicio).toBeGreaterThan(-1)
        expect(fim).toBeGreaterThan(inicio)
        const efeito = texto.slice(inicio, fim)
        expect(efeito.includes('loadRecordings()')).toBe(true)
    })
})
