/**
 * 📐 Onde a janela estava da última vez (D121).
 *
 * A principal abria SEMPRE em 1200×800 na posição padrão — num app que fica na
 * bandeja e é reaberto várias vezes por dia, era redimensionar e arrastar pro
 * monitor secundário a cada boot. O PiP já lembrava os próprios bounds
 * (pipHandlers.ts); a principal agora usa o mesmo mecanismo, e a checagem de
 * visibilidade mora AQUI, uma vez só, para as duas.
 *
 * Fora de escopo de propósito: o estado de "maximizado" (o maximizar é próprio,
 * bounds na workArea, e vive só em memória no ipcHandlers.ts). Esta peça guarda
 * só a geometria da janela normal — e por isso NÃO grava a geometria do
 * maximizado nem a da tela cheia como se fosse o tamanho normal.
 *
 * Só `import type` de 'electron': o módulo é puro e testável sem Electron. O
 * main.ts só entrega o Store e o `screen` para `prepararJanelaPrincipal`; a
 * chave lida e a gravada, a escolha do monitor e os ouvintes moram aqui.
 */
import type { Rectangle } from 'electron'

/** Tamanho de fábrica da principal (o que o createWindow usava fixo). */
export const TAMANHO_PADRAO_DA_JANELA = { width: 1200, height: 800 } as const

/** Menor janela que o boot aceita reabrir — abaixo disso, cresce até aqui. */
export const TAMANHO_MINIMO_DA_JANELA = { width: 320, height: 240 } as const

/** Folga ao reconhecer o maximizado próprio: o vaivém DIP↔pixel pode arredondar 1 px. */
const FOLGA_DO_MAXIMIZADO = 2

export interface MonitorComBounds { bounds: Rectangle }
export interface Monitor extends MonitorComBounds { workArea: Rectangle }

/**
 * O canto superior esquerdo cai num monitor conectado? (tolerância de 8 px pra
 * janela encostada na borda). É ela que evita reabrir fora da tela quando o
 * monitor em que a janela estava foi desconectado.
 */
export function boundsVisiveis(b: Rectangle, monitores: readonly MonitorComBounds[]): boolean {
    return monitores.some(d =>
        b.x >= d.bounds.x - 8 && b.x < d.bounds.x + d.bounds.width &&
        b.y >= d.bounds.y - 8 && b.y < d.bounds.y + d.bounds.height)
}

