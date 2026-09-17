import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { cacheKeyValido } from './epgCacheGuard'

/**
 * 🧱 O `cacheKey` do EPG vem do renderer e vira NOME DE ARQUIVO.
 *
 * `epg:get-cached` está na allowlist do preload, então qualquer código do
 * renderer pode chamá-lo. Os chamadores de produção mandam literais
 * (`user-external`, `portugal1`…), mas nada obrigava isso: o handler
 * interpolava a string crua no caminho e gravava ali o corpo da URL que o
 * mesmo chamador escolheu.
 *
 * É endurecimento contra renderer comprometido, a mesma classe que o #405
 * fechou ao apagar o `fetch-url`.
 */
describe('path.join normaliza, mas não confina', () => {
    it('um ".." no cacheKey sai da pasta de cache', () => {
        // Este teste documenta o DEFEITO, não a correção: é por isso que a
        // guarda precisa existir antes do path.join, e não depois.
        const raiz = path.join('C:', 'u', 'epg_cache')
        expect(path.join(raiz, `${'../config'}.xml`)).toBe(path.join('C:', 'u', 'config.xml'))
    })
})

describe('cacheKeyValido', () => {
    it.each(['../config', '..\\config', 'a/b', 'a\\b', '', '.', 'a'.repeat(41)])(
        'recusa %j', (chave) => {
            expect(cacheKeyValido(chave)).toBe(false)
        })

    it('recusa o que nem string é', () => {
        expect(cacheKeyValido(42)).toBe(false)
        expect(cacheKeyValido(null)).toBe(false)
        expect(cacheKeyValido(undefined)).toBe(false)
        expect(cacheKeyValido({})).toBe(false)
    })

    it.each(['user-external', 'portugal1', 'argentina7', 'brazil5', 'usa10'])(
        'aceita a chave real %s', (chave) => {
            // Os cinco formatos que existem no código de produção. Um deles
            // fora da regex mataria o EPG daquela fonte em silêncio.
            expect(cacheKeyValido(chave)).toBe(true)
        })
})

/**
 * O teste com dente: é ele que fica vermelho antes da correção.
 *
 * Os números são frágeis a refatoração — é o mesmo preço que o
 * `preloadChannels.test.ts` paga, e de propósito: mexeu no número de caminhos
 * montados a partir do `cacheKey`, alguém tem que olhar se o novo passou pela
 * guarda.
 *
 * A varredura cobre só o `ipcHandlers.ts`. O `electron/providerEpg.ts` repete
 * o mesmo padrão de caminho, mas a chave dele é um sha1 interno, não vem do
 * renderer — quem um dia alimentá-la de fora não será pego por aqui.
 */
describe('todo caminho do cache do EPG passa pela guarda', () => {
    const FONTE = fs.readFileSync(path.join(__dirname, 'ipcHandlers.ts'), 'utf-8')

    it('os 5 caminhos montados com o cacheKey continuam sendo 5', () => {
        // epgFileStatus (.xml e .meta.json), epg:get-cached (.xml e
        // .meta.json) e epg:get-cache-info (.meta.json).
        expect([...FONTE.matchAll(/\$\{cacheKey\}\./g)]).toHaveLength(5)
    })

    it('e os 3 handlers que recebem o cacheKey recusam chave torta', () => {
        // epgFileStatus, epg:get-cached, epg:get-cache-info.
        expect([...FONTE.matchAll(/cacheKeyValido\(/g)]).toHaveLength(3)
    })
})
