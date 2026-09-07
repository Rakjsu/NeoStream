import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
    DEFAULT_HW_ACCEL,
    gpuSwitchesFor,
    HW_ACCEL_MODES,
    normalizeHwAccelMode,
} from './gpuPolicy'

const nomes = (mode: Parameters<typeof gpuSwitchesFor>[0]) =>
    gpuSwitchesFor(mode).switches.map(([nome]) => nome)

describe('gpuSwitchesFor', () => {
    it('desligado usa disableHardwareAcceleration e nenhum switch', () => {
        expect(gpuSwitchesFor('off')).toEqual({ switches: [], disableHardwareAcceleration: true })
    })

    it('automático não ignora a lista de bloqueio — é o comportamento de hoje', () => {
        expect(nomes('auto')).toEqual(['enable-gpu-rasterization'])
    })

    it('forçar ignora a lista de bloqueio, com o nome que existe', () => {
        expect(nomes('force')).toContain('ignore-gpu-blocklist')
        expect(gpuSwitchesFor('force').disableHardwareAcceleration).toBe(false)
    })

    // Este é o teste que impede o bug de voltar: os quatro nomes abaixo
    // estavam no main.ts e três não existem no Chromium 152 (Electron 44.1.1).
    // Switch desconhecido é ignorado em silêncio, então nada avisaria.
    it('nenhum modo ressuscita os nomes mortos', () => {
        const mortos = ['ignore-gpu-blacklist', 'enable-zero-copy', 'VaapiVideoDecoder', 'VaapiVideoEncoder']
        for (const mode of HW_ACCEL_MODES) {
            const texto = JSON.stringify(gpuSwitchesFor(mode))
            for (const morto of mortos) expect(texto).not.toContain(morto)
        }
    })
})

describe('normalizeHwAccelMode', () => {
    // Caminho de 100% da base instalada no primeiro boot depois da atualização:
    // o campo não existe. E, depois, config.json editado à mão.
    it('ausente, lixo e tipo errado caem no padrão', () => {
        expect(normalizeHwAccelMode(undefined)).toBe(DEFAULT_HW_ACCEL)
        expect(normalizeHwAccelMode(null)).toBe(DEFAULT_HW_ACCEL)
        expect(normalizeHwAccelMode('sim')).toBe(DEFAULT_HW_ACCEL)
        expect(normalizeHwAccelMode(3)).toBe(DEFAULT_HW_ACCEL)
        expect(normalizeHwAccelMode({})).toBe(DEFAULT_HW_ACCEL)
    })

    it('os três modos válidos passam', () => {
        for (const mode of HW_ACCEL_MODES) expect(normalizeHwAccelMode(mode)).toBe(mode)
    })
})

describe('a política é aplicada antes de tudo no main.ts', () => {
    // Mesmo padrão do singleInstance.test.ts: `appendSwitch` e
    // `disableHardwareAcceleration` SÓ valem antes do app ficar pronto, então
    // a posição no arquivo é parte do contrato.
    const main = readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), 'main.ts'),
        'utf-8'
    )

    it('roda antes do lock de instância única e do primeiro setup*()', () => {
        const politica = main.indexOf('aplicarPoliticaDeGpu(')
        const lock = main.indexOf('requestSingleInstanceLock')
        const primeiroSetup = main.search(/^setup\w+\(\)/m)
        expect(politica).toBeGreaterThan(-1)
        expect(lock).toBeGreaterThan(politica)
        expect(primeiroSetup).toBeGreaterThan(politica)
    })

    it('e depois do e2eUserData, que resolve o userData de onde a preferência é lida', () => {
        expect(main.indexOf("import './e2eUserData'")).toBeLessThan(main.indexOf('aplicarPoliticaDeGpu('))
    })

    it('os nomes mortos não voltaram pro main.ts', () => {
        for (const morto of ['ignore-gpu-blacklist', 'enable-zero-copy', 'VaapiVideoDecoder']) {
            expect(main).not.toContain(morto)
        }
    })
})
