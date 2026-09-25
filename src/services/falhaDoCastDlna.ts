/**
 * Texto da falha de um cast DLNA, no idioma da pessoa (#D098).
 *
 * O `dlna:cast` (electron/dlnaHandlers.ts) devolve `{ success:false, code,
 * error }`: o `code` é estável e o `error` é o texto que o main redige em
 * PT-BR. A tela traduz os códigos que conhece e só cai no `error` cru quando
 * o código é desconhecido (ou não veio) — é o fallback que existia antes.
 * Sem texto nenhum (ex.: trava de tempo de tela, IPC que caiu), o genérico.
 */
export interface FalhaDoCastDlna {
    code?: string
    error?: string
}

type Traduzir = (secao: string, chave: string) => string

export function mensagemDaFalhaDoCastDlna(falha: FalhaDoCastDlna | null | undefined, t: Traduzir): string {
    switch (falha?.code) {
        case 'hls-refused-704': return t('cast', 'errorHlsRefused')
        case 'format-refused-704': return t('cast', 'errorFormatRefused')
        case 'timeout': return t('cast', 'errorTimeout')
        case 'device-not-found': return t('cast', 'errorDeviceNotFound')
    }
    return falha?.error || t('cast', 'failedToTransmit')
}
