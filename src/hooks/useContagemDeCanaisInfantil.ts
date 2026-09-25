import { useEffect, useState } from 'react';
import { parentalService } from '../services/parentalService';
import { profileService } from '../services/profileService';
import { asList } from '../utils/catalogPayload';
import {
    isCategoryNameBlocked,
    isCategoryNameKidsAllowed,
    isLiveChannelVisible,
} from '../services/contentGate';

/**
 * 📺 Quantos canais o perfil infantil ENXERGA na TV ao vivo (#D058).
 *
 * O cartão "Canais" da Home mostrava, no perfil infantil, o total do
 * provedor: o "desconto" que existia subtraía as chaves `live_` de um
 * conjunto que só recebe `movie_` e `series_` — subtração de zero. A criança
 * via "12.480 canais" e, ao clicar, encontrava a meia dúzia das categorias
 * infantis.
 *
 * A conta aqui usa o MESMO julgamento da grade da TV ao vivo
 * (`isLiveChannelVisible`): whitelist de categoria infantil (vazia = sem
 * filtro, o mesmo fallback da grade), whitelist por canal (os 👶) e, com o
 * parental valendo, o bloqueio de categoria adulta.
 */

export interface CanalParaContar {
    stream_id?: unknown;
    category_id?: unknown;
}

export interface CategoriaParaContar {
    category_id?: unknown;
    category_name?: unknown;
}

export interface EntradaDaContagem {
    canais: CanalParaContar[];
    categorias: CategoriaParaContar[];
    /** Os canais marcados com 👶 (whitelist por canal). Vazia = sem filtro. */
    kidsAllowedChannelIds: ReadonlySet<string>;
    /** Parental valendo com bloqueio de categoria adulta. */
    bloquearAdulto: boolean;
}

const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Pura: quantos canais passam no portão do perfil infantil. */
export function contarCanaisDoPerfilInfantil(entrada: EntradaDaContagem): number {
    const permitidas = new Set<string>();
    const bloqueadas = new Set<string>();
    for (const cat of entrada.categorias) {
        const id = texto(cat.category_id);
        const nome = texto(cat.category_name);
        if (isCategoryNameKidsAllowed(nome)) permitidas.add(id);
        if (entrada.bloquearAdulto && isCategoryNameBlocked(nome)) bloqueadas.add(id);
    }
    const gate = {
        blockedCategoryIds: bloqueadas,
        allowedCategoryIds: permitidas,
        kidsAllowedChannelIds: entrada.kidsAllowedChannelIds,
    };
    let total = 0;
    for (const canal of entrada.canais) {
        if (isLiveChannelVisible({ streamId: texto(canal.stream_id), categoryId: texto(canal.category_id) }, gate)) total++;
    }
    return total;
}

export interface ContagemDeCanais {
    /** null = não deu pra contar (provedor não respondeu) ou perfil adulto. */
    contagem: number | null;
    carregando: boolean;
}

/**
 * Contagem de canais do perfil infantil. Perfil adulto não busca nada e
 * recebe `{ contagem: null, carregando: false }` — quem chama usa o total do
 * provedor. `recarga` muda quando o catálogo é atualizado.
 *
 * Falha NÃO cai no total do provedor: devolve `null`, e a Home mostra "—".
 * Um número sem portão é justamente o que este hook existe pra evitar.
 */
export function useContagemDeCanaisInfantil(isKidsProfile: boolean, recarga = 0): ContagemDeCanais {
    const [estado, setEstado] = useState<ContagemDeCanais>(() => ({ contagem: null, carregando: isKidsProfile }));

    useEffect(() => {
        if (!isKidsProfile) {
            queueMicrotask(() => setEstado({ contagem: null, carregando: false }));
            return;
        }
        let vivo = true;
        queueMicrotask(() => { if (vivo) setEstado(prev => ({ ...prev, carregando: true })); });
        void (async () => {
            let contagem: number | null = null;
            try {
                const [canais, categorias] = await Promise.all([
                    window.ipcRenderer.invoke('streams:get-live'),
                    window.ipcRenderer.invoke('categories:get-live'),
                ]) as [{ success?: boolean; data?: unknown }, { success?: boolean; data?: unknown }];
                if (canais?.success && categorias?.success) {
                    const cfg = parentalService.getConfig();
                    contagem = contarCanaisDoPerfilInfantil({
                        canais: asList<CanalParaContar>(canais.data),
                        categorias: asList<CategoriaParaContar>(categorias.data),
                        kidsAllowedChannelIds: profileService.getKidsAllowedChannelIds(),
                        bloquearAdulto: cfg.enabled && cfg.blockAdultCategories && !parentalService.isSessionUnlocked(),
                    });
                }
            } catch {
                contagem = null;
            }
            if (vivo) setEstado({ contagem, carregando: false });
        })();
        return () => { vivo = false; };
    }, [isKidsProfile, recarga]);

    return estado;
}
