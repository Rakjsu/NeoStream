import { describe, it, expect } from 'vitest'
import { caminhoDoSeloDeAssinatura, instalaAtualizacaoSozinho, urlDaRelease } from './macUpdateSupport'

const MAC_ASAR = '/Applications/NeoStream IPTV.app/Contents/Resources/app.asar'
const SELO = '/Applications/NeoStream IPTV.app/Contents/_CodeSignature/CodeResources'

const ambiente = (over: Partial<Parameters<typeof instalaAtualizacaoSozinho>[0]> = {}) => ({
    plataforma: 'darwin',
    empacotado: true,
    appPath: MAC_ASAR,
    existe: () => false,
    ...over,
})

describe('caminhoDoSeloDeAssinatura', () => {
    it('deriva o _CodeSignature do bundle a partir do app.asar', () => {
        expect(caminhoDoSeloDeAssinatura(MAC_ASAR)).toBe(SELO)
    })

    it('funciona também sem asar (pasta app/)', () => {
        expect(caminhoDoSeloDeAssinatura('/Applications/NeoStream IPTV.app/Contents/Resources/app'))
            .toBe(SELO)
    })

    it('caminho fora de um bundle não tem selo', () => {
        // Em desenvolvimento o getAppPath() é a pasta do projeto.
        expect(caminhoDoSeloDeAssinatura('/Users/rakjs/Projetos/IPTV')).toBeNull()
        expect(caminhoDoSeloDeAssinatura('C:\\Users\\rakjs\\Projetos\\IPTV')).toBeNull()
        expect(caminhoDoSeloDeAssinatura('')).toBeNull()
    })

    it('pega o ÚLTIMO .app do caminho (app instalado dentro de outro bundle)', () => {
        expect(caminhoDoSeloDeAssinatura('/Applications/Fora.app/Contents/Helpers/Dentro.app/Contents/Resources/app.asar'))
            .toBe('/Applications/Fora.app/Contents/Helpers/Dentro.app/Contents/_CodeSignature/CodeResources')
    })
})

describe('instalaAtualizacaoSozinho', () => {
    it('Windows e Linux nunca são afetados', () => {
        expect(instalaAtualizacaoSozinho(ambiente({ plataforma: 'win32', appPath: 'C:\\Program Files\\NeoStream' }))).toBe(true)
        expect(instalaAtualizacaoSozinho(ambiente({ plataforma: 'linux', appPath: '/tmp/.mount_Neo/resources/app.asar' }))).toBe(true)
    })

    it('mac fora do pacote (desenvolvimento) segue o caminho normal', () => {
        // Ali o electron-updater já fica inativo por conta própria; mudar o
        // fluxo em dev só mascararia o comportamento real.
        expect(instalaAtualizacaoSozinho(ambiente({ empacotado: false, appPath: '/Users/rakjs/Projetos/IPTV' }))).toBe(true)
    })

    it('mac ASSINADO: o selo existe, então o update automático volta sozinho', () => {
        const vistos: string[] = []
        const pode = instalaAtualizacaoSozinho(ambiente({
            existe: (caminho) => { vistos.push(caminho); return true },
        }))
        expect(pode).toBe(true)
        expect(vistos).toEqual([SELO])
    })

    it('mac SEM assinatura: não instala sozinho — é o caso de hoje', () => {
        // O release.yml empacota com CSC_IDENTITY_AUTO_DISCOVERY: false e o
        // Squirrel.Mac recusa bundle sem selo.
        expect(instalaAtualizacaoSozinho(ambiente({ existe: () => false }))).toBe(false)
    })

    it('mac empacotado com caminho ilegível cai no lado seguro', () => {
        expect(instalaAtualizacaoSozinho(ambiente({ appPath: '/algum/lugar/estranho' }))).toBe(false)
    })

    it('erro ao olhar o disco também cai no lado seguro', () => {
        expect(instalaAtualizacaoSozinho(ambiente({
            existe: () => { throw new Error('EPERM') },
        }))).toBe(false)
    })
})

describe('urlDaRelease', () => {
    const feed = { owner: 'Rakjsu', repo: 'NeoStream' }

    it('com versão anunciada, aponta para a tag daquela versão', () => {
        expect(urlDaRelease(feed, '4.50.0')).toBe('https://github.com/Rakjsu/NeoStream/releases/tag/v4.50.0')
    })

    it('não duplica o v quando a versão já vem com ele', () => {
        expect(urlDaRelease(feed, 'v4.50.0')).toBe('https://github.com/Rakjsu/NeoStream/releases/tag/v4.50.0')
    })

    it('sem versão, a página latest — que nunca fica errada', () => {
        expect(urlDaRelease(feed)).toBe('https://github.com/Rakjsu/NeoStream/releases/latest')
        expect(urlDaRelease(feed, '   ')).toBe('https://github.com/Rakjsu/NeoStream/releases/latest')
        expect(urlDaRelease(feed, null)).toBe('https://github.com/Rakjsu/NeoStream/releases/latest')
    })

    it('versão com caractere estranho não escapa da URL', () => {
        expect(urlDaRelease(feed, '4.0.0/../../evil')).toBe(
            'https://github.com/Rakjsu/NeoStream/releases/tag/v4.0.0%2F..%2F..%2Fevil'
        )
    })
})
