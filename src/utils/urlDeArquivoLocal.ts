/**
 * Caminho NATIVO de um arquivo do disco -> URL `file:` que o app entrega ao
 * player (Chromium ou mpv) e ao `<img>`. PURO: sem DOM, sem React, sem Node.
 *
 *   Windows  `C:\Videos\a.ts`  -> `file:///C:/Videos/a.ts`
 *   POSIX    `/home/rak/a.ts`  -> `file:///home/rak/a.ts`
 *
 * Por que existe: o app montava a URL em sete lugares com
 * `file:///${caminho.replace(/\\/g, '/')}` — certo no Windows e errado no
 * Linux e no macOS, onde o caminho JÁ começa com `/` e saía
 * `file:////home/...` (QUATRO barras). O Chromium engole a barra a mais, mas
 * a guarda do mpv (`caminhoDeMidiaNoDisco`, electron/mpvProtocol.ts) lê
 * `file:////x` como caminho de REDE (UNC `//servidor/share`) e recusa — fora
 * do Windows o MPV não tocava gravação do DVR nem download offline.
 *
 * É o inverso exato de `caminhoDeMidiaNoDisco`, e as duas pontas combinam:
 *   - NADA é codificado (sem `encodeURI`): a guarda não faz
 *     `decodeURIComponent`, porque isso estragaria um nome com `%` de verdade.
 *     Espaço e acento vão literais — o Chromium codifica sozinho ao carregar.
 *   - Caminho POSIX não tem a `\` trocada: lá ela é caractere válido de nome
 *     de arquivo, não separador. Só o estilo Windows (letra de unidade) vira
 *     `/`.
 *
 * O main também usa (electron/downloadHandlers.ts, capa em cache): é o
 * primeiro import de `../src` em código de produção do main — o bundle do
 * vite-plugin-electron embute o módulo em dist-electron/main.js. Por isso ele
 * tem de continuar PURO (nada de DOM, React, `window` ou Node). Uma cópia em
 * electron/ deixaria as duas grafias divergirem de novo. Guardado por
 * electron/mpvTocaArquivoDoDisco.test.ts, que monta a URL por AQUI.
 */
export function urlDeArquivoLocal(caminho: string): string {
    // POSIX: o `/` inicial É a raiz — `file://` + caminho dá as três barras.
    if (caminho.startsWith('/')) return `file://${caminho}`
    // Windows (`C:\x`, `C:/x`): a terceira barra é só separador antes da letra.
    return `file:///${caminho.replace(/\\/g, '/')}`
}
