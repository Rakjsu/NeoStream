import { describe, it, expect } from 'vitest'
import { descreverFalha, criarLimitador, LIMITE_DE_FALHAS } from './falhaNaoTratada'

describe('descreverFalha', () => {
    it('Error vira a pilha inteira — é o que resolve o bug', () => {
        const erro = new Error('EPIPE: broken pipe')
        expect(descreverFalha(erro)).toContain('EPIPE: broken pipe')
        expect(descreverFalha(erro)).toContain('at ')
    })

    it('Error sem pilha ainda diz nome e mensagem', () => {
        const erro = new Error('sem pilha')
        erro.stack = ''
        expect(descreverFalha(erro)).toBe('Error: sem pilha')
    })

    it('string passa direto', () => {
        expect(descreverFalha('deu ruim no ffmpeg')).toBe('deu ruim no ffmpeg')
    })

    it('objeto do provedor não vira "[object Object]"', () => {
        // Uma promessa rejeitada carrega qualquer valor; sem tratar isto, a
        // linha mais importante do arquivo seria inútil.
        expect(descreverFalha({ status: 403, url: 'http://prov' })).toBe('{"status":403,"url":"http://prov"}')
    })

    it('undefined e null são ditos por extenso', () => {
        expect(descreverFalha(undefined)).toBe('undefined')
        expect(descreverFalha(null)).toBe('null')
    })

    it('valor que não serializa não troca a falha por outra falha', () => {
        const circular: Record<string, unknown> = {}
        circular.self = circular
        expect(() => descreverFalha(circular)).not.toThrow()
        expect(descreverFalha(circular)).toContain('object')
    })
})

describe('criarLimitador', () => {
    it('deixa escrever até o teto e avisa na última', () => {
        const pode = criarLimitador(3)
        expect(pode()).toBe('sim')
        expect(pode()).toBe('sim')
        expect(pode()).toBe('ultima')
        expect(pode()).toBe('nao')
        expect(pode()).toBe('nao')
    })

    it('o teto padrão é o mesmo do renderer', () => {
        expect(LIMITE_DE_FALHAS).toBe(20)
    })
})
