// Hash de PIN com sal — usado pelo PIN de entrada dos perfis.
//
// O PIN do perfil era SHA-256 do PIN puro, com o comentário "for demo" ainda no
// código. Um PIN de 4 dígitos tem 10 mil possibilidades: sem sal, o hash é o
// MESMO em toda instalação do app, então uma tabela pré-calculada de 10 mil
// entradas serve para qualquer usuário — e dois perfis com o mesmo PIN ficavam
// com hashes idênticos, o que já entrega a informação de graça.
//
// O sal por perfil não torna o PIN forte (4 dígitos continuam 4 dígitos); ele
// tira a tabela pré-calculada da jogada e desfaz a correlação entre perfis.
//
// Mesmo formato que o `parentalService` já usa (`<salHex>:<pin>`), de propósito:
// duas convenções de hash de PIN no mesmo app seria pior que uma.

/** 16 bytes aleatórios em hexadecimal (32 caracteres). */
export function randomSaltHex(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 de `<sal>:<pin>`, em hexadecimal. */
export async function hashPinSalgado(pin: string, saltHex: string): Promise<string> {
    const data = new TextEncoder().encode(`${saltHex}:${pin}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * O formato ANTIGO: SHA-256 do PIN puro, sem sal.
 *
 * Continua aqui porque a base instalada está cheia dele — a migração acontece
 * na leitura, quando o usuário acerta o PIN (é o único momento em que o app
 * conhece o PIN em texto).
 */
export async function hashPinLegado(pin: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
