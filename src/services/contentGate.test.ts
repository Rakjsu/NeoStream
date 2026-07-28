import { describe, it, expect } from 'vitest'
import {
    isCategoryNameBlocked,
    isCategoryNameKidsAllowed,
    isContentGateOff,
    isItemVisibleUnderGate,
    isLiveCategoryVisible,
    isParentalActive,
    normalizeContentName,
    shouldBlockAdultCategories,
    toCategoryIds,
    type ContentGateState,
} from './contentGate'

const state = (over: Partial<ContentGateState> = {}): ContentGateState => ({
    isKidsProfile: false,
    parentalEnabled: false,
    blockAdultCategories: true,
    sessionUnlocked: false,
    ...over,
})

// O gate do controle web é o MESMO da grade: um filme de categoria adulta que
// o desktop esconde não pode sair no catálogo mandado pro celular.
const visible = (over: Partial<Parameters<typeof isItemVisibleUnderGate>[0]> = {}) =>
    isItemVisibleUnderGate({
        categoryIds: ['7'],
        name: 'Filme Qualquer',
        blockedCategoryIds: new Set<string>(),
        hiddenNames: new Set<string>(),
        cachedRatings: new Map<string, string | null>(),
        isRatingBlocked: () => false,
        state: state(),
        ...over,
    })

describe('shouldBlockAdultCategories', () => {
    it('perfil infantil sempre bloqueia categorias adultas', () => {
        expect(shouldBlockAdultCategories(state({ isKidsProfile: true }))).toBe(true)
    })

    it('parental ligado e sessão trancada bloqueia', () => {
        expect(shouldBlockAdultCategories(state({ parentalEnabled: true }))).toBe(true)
    })

    it('sessão destravada com o PIN parental libera', () => {
        expect(shouldBlockAdultCategories(state({ parentalEnabled: true, sessionUnlocked: true }))).toBe(false)
    })

    it('parental desligado não bloqueia nada', () => {
        expect(shouldBlockAdultCategories(state())).toBe(false)
    })

    it('respeita blockAdultCategories desligado no perfil adulto', () => {
        expect(shouldBlockAdultCategories(state({ parentalEnabled: true, blockAdultCategories: false }))).toBe(false)
    })
})

describe('isParentalActive / isContentGateOff', () => {
    it('parental vale só ligado e trancado', () => {
        expect(isParentalActive(state({ parentalEnabled: true }))).toBe(true)
        expect(isParentalActive(state({ parentalEnabled: true, sessionUnlocked: true }))).toBe(false)
        expect(isParentalActive(state())).toBe(false)
    })

    it('gate desligado só quando não há perfil infantil nem parental valendo', () => {
        expect(isContentGateOff(state())).toBe(true)
        expect(isContentGateOff(state({ isKidsProfile: true }))).toBe(false)
        expect(isContentGateOff(state({ parentalEnabled: true }))).toBe(false)
    })
})

describe('isItemVisibleUnderGate', () => {
    it('esconde item de categoria bloqueada', () => {
        expect(visible({ categoryIds: ['66'], blockedCategoryIds: new Set(['66']) })).toBe(false)
    })

    it('série com várias categorias cai se QUALQUER uma estiver bloqueada', () => {
        expect(visible({ categoryIds: ['1', '66'], blockedCategoryIds: new Set(['66']) })).toBe(false)
    })

    it('deixa passar quando nenhuma categoria está bloqueada', () => {
        expect(visible({ categoryIds: ['1'], blockedCategoryIds: new Set(['66']) })).toBe(true)
    })

    it('esconde por classificação em cache com o parental valendo', () => {
        expect(visible({
            name: 'Filme Pesado',
            cachedRatings: new Map([['filme pesado', '18']]),
            isRatingBlocked: rating => rating === '18',
            state: state({ parentalEnabled: true }),
        })).toBe(false)
    })

    it('ignora a classificação com a sessão parental destravada', () => {
        expect(visible({
            name: 'Filme Pesado',
            cachedRatings: new Map([['filme pesado', '18']]),
            isRatingBlocked: rating => rating === '18',
            state: state({ parentalEnabled: true, sessionUnlocked: true }),
        })).toBe(true)
    })

    it('esconde do perfil infantil o que já foi marcado como oculto', () => {
        expect(visible({
            name: 'Filme: O Retorno!',
            hiddenNames: new Set([normalizeContentName('Filme: O Retorno!')]),
            state: state({ isKidsProfile: true }),
        })).toBe(false)
    })

    it('a lista de ocultos não afeta o perfil adulto', () => {
        expect(visible({
            name: 'Filme: O Retorno!',
            hiddenNames: new Set([normalizeContentName('Filme: O Retorno!')]),
        })).toBe(true)
    })
})

describe('isLiveCategoryVisible', () => {
    it('bloqueia categoria adulta ao vivo', () => {
        expect(isLiveCategoryVisible('66', {
            blockedCategoryIds: new Set(['66']),
            allowedCategoryIds: null,
        })).toBe(false)
    })

    it('perfil infantil só enxerga a whitelist', () => {
        const gate = { blockedCategoryIds: new Set<string>(), allowedCategoryIds: new Set(['9']) }
        expect(isLiveCategoryVisible('9', gate)).toBe(true)
        expect(isLiveCategoryVisible('3', gate)).toBe(false)
    })

    it('whitelist vazia não filtra (mesmo fallback da TV ao vivo)', () => {
        expect(isLiveCategoryVisible('3', {
            blockedCategoryIds: new Set<string>(),
            allowedCategoryIds: new Set<string>(),
        })).toBe(true)
    })
})

describe('regras de nome de categoria', () => {
    it('mantém a lista de bloqueio da grade', () => {
        expect(isCategoryNameBlocked('XXX Premium')).toBe(true)
        expect(isCategoryNameBlocked('Filmes | Ação')).toBe(false)
    })

    it('reconhece as categorias infantis da TV ao vivo', () => {
        expect(isCategoryNameKidsAllowed('CANAIS INFANTIS')).toBe(true)
        expect(isCategoryNameKidsAllowed('Kids')).toBe(true)
        expect(isCategoryNameKidsAllowed('Esportes')).toBe(false)
    })
})

describe('toCategoryIds', () => {
    it('normaliza id numérico do filme (66 nunca pode escapar de "66")', () => {
        expect(toCategoryIds(66)).toEqual(['66'])
    })

    it('normaliza lista de ids da série', () => {
        expect(toCategoryIds(['1', 66])).toEqual(['1', '66'])
    })

    it('trata ausente como categoria vazia', () => {
        expect(toCategoryIds(undefined)).toEqual([''])
        expect(toCategoryIds(null)).toEqual([''])
    })

    it('id numérico casa com o conjunto bloqueado (que é de strings)', () => {
        expect(visible({ categoryIds: toCategoryIds(66), blockedCategoryIds: new Set(['66']) })).toBe(false)
    })
})
