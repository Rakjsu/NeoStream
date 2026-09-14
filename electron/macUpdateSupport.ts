/**
 * 🍎 No macOS a atualização automática não se instala — e o app precisa dizer isso.
 *
 * O `release.yml` empacota o mac com `CSC_IDENTITY_AUTO_DISCOVERY: false` (não
 * há certificado da Apple no CI, e o README já avisa "sem assinatura da
 * Apple"). O Squirrel.Mac, que é quem o electron-updater usa nessa
 * plataforma, RECUSA aplicar atualização em bundle não assinado. O resultado
 * até aqui era o pior dos mundos: o feed está correto (PR #440), o updater
 * anuncia a versão nova, baixa 167 MB e a instalação simplesmente não
 * acontece — sem erro que explique nada para quem está olhando.
 *
 * A saída escolhida é a honesta e barata: quando o app não está assinado, o
 * mac não tenta baixar. Ele avisa que há versão nova e abre a página da
 * release para a pessoa pegar o `.dmg`. Se um dia houver certificado +
 * notarização, o selo passa a existir dentro do bundle e o caminho automático
 * volta sozinho — sem tocar em código, porque a decisão é medida em tempo de
 * execução, não cravada numa constante.
 *
 * Módulo PURO de propósito (sem `electron`, sem `fs`): o `existe` entra por
 * parâmetro para o teste poder descrever os quatro mundos — Windows, mac em
 * desenvolvimento, mac assinado e mac não assinado.
 */

import path from 'node:path'

/**
 * Onde vive o selo de assinatura de um bundle `.app`, a partir do
 * `app.getAppPath()`.
 *
 * No mac empacotado esse caminho é `<App>.app/Contents/Resources/app.asar`
 * (ou `.../Resources/app` sem asar) — os dois levam ao mesmo `Contents`. É
 * dentro dele que o `codesign` grava `_CodeSignature/CodeResources`; um app
 * não assinado simplesmente não tem esse arquivo (foi assim que a auditoria
 * da v4.49.0 provou que o `.zip` publicado sai sem selo).
 *
 * Devolve `null` quando o caminho não é de um bundle — em desenvolvimento o
 * `getAppPath()` é a pasta do projeto.
 */
export function caminhoDoSeloDeAssinatura(appPath: string): string | null {
    const normalizado = String(appPath ?? '').replace(/\\/g, '/')
    const marca = normalizado.lastIndexOf('.app/Contents/')
    if (marca === -1) return null
    const contents = normalizado.slice(0, marca + '.app/Contents'.length)
    // path.posix: o alvo é sempre macOS, e assim o teste roda igual no Windows.
    return path.posix.join(contents, '_CodeSignature', 'CodeResources')
}

export interface AmbienteDoUpdater {
    /** `process.platform`. */
    plataforma: string
    /** `app.isPackaged`. */
    empacotado: boolean
    /** `app.getAppPath()`. */
    appPath: string
    /** `fs.existsSync`. */
    existe: (caminho: string) => boolean
}

/**
 * O app pode baixar e instalar a atualização sozinho?
 *
 * Só o macOS não assinado responde `não`. Windows e Linux seguem como sempre;
 * fora do pacote o electron-updater já não instala nada por conta própria, e
 * responder `sim` ali mantém o comportamento de desenvolvimento intacto.
 *
 * Bundle que existe mas cujo caminho não sabemos ler cai no lado seguro
 * (`não`): avisar sem necessidade custa um clique; baixar 167 MB para uma
 * instalação que nunca acontece custa a confiança de quem esperou.
 */
export function instalaAtualizacaoSozinho(ambiente: AmbienteDoUpdater): boolean {
    if (ambiente.plataforma !== 'darwin') return true
    if (!ambiente.empacotado) return true

    const selo = caminhoDoSeloDeAssinatura(ambiente.appPath)
    if (!selo) return false
    try {
        return ambiente.existe(selo)
    } catch {
        return false
    }
}

/**
 * Página da release para quem vai baixar à mão.
 *
 * Com a versão anunciada pelo feed, aponta para a tag exata (é a página que
 * traz o `.dmg` daquela versão). Sem ela — o usuário abriu o modal antes de
 * qualquer anúncio —, aponta para `releases/latest`, que nunca fica errada.
 */
export function urlDaRelease(feed: { owner: string; repo: string }, versao?: string | null): string {
    const base = `https://github.com/${feed.owner}/${feed.repo}/releases`
    const limpa = String(versao ?? '').trim()
    if (!limpa) return `${base}/latest`
    const tag = limpa.startsWith('v') ? limpa : `v${limpa}`
    return `${base}/tag/${encodeURIComponent(tag)}`
}
