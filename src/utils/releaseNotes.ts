/**
 * As "novidades" que o modal pós-update mostra, a partir do corpo da release.
 *
 * O corpo tem DUAS formas, e confundi-las é o defeito:
 *
 *  - **escrita à mão** (o caso normal): prosa em português, com títulos de
 *    seção. É o que o dono publica reescrevendo por cima do automático;
 *  - **auto-gerada** pelo GitHub (`generate_release_notes` no release.yml): um
 *    `## What's Changed`, uma linha `* <título do PR> by @user in <url>` por
 *    PR, e um `**Full Changelog**`. É o que fica no ar na janela entre a tag
 *    subir e o dono reescrever.
 *
 * A limpeza agressiva (tirar o sufixo `by @… in <url>`, o prefixo de
 * conventional commit, o ruído de `chore:`/`ci:`) só faz sentido na forma
 * auto-gerada. Aplicada à prosa escrita à mão, ela estraga o texto bom.
 */

/** Sufixo que o GitHub cola em cada linha: ` by @fulano in <url do PR>`. */
const AUTOR_E_PR = /\s+by\s+@[\w.-]+(?:\[bot\])?\s+in\s+https?:\/\/\S+$/i;

/**
 * Títulos e rodapé do formato automático. `Full Changelog` NÃO fecha com `$`:
 * a linha real é `**Full Changelog**: <url de compare>`.
 */
const TITULO_AUTOMATICO = /^(what's changed|new contributors)$|^full changelog/i;

/** `fix(deps): …`, `chore: …` — o prefixo de conventional commit. */
const PREFIXO_COMMIT = /^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(\([^)]*\))?!?:\s*/i;

/** Tipos e escopos que não são novidade para quem usa o app. */
const SO_PRA_DENTRO = /^(chore|ci|build|test|docs|style|refactor|revert)(\([^)]*\))?!?:/i;
const ESCOPO_INTERNO = /^(feat|fix|perf)\((deps|ci|e2e|build|test|lint|tooling)\)!?:/i;

/**
 * O corpo veio pronto do GitHub, sem ninguém reescrever?
 *
 * Reconhecer isso é o que separa "limpar lixo" de "estragar texto bom".
 */
export function pareceAutoGerada(corpo: string): boolean {
    return /^#{1,6}\s*what's changed\s*$/im.test(corpo)
        || /\sby\s+@[\w.-]+(?:\[bot\])?\s+in\s+https?:\/\/\S+\/pull\/\d+/i.test(corpo);
}

/** Uma linha vira item de novidade, ou null quando é ruído. */
function itemDaLinha(linha: string, automatica: boolean): string | null {
    // O negrito sai ANTES do marcador de lista: em `**Full Changelog**: …` o
    // `*` do negrito seria confundido com bullet, e a linha escaparia do filtro.
    let texto = linha
        .replace(/\*\*/g, '')
        .replace(/^#+\s*/, '')      // título de seção continua sendo item — é a parte mais legível
        .replace(/^[-*]\s+/, '')
        .trim();

    if (!texto) return null;
    if (texto.startsWith('🤖')) return null;
    if (/^\[/.test(texto)) return null;
    if (TITULO_AUTOMATICO.test(texto)) return null;
    // Régua horizontal e o rodapé em itálico que as releases escritas à mão usam.
    if (/^-{3,}$/.test(texto) || /^_.*_$/.test(texto)) return null;

    if (!automatica) return texto;

    // Daqui pra baixo, só corpo auto-gerado.
    texto = texto.replace(AUTOR_E_PR, '').trim();
    if (/made their first contribution/i.test(texto)) return null;
    if (SO_PRA_DENTRO.test(texto) || ESCOPO_INTERNO.test(texto)) return null;
    texto = texto.replace(PREFIXO_COMMIT, '').trim();
    if (!texto) return null;
    return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Novidades legíveis a partir do corpo da release (no máximo `limite`). */
export function novidadesDaRelease(corpo: string, limite = 16): string[] {
    const automatica = pareceAutoGerada(corpo);
    const itens: string[] = [];
    for (const linha of corpo.split('\n')) {
        const item = itemDaLinha(linha, automatica);
        if (item) itens.push(item);
        if (itens.length >= limite) break;
    }
    return itens;
}
