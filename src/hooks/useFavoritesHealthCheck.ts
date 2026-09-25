import { useCallback, useEffect, useRef, useState } from 'react';

/** Quantos canais a sonda testa por vez (a lista pode ter centenas). */
export const FAV_CHECK_LIMIT = 30;
/** Por quanto tempo o resultado fica no rótulo do botão antes de ele voltar. */
export const FAV_CHECK_MSG_MS = 6000;

export interface FavCheckStream {
    stream_id: string | number;
}

interface UseFavoritesHealthCheckOptions<T extends FavCheckStream> {
    /**
     * O "filtro" em que a verificação vale (categoria + busca). Quando ele
     * muda, o resultado deixa de valer: o selo some e o botão volta.
     */
    resetKey: string;
    buildUrl: (stream: T) => Promise<string | null | undefined>;
}

export interface FavoritesHealthCheck<T extends FavCheckStream> {
    busy: boolean;
    msg: string;
    deadIds: ReadonlySet<string>;
    check: (list: readonly T[]) => Promise<void>;
}

interface CheckState {
    /** Filtro a que o resultado pertence. */
    key: string;
    /** Sobe a cada troca de filtro: resposta de sonda de outra época é descartada. */
    epoch: number;
    busy: boolean;
    msg: string;
    dead: ReadonlySet<string>;
}

const NENHUM: ReadonlySet<string> = new Set();

/**
 * Texto do botão depois da sonda. Com mais canais do que o limite, diz que
 * só parte da lista (a lista JÁ filtrada pela busca) foi verificada — antes
 * isso ficava só no tooltip.
 */
export function favCheckMessage(deadCount: number, probedCount: number, listCount: number): string {
    const base = deadCount === 0
        ? `✓ ${probedCount} no ar`
        : `⚠ ${deadCount} de ${probedCount} fora do ar`;
    return listCount > FAV_CHECK_LIMIT
        ? `${base} · ${FAV_CHECK_LIMIT} dos ${listCount} verificados`
        : base;
}

/**
 * 🩺 Verificador de favoritos da TV ao vivo (D028).
 *
 * O resultado da sonda (os ids fora do ar e a mensagem do botão) morava em
 * estado solto da página e NUNCA era limpo: o selo "⚠ FORA DO AR" seguia em
 * qualquer card daqueles ids depois de voltar pra "Todos os canais" — até nos
 * que já tinham voltado ao ar — e o botão ficava congelado no último
 * resultado. Aqui o resultado pertence a um filtro (`resetKey`): trocar
 * categoria ou busca descarta o resultado, a sonda que ainda estava no ar
 * não o ressuscita ao terminar, e o rótulo do botão volta sozinho depois de
 * alguns segundos (os selos ficam enquanto o filtro for o mesmo).
 */
export function useFavoritesHealthCheck<T extends FavCheckStream>({
    resetKey,
    buildUrl,
}: UseFavoritesHealthCheckOptions<T>): FavoritesHealthCheck<T> {
    const [state, setState] = useState<CheckState>(() => ({
        key: resetKey, epoch: 0, busy: false, msg: '', dead: NENHUM,
    }));
    const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Sobe a cada sonda: só a MAIS NOVA escreve o resultado e arma o relógio. */
    const lastCheck = useRef(0);

    // Troca de filtro: ajuste de estado durante o render (o padrão do React
    // pra "resetar quando a prop muda"), sem efeito nem render intermediário
    // com o selo velho.
    if (state.key !== resetKey) {
        setState(s => ({ key: resetKey, epoch: s.epoch + 1, busy: false, msg: '', dead: NENHUM }));
    }

    useEffect(() => () => {
        if (msgTimer.current) clearTimeout(msgTimer.current);
    }, []);

    const epoch = state.epoch;
    const check = useCallback(async (list: readonly T[]) => {
        const seq = ++lastCheck.current;
        if (msgTimer.current) { clearTimeout(msgTimer.current); msgTimer.current = null; }
        setState(s => ({ ...s, busy: true, msg: '' }));

        let msg: string;
        let dead: ReadonlySet<string> | null = null;
        try {
            const targets: { id: string; url: string }[] = [];
            for (const stream of list.slice(0, FAV_CHECK_LIMIT)) {
                try {
                    const url = await buildUrl(stream);
                    if (url?.startsWith('http')) targets.push({ id: String(stream.stream_id), url });
                } catch { /* canal sem URL fica de fora da sonda */ }
            }
            const result = await window.ipcRenderer.invoke('diagnostics:probe-urls', { targets }) as {
                success: boolean; results?: { id: string; alive: boolean }[];
            };
            if (result?.success && result.results) {
                dead = new Set(result.results.filter(r => !r.alive).map(r => r.id));
                msg = favCheckMessage(dead.size, result.results.length, list.length);
            } else {
                msg = '✖ sonda falhou';
            }
        } catch {
            msg = '✖ sonda falhou';
        }

        // Uma sonda mais nova já começou (a do filtro novo): esta não mexe
        // em nada — nem no relógio do rótulo, que agora é da outra.
        if (seq !== lastCheck.current) return;
        // Filtro trocou no meio da sonda: a resposta é de outra lista.
        setState(s => (s.epoch === epoch
            ? { ...s, busy: false, msg, dead: dead ?? s.dead }
            : s));
        // Relógio do rótulo. Sem guarda: sonda nova o desarma logo no começo,
        // e troca de filtro já deixou o rótulo vazio.
        msgTimer.current = setTimeout(() => {
            msgTimer.current = null;
            setState(s => ({ ...s, msg: '' }));
        }, FAV_CHECK_MSG_MS);
    }, [buildUrl, epoch]);

    // Render com filtro trocado: o React descarta este retorno e roda o hook
    // de novo, já com o estado zerado acima, antes de pintar.
    return { busy: state.busy, msg: state.msg, deadIds: state.dead, check };
}
