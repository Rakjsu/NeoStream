import { describe, it, expect } from 'vitest'
import { decifrarBackupDoCelular, pareceBackupCifradoDoCelular, NEOENC1_PREFIX } from './mobileBackupCrypto'

/**
 * Os dois textos cifrados abaixo NÃO foram produzidos por este módulo. Saíram
 * do `crypto-js` de verdade, rodando no repositório do NeoStream Mobile:
 *
 *   node -e "const C=require('crypto-js'); console.log('NEOENC1:'+C.AES.encrypt(json, senha).toString())"
 *
 * É de propósito. Um teste que cifra e decifra com o mesmo código passa mesmo
 * que o formato esteja errado — provaria só que somos coerentes com nós
 * mesmos. O que precisa ser provado aqui é interoperabilidade com o arquivo
 * que o celular do usuário já gerou, e para isso o único vetor que vale é um
 * vindo da outra implementação.
 */
const CLARO = '{"app":"neostream-mobile","version":5,"accounts":[{"alias":"Casa","url":"http://exemplo.tv:8080","username":"user1","password":"senha1","type":"xtream"},{"alias":"Sítio","url":"http://outro.tv","username":"00:1A:79:11:22:33","password":"","type":"stalker"}],"tmdbKey":"chave-de-mentira"}'

const VETOR_ASCII = {
    senha: 'abc123',
    texto: 'NEOENC1:U2FsdGVkX18j1AeM5/Y6JZDBsgAUX2ADTTfCzrla97TeWDNBtmGhlSHfd2z1XCm4v39inxyt2HH0/V6dSm13C+4mEXc5+YIwd5JeARW06KiX2sQV06AG595dGu4sbzemG5myBe6DTI1DCEf1fQjMEYCyonymgo0zYmqNY6ITHjSXCWhunCw5QWmply7GoERDcqOHygE8I1DbrIkRLXjATTOx0fTXnQwgoPhKfdI9ZljqpU1bb5D9+ofki/BUy09753vcUgaXDD7X5Uad1dNTDqF7pddO7laz75IYLRbPiU/HK8ltDIvOdX9JIhWV4AlCj4Aj5m2CcEULihcrX4mdcGpC8SBqPjWRdHXXczaoauQf7ItqplElHnQNdGRrRLqTQlsPJ8LO8NqwJ6Pjk0Cx47K2OouuKFq6b/7hrQogy7M=',
}

/** Senha com espaço e acento: o EVP_BytesToKey come os BYTES UTF-8 dela. */
const VETOR_ACENTUADO = {
    senha: 'sen ha çÃo',
    texto: 'NEOENC1:U2FsdGVkX1+ryB+pJt6RoxybuhOu5vudZXLejcVN6Jsyn11nUhegwN4ubp7SvRCwMQDnl1ZxT6gU8FvOduWEBfYE0kx325BkXy8idDzlcsruK0A96GOCWNarVpE5b7SreUJWByy1c6mANzUKAQXkQOgzdu2avUinFyq+UJ7sONqoFKWsrmKJuTtQuxzFLWQ+yWY2v1bw9IA7C3B2R+sULQDkz1lyJuo2xqyaUCXRoEiTDajd2RYRz/H28T1UwSlHGqGhdp6kQQ++5TvpvvhDcovGD1NP32JAwJp4ovZgikSSQ0/J45azPXhO48CqftzizzDzsym0dWGcgmrOW3ZTQnt3HayNBy3JDew88JAkiy9tS5saQH8yPmD8k+5iFROE5ClByZeT2qvz66yXSrQz9t0KH+SCsw7mQwl5HC4ztFQ=',
}

describe('pareceBackupCifradoDoCelular', () => {
    it('reconhece o prefixo, inclusive com espaço em volta', () => {
        expect(pareceBackupCifradoDoCelular(VETOR_ASCII.texto)).toBe(true)
        expect(pareceBackupCifradoDoCelular(`\n  ${NEOENC1_PREFIX}abc\n`)).toBe(true)
    })

    it('recusa backup em texto puro e lixo', () => {
        expect(pareceBackupCifradoDoCelular('{"app":"neostream-mobile"}')).toBe(false)
        expect(pareceBackupCifradoDoCelular('NEOENC2:abc')).toBe(false)
        expect(pareceBackupCifradoDoCelular('')).toBe(false)
    })
})

describe('decifrarBackupDoCelular', () => {
    it('abre o arquivo que o crypto-js do celular gerou', () => {
        expect(decifrarBackupDoCelular(VETOR_ASCII.texto, VETOR_ASCII.senha)).toBe(CLARO)
    })

    it('abre também com senha de espaço e acento', () => {
        expect(decifrarBackupDoCelular(VETOR_ACENTUADO.texto, VETOR_ACENTUADO.senha)).toBe(CLARO)
    })

    it('devolve JSON parseável, não só uma string parecida', () => {
        const claro = decifrarBackupDoCelular(VETOR_ASCII.texto, VETOR_ASCII.senha)
        const backup = JSON.parse(claro!) as { app: string; accounts: unknown[] }
        expect(backup.app).toBe('neostream-mobile')
        expect(backup.accounts).toHaveLength(2)
    })

    it('senha errada é null, nunca lixo', () => {
        // O CBC não autentica: a senha errada pode derrubar o padding, virar
        // bytes que não são UTF-8, ou virar UTF-8 sem sentido. Os três têm que
        // sair como null. Vinte senhas erradas seguidas é bastante gente para
        // um erro de padding "de sorte" aparecer, se a checagem final sumisse.
        for (let i = 0; i < 20; i++) {
            expect(decifrarBackupDoCelular(VETOR_ASCII.texto, `errada${i}`)).toBeNull()
        }
        expect(decifrarBackupDoCelular(VETOR_ASCII.texto, '')).toBeNull()
        // Maiúscula conta.
        expect(decifrarBackupDoCelular(VETOR_ASCII.texto, 'ABC123')).toBeNull()
    })

    it('arquivo mexido é null', () => {
        const cortado = VETOR_ASCII.texto.slice(0, VETOR_ASCII.texto.length - 20)
        expect(decifrarBackupDoCelular(cortado, VETOR_ASCII.senha)).toBeNull()
        // Base64 válido mas sem o cabeçalho Salted__ do OpenSSL.
        expect(decifrarBackupDoCelular(NEOENC1_PREFIX + Buffer.from('não é um pacote openssl mesmo assim longo').toString('base64'), 'x')).toBeNull()
        expect(decifrarBackupDoCelular(NEOENC1_PREFIX, 'x')).toBeNull()
        expect(decifrarBackupDoCelular(NEOENC1_PREFIX + '!!!não é base64!!!', 'x')).toBeNull()
    })

    it('texto sem o prefixo é recusado em vez de tratado como cifra', () => {
        expect(decifrarBackupDoCelular(CLARO, 'abc123')).toBeNull()
    })
})