/** O que veio do disco só vale se for um retângulo de números finitos e área positiva. */
export function lerBoundsSalvos(valor: unknown): Rectangle | null {
    if (!valor || typeof valor !== 'object') return null
    const v = valor as Record<string, unknown>
    const campos = [v.x, v.y, v.width, v.height]
    if (!campos.every(n => typeof n === 'number' && Number.isFinite(n))) return null
    const [x, y, width, height] = campos as number[]
    if (width <= 0 || height <= 0) return null
    return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

/**
 * Bounds para o `new BrowserWindow` da principal: os salvos, se ainda caem num
 * monitor conectado (recortados à workArea dele — resolução que baixou não pode
 * abrir uma janela maior que a tela); senão, o tamanho de fábrica sem x/y (o
 * Electron centraliza).
 */
export function boundsIniciaisDaJanelaPrincipal(
    salvo: unknown,
    monitores: readonly Monitor[],
): Rectangle | { width: number; height: number } {
    const b = lerBoundsSalvos(salvo)
    const monitor = b ? monitores.find(d => boundsVisiveis(b, [d])) : undefined
    if (!b || !monitor) return { ...TAMANHO_PADRAO_DA_JANELA }
    const area = monitor.workArea
    return {
        x: b.x,
        y: b.y,
        width: Math.max(TAMANHO_MINIMO_DA_JANELA.width, Math.min(b.width, area.width)),
        height: Math.max(TAMANHO_MINIMO_DA_JANELA.height, Math.min(b.height, area.height)),
    }
}

/** É a geometria do maximizado próprio do ipcHandlers (setBounds na workArea)? */
function ocupaAWorkArea(b: Rectangle, area: Rectangle): boolean {
    return Math.abs(b.x - area.x) <= FOLGA_DO_MAXIMIZADO &&
        Math.abs(b.y - area.y) <= FOLGA_DO_MAXIMIZADO &&
        Math.abs(b.width - area.width) <= FOLGA_DO_MAXIMIZADO &&
        Math.abs(b.height - area.height) <= FOLGA_DO_MAXIMIZADO
}

/** O pedaço da BrowserWindow que isto usa (a janela de verdade satisfaz). */
export interface JanelaComBounds {
    on(evento: 'moved' | 'resized' | 'close', ouvinte: () => void): unknown
    getBounds(): Rectangle
    isDestroyed(): boolean
    isMinimized(): boolean
    isFullScreen(): boolean
}

/**
 * Grava os bounds ao mover/redimensionar (e ao fechar/esconder na bandeja, que
 * cobre o Linux, onde 'moved'/'resized' não existem).
 *
 * Não grava:
 * - janela minimizada (no Windows os bounds dela podem vir em -32000);
 * - tela cheia (o player usa requestFullscreen: fechar/Alt+F4 nela gravaria o
 *   monitor inteiro como tamanho normal);
 * - a geometria do maximizado próprio (bounds == workArea do monitor): senão o
 *   próximo boot abriria "maximizado" com o app achando que não está, e o
 *   botão de maximizar viraria um no-op.
 *
 * Falha ao gravar (disco cheio, arquivo travado) não pode derrubar o main:
 * o ouvinte roda num evento nativo, sem ninguém para pegar a exceção.
 */
export function lembrarBoundsDaJanela(
    win: JanelaComBounds,
    gravar: (b: Rectangle) => void,
    workAreaDe: (b: Rectangle) => Rectangle,
): void {
    const persistir = () => {
        try {
            if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
            const b = win.getBounds()
            if (ocupaAWorkArea(b, workAreaDe(b))) return
            gravar(b)
        } catch {
            /* lembrar a posição é conveniência; nunca motivo de erro */
        }
    }
    win.on('moved', persistir)
    win.on('resized', persistir)
    win.on('close', persistir)
}

/** O arquivo onde a posição mora (o electron-store 'window-state' satisfaz). */
export interface ArquivoDoEstadoDaJanela {
    get(chave: 'mainBounds'): unknown
    set(chave: 'mainBounds', valor: Rectangle): void
}

/** O pedaço do `screen` do Electron que isto usa. */
export interface TelaDoSistema {
    getAllDisplays(): Monitor[]
    getDisplayMatching(r: Rectangle): Monitor
}

/**
 * Ponto único de uso no main.ts: lê o arquivo UMA vez, devolve os bounds para
 * o construtor e liga a gravação na janela criada. Arquivo ilegível só custa a
 * lembrança, nunca a abertura do app (abre no tamanho de fábrica e não grava).
 */
export function prepararJanelaPrincipal(
    abrirArquivo: () => ArquivoDoEstadoDaJanela,
    tela: TelaDoSistema,
    avisar: (mensagem: string, erro: unknown) => void,
): { bounds: ReturnType<typeof boundsIniciaisDaJanelaPrincipal>; lembrar: (win: JanelaComBounds) => void } {
    let arquivo: ArquivoDoEstadoDaJanela | null = null
    let salvo: unknown
    try {
        arquivo = abrirArquivo()
        salvo = arquivo.get('mainBounds')
    } catch (e) {
        avisar('[Janela] window-state ilegível — abrindo no tamanho padrão:', e)
        salvo = undefined
    }
    const destino = arquivo
    return {
        bounds: boundsIniciaisDaJanelaPrincipal(salvo, tela.getAllDisplays()),
        lembrar: (win) => {
            if (!destino) return
            lembrarBoundsDaJanela(win, b => destino.set('mainBounds', b), b => tela.getDisplayMatching(b).workArea)
        },
    }
}
