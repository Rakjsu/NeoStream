/**
 * Remapeia o escopo `__pl_<id>` das chaves que vieram de OUTRA máquina.
 *
 * O id da playlist nasce local e aleatório (`createPlaylistId`, em
 * electron/playlistsModel.ts) e escopa TODO o estado do usuário
 * (`${base}_${profileId}__pl_${playlistId}` — activePlaylistService.ts).
 * Num restore/sync a mesma playlist (mesma url+username) recebe um id NOVO
 * nesta máquina: sem reescrever o sufixo, favoritos, progresso, fila e
 * "assistir depois" chegam como dados MORTOS — a tela abre vazia e o backup
 * parece ter perdido tudo.
 *
 * De propósito PURO (e sem IPC): quem tem IPC (App.tsx, BackupSection.tsx,
 * Welcome.tsx) só entrega o mapa {idDoArquivo -> idLocal} que o import das
 * playlists devolve.
 */

/** O separador que `playlistScopedKeyFor` usa — dono do formato é ele. */
const SEP = '__pl_';

/**
 * Reescreve, no mapa de dados do arquivo, o sufixo `__pl_<idDeLá>` para
 * `__pl_<idDaqui>`. Chave sem sufixo, ou cuja playlist não entrou nesta
 * máquina, passa INTACTA — exatamente o que já acontecia hoje.
 */
export function remapPlaylistScopedKeys(
    data: Record<string, string>,
    idMap: Record<string, string> | null | undefined,
): Record<string, string> {
    if (!idMap || Object.keys(idMap).length === 0) return { ...data };

    const result: Record<string, string> = {};
    const reescritas: [string, string][] = [];

    for (const [key, value] of Object.entries(data)) {
        const corte = key.lastIndexOf(SEP);
        const idDoArquivo = corte === -1 ? '' : key.slice(corte + SEP.length);
        const idLocal = idDoArquivo && Object.prototype.hasOwnProperty.call(idMap, idDoArquivo)
            ? idMap[idDoArquivo]
            : undefined;

        if (!idLocal || idLocal === idDoArquivo) {
            result[key] = value;
            continue;
        }
        reescritas.push([`${key.slice(0, corte)}${SEP}${idLocal}`, value]);
    }

    // Segunda passada: a chave REESCRITA vence a homônima que veio intacta.
    // No restore isso é a política já escrita ("restore is authoritative"); no
    // sync não chega a acontecer, porque lá o remap roda ANTES do merge.
    for (const [key, value] of reescritas) result[key] = value;

    return result;
}

/**
 * Mesma reescrita, mas sobre o que JÁ foi gravado no localStorage — o caminho
 * do RESTORE (BackupSection e Welcome), onde o `applyBackup` grava os dados
 * antes de as playlists entrarem no processo principal e ganharem id daqui.
 * Devolve quantas chaves foram renomeadas.
 */
export function remapLocalStoragePlaylistScope(idMap: Record<string, string> | null | undefined): number {
    if (!idMap || Object.keys(idMap).length === 0) return 0;

    const atuais: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const value = key === null ? null : localStorage.getItem(key);
        if (key !== null && value !== null) atuais[key] = value;
    }

    const remapeado = remapPlaylistScopedKeys(atuais, idMap);

    let renomeadas = 0;
    for (const key of Object.keys(atuais)) {
        if (!(key in remapeado)) {
            localStorage.removeItem(key);
            renomeadas++;
        }
    }
    for (const [key, value] of Object.entries(remapeado)) {
        if (atuais[key] !== value) localStorage.setItem(key, value);
    }
    return renomeadas;
}
