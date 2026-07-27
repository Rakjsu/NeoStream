/**
 * 📱 Desfecho do "Enviar pro celular" → chave de i18n do aviso.
 *
 * Antes o botão dizia "entregue ✓" só por ter escrito no socket: o app podia
 * descartar o push em silêncio (tranca por PIN, bloqueio parental, canal que
 * não existe na conta dele) e o desktop afirmava sucesso. Com o ACK do
 * protocolo v1 o desfecho é real; app legado (que não confirma) mantém o
 * caminho antigo, agora dizendo que a entrega foi sem confirmação.
 */
export type MobilePushStatus =
    | 'played' | 'locked' | 'blocked' | 'notFound' // ACK do app (protocolo v1)
    | 'delivered' // entregue a um app legado — sem confirmação possível
    | 'timeout' // app confirma, mas não respondeu a tempo
    | 'none' // nenhum celular pareado recebeu

export type MobilePushMessageKey =
    | 'sentToPhone' | 'noPhoneConnected'
    | 'phoneSentNoAck' | 'phoneNoAnswer' | 'phoneLocked' | 'phoneBlocked' | 'phoneNotFound'

export function mobilePushMessageKey(result: { status?: string; delivered?: number } | null): MobilePushMessageKey {
    if (!result || (result.delivered ?? 0) === 0) return 'noPhoneConnected'
    switch (result.status) {
        case 'played': return 'sentToPhone'
        case 'locked': return 'phoneLocked'
        case 'blocked': return 'phoneBlocked'
        case 'notFound': return 'phoneNotFound'
        case 'timeout': return 'phoneNoAnswer'
        case 'delivered': return 'phoneSentNoAck'
        // Desktop/handler antigo sem `status`: mantém o texto de sempre.
        default: return 'sentToPhone'
    }
}
