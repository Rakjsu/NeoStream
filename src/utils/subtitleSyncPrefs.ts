/**
 * Ajuste de sincronia de legenda (em segundos), lembrado por conteúdo.
 *
 * O ajuste voltava a zero a cada episódio — e não por esquecimento do usuário:
 * ao trocar de episódio o `AsyncVideoPlayer` volta para a tela de carregamento
 * e **desmonta** o player, então o `useState(0)` renasce. Quem assiste uma
 * série com legenda descompassada refazia o ajuste episódio após episódio.
 *
 * Global (não por perfil), pelo mesmo motivo do `aspectPrefs`: o descompasso é
 * uma propriedade do arquivo, não de quem assiste.
 */

const STORAGE_KEY = 'neostream_subtitle_sync';

/** Além disto não é sincronia, é lixo — vindo de storage corrompido ou de bug. */
export const MAX_OFFSET_SECONDS = 120;

export function subtitleSyncKey(
    contentType: string | undefined,
    contentId: string | undefined | null
): string | null {
    if (!contentId) return null;
    return `${contentType || 'movie'}:${contentId}`;
}

function valido(valor: unknown): valor is number {
    return typeof valor === 'number' && Number.isFinite(valor) && Math.abs(valor) <= MAX_OFFSET_SECONDS;
}

function carregar(): Record<string, number> {
    try {
        const bruto = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, unknown>;
        const limpo: Record<string, number> = {};
        for (const [chave, valor] of Object.entries(bruto)) {
            if (valido(valor)) limpo[chave] = valor;
        }
        return limpo;
    } catch {
        return {};
    }
}

export const subtitleSyncPrefs = {
    get(chave: string | null): number {
        if (!chave) return 0;
        return carregar()[chave] ?? 0;
    },

    set(chave: string | null, segundos: number): void {
        if (!chave) return;
        try {
            const todos = carregar();
            if (segundos === 0 || !Number.isFinite(segundos)) {
                // Zero é o padrão: guardar só engorda o registro.
                delete todos[chave];
            } else {
                // Fora do limite, GRAVA no limite — não apaga. Apagar aqui faria
                // um ajuste exagerado virar "sem ajuste", que é pior que preso
                // no teto: o usuário mexeu e o app fingiu que não.
                todos[chave] = Math.max(-MAX_OFFSET_SECONDS, Math.min(MAX_OFFSET_SECONDS, segundos));
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
        } catch { /* quota cheia: o ajuste segue valendo nesta sessão */ }
    },
};
