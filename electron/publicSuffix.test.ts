import { describe, it, expect } from 'vitest'
import { getRegistrableDomain, isPublicSuffix, isSameRegistrableDomain } from './publicSuffix'

/**
 * 🔒 O corte em 2 rótulos fazia `lista.provedor.com.br` virar `com.br`, e aí
 * TODO host `*.com.br` era tratado como o mesmo provedor — bypass de TLS/CORS
 * para um sufixo público inteiro. Estes testes falham com a heurística antiga.
 */

describe('getRegistrableDomain', () => {
    it('gTLD simples continua sendo domínio + TLD', () => {
        expect(getRegistrableDomain('provider.example.com')).toBe('example.com')
        expect(getRegistrableDomain('cdn7.edge.example.com')).toBe('example.com')
        expect(getRegistrableDomain('example.com')).toBe('example.com')
    })

    it('sufixo público de duas partes exige o terceiro rótulo', () => {
        expect(getRegistrableDomain('lista.meuiptv.com.br')).toBe('meuiptv.com.br')
        expect(getRegistrableDomain('meuiptv.com.br')).toBe('meuiptv.com.br')
        expect(getRegistrableDomain('painel.tv.provedor.net.br')).toBe('provedor.net.br')
        expect(getRegistrableDomain('a.b.example.co.uk')).toBe('example.co.uk')
        expect(getRegistrableDomain('cdn.provider.com.au')).toBe('provider.com.au')
        expect(getRegistrableDomain('www.empresa.co.jp')).toBe('empresa.co.jp')
    })

    it('ccTLD fora da lista ainda cai na heurística de rótulo administrativo', () => {
        expect(getRegistrableDomain('painel.provedor.com.gt')).toBe('provedor.com.gt')
        expect(getRegistrableDomain('a.b.empresa.co.mz')).toBe('empresa.co.mz')
    })

    it('normaliza caixa e ponto final', () => {
        expect(getRegistrableDomain('LISTA.MeuIPTV.COM.BR.')).toBe('meuiptv.com.br')
    })

    it('IPs e rótulo único voltam como estão', () => {
        expect(getRegistrableDomain('10.0.0.5')).toBe('10.0.0.5')
        expect(getRegistrableDomain('192.168.1.10')).toBe('192.168.1.10')
        expect(getRegistrableDomain('[::1]')).toBe('::1')
        expect(getRegistrableDomain('localhost')).toBe('localhost')
    })
})

describe('isPublicSuffix', () => {
    it('reconhece sufixo público puro', () => {
        expect(isPublicSuffix('com.br')).toBe(true)
        expect(isPublicSuffix('co.uk')).toBe(true)
        expect(isPublicSuffix('com')).toBe(true)
    })

    it('domínio de verdade não é sufixo público', () => {
        expect(isPublicSuffix('meuiptv.com.br')).toBe(false)
        expect(isPublicSuffix('example.com')).toBe(false)
        expect(isPublicSuffix('10.0.0.5')).toBe(false)
    })
})

describe('isSameRegistrableDomain', () => {
    it('🔒 provedor .com.br NÃO casa com outro dono do mesmo sufixo', () => {
        expect(isSameRegistrableDomain('lista.meuiptv.com.br', 'internetbanking.banco.com.br')).toBe(false)
        expect(isSameRegistrableDomain('provedor.com.br', 'outro.com.br')).toBe(false)
        expect(isSameRegistrableDomain('a.example.co.uk', 'b.evil.co.uk')).toBe(false)
        expect(isSameRegistrableDomain('cdn.provider.com.au', 'phish.attacker.com.au')).toBe(false)
    })

    it('subdomínios do mesmo dono continuam casando', () => {
        expect(isSameRegistrableDomain('cdn7.meuiptv.com.br', 'painel.meuiptv.com.br')).toBe(true)
        expect(isSameRegistrableDomain('cdn7.example.com', 'provider.example.com')).toBe(true)
        expect(isSameRegistrableDomain('meuiptv.com.br', 'meuiptv.com.br')).toBe(true)
    })

    it('IP literal só casa por igualdade exata', () => {
        expect(isSameRegistrableDomain('10.0.0.5', '10.0.0.5')).toBe(true)
        expect(isSameRegistrableDomain('10.0.0.5', '10.0.0.6')).toBe(false)
        expect(isSameRegistrableDomain('10.0.0.5', 'provedor.com.br')).toBe(false)
    })

    it('sufixo público puro nunca casa com ninguém', () => {
        expect(isSameRegistrableDomain('com.br', 'meuiptv.com.br')).toBe(false)
        expect(isSameRegistrableDomain('lista.com.br', '')).toBe(false)
    })
})
