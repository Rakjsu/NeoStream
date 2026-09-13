/**
 * 🔗 Ler o backup CIFRADO do NeoStream Mobile (formato `NEOENC1:`).
 *
 * O celular protege o backup com `CryptoJS.AES.encrypt(json, senha)`. Esse
 * `.toString()` do crypto-js não é um formato do crypto-js: é o formato do
 * OpenSSL, que qualquer implementação consegue ler desde que faça os mesmos
 * dois passos.
 *
 *   base64( "Salted__" + salt[8] + cifra )
 *
 * e a chave sai do EVP_BytesToKey do OpenSSL — MD5, UMA iteração, sem
 * parâmetro de custo — produzindo 32 bytes de chave + 16 de IV para um
 * AES-256-CBC com padding PKCS#7.
 *
 * Por que isto vive no MAIN e não ao lado do `crossBackup.ts`, que é onde o
 * resto da leitura do backup do celular mora: o EVP_BytesToKey precisa de MD5,
 * e a Web Crypto do renderer não oferece MD5 (de propósito — é um resumo
 * quebrado). As opções eram escrever MD5 à mão no renderer ou usar o `crypto`
 * do Node aqui. Criptografia caseira perde essa disputa sempre.
 *
 * Este KDF é fraco e nós sabemos: uma iteração de MD5 é quase nada contra
 * força bruta de senha. Mas é o que está gravado nos arquivos que os usuários
 * já têm no celular, e o objetivo aqui é LER esses arquivos. O caminho para
 * uma cifra melhor é o outro lado do [56]: o mobile passar a GRAVAR no
 * NEOENC2 (PBKDF2 + AES-GCM), que o desktop já produz em
 * `src/services/backupService.ts`. Este módulo continua existindo depois
 * disso, para os backups antigos.
 */

import crypto from 'node:crypto'

export const NEOENC1_PREFIX = 'NEOENC1:'

/** Cabeçalho que o OpenSSL põe antes do salt. */
const OPENSSL_MAGIC = 'Salted__'
const SALT_BYTES = 8
const KEY_BYTES = 32
const IV_BYTES = 16

export function pareceBackupCifradoDoCelular(texto: string): boolean {
    return typeof texto === 'string' && texto.trim().startsWith(NEOENC1_PREFIX)
}

/**
 * EVP_BytesToKey do OpenSSL com MD5 e 1 iteração — o mesmo que o crypto-js faz
 * quando recebe uma senha em vez de uma chave.
 *
 * D_1 = MD5(senha || salt); D_i = MD5(D_{i-1} || senha || salt); concatena até
 * ter chave + IV.
 */
function derivaChaveEIv(senha: Buffer, salt: Buffer): { chave: Buffer; iv: Buffer } {
    const blocos: Buffer[] = []
    let anterior = Buffer.alloc(0)
    let total = 0
    while (total < KEY_BYTES + IV_BYTES) {
        anterior = crypto.createHash('md5').update(Buffer.concat([anterior, senha, salt])).digest()
        blocos.push(anterior)
        total += anterior.length
    }
    const material = Buffer.concat(blocos, KEY_BYTES + IV_BYTES)
    return { chave: material.subarray(0, KEY_BYTES), iv: material.subarray(KEY_BYTES) }
}

/**
 * Devolve o JSON em texto, ou `null` para senha errada / arquivo corrompido.
 *
 * O CBC não autentica nada, então "senha errada" chega aqui de três jeitos
 * diferentes: o padding PKCS#7 não fecha (o decipher lança), fecha por acaso
 * mas o resultado não é UTF-8 válido, ou é UTF-8 e é lixo. Por isso a última
 * palavra é a mesma que o celular usa em `decryptBackup`: só vale se o texto
 * começar com `{`. Sem essa checagem, uma senha errada teria ~1/256 de chance
 * de passar como "decifrada" e cair no parser como JSON inválido.
 */
export function decifrarBackupDoCelular(texto: string, senha: string): string | null {
    if (!pareceBackupCifradoDoCelular(texto)) return null
    try {
        const pacote = Buffer.from(texto.trim().slice(NEOENC1_PREFIX.length), 'base64')
        if (pacote.length <= OPENSSL_MAGIC.length + SALT_BYTES) return null
        if (pacote.subarray(0, OPENSSL_MAGIC.length).toString('latin1') !== OPENSSL_MAGIC) return null

        const salt = pacote.subarray(OPENSSL_MAGIC.length, OPENSSL_MAGIC.length + SALT_BYTES)
        const cifra = pacote.subarray(OPENSSL_MAGIC.length + SALT_BYTES)
        const { chave, iv } = derivaChaveEIv(Buffer.from(senha, 'utf-8'), salt)

        const decipher = crypto.createDecipheriv('aes-256-cbc', chave, iv)
        const claro = Buffer.concat([decipher.update(cifra), decipher.final()]).toString('utf-8')
        return claro.startsWith('{') ? claro : null
    } catch {
        return null
    }
}
