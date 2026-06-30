import { describe, it, expect, beforeEach } from 'vitest'
import {
    normalizeForSearch,
    scoreMatch,
    rankItems,
    getRecentSearches,
    addRecentSearch,
    clearRecentSearches,
    RECENT_SEARCHES_KEY,
    MAX_RECENT_SEARCHES
} from './searchRank'

describe('normalizeForSearch', () => {
    it('lowercases and trims', () => {
        expect(normalizeForSearch('  Hello World  ')).toBe('hello world')
    })

    it('strips diacritics', () => {
        expect(normalizeForSearch('São Paulo')).toBe('sao paulo')
        expect(normalizeForSearch('Ação')).toBe('acao')
        expect(normalizeForSearch('Pelé')).toBe('pele')
        expect(normalizeForSearch('Niño')).toBe('nino')
    })

    it('makes accented and unaccented forms compare equal', () => {
        expect(normalizeForSearch('açao')).toBe(normalizeForSearch('acao'))
        expect(normalizeForSearch('São')).toBe(normalizeForSearch('sao'))
    })
})

describe('scoreMatch', () => {
    it('returns 0 for no match', () => {
        expect(scoreMatch('zzz', 'James Bond')).toBe(0)
    })

    it('returns 0 for empty query or empty name', () => {
        expect(scoreMatch('', 'James Bond')).toBe(0)
        expect(scoreMatch('   ', 'James Bond')).toBe(0)
        expect(scoreMatch('bond', '')).toBe(0)
    })

    it('exact match outranks prefix', () => {
        expect(scoreMatch('bond', 'Bond')).toBeGreaterThan(scoreMatch('bond', 'Bond Movie'))
    })

    it('prefix outranks word-boundary', () => {
        // "star" as prefix of "Star Wars" vs "star" after a space in "The Star"
        expect(scoreMatch('star', 'Star Wars')).toBeGreaterThan(scoreMatch('star', 'The Star'))
    })

    it('word-boundary outranks mid-word substring', () => {
        // "war" at word boundary in "Star War" vs mid-word in "Warehouse"... use clearer case
        expect(scoreMatch('wars', 'Star Wars')).toBeGreaterThan(scoreMatch('wars', 'Starwarship'))
    })

    it('substring outranks subsequence (fuzzy)', () => {
        // "bond" is a contiguous substring of "James Bond"
        const substring = scoreMatch('bond', 'James Bond')
        // "jbond" only matches as a subsequence of "James Bond"
        const subseq = scoreMatch('jbond', 'James Bond')
        expect(substring).toBeGreaterThan(subseq)
        expect(subseq).toBeGreaterThan(0)
    })

    it('matches subsequence/fuzzy queries', () => {
        expect(scoreMatch('jbond', 'James Bond')).toBeGreaterThan(0)
        expect(scoreMatch('strwars', 'Star Wars')).toBeGreaterThan(0)
    })

    it('is diacritics-insensitive', () => {
        expect(scoreMatch('sao', 'São Paulo')).toBeGreaterThan(0)
        expect(scoreMatch('São', 'sao paulo')).toBeGreaterThan(0)
        expect(scoreMatch('acao', 'Ação Total')).toBeGreaterThan(0)
    })

    it('is case-insensitive', () => {
        expect(scoreMatch('JAMES', 'james bond')).toBeGreaterThan(0)
    })

    it('ranks earlier match position higher (substring tiebreak)', () => {
        // "ar" appears at index 1 in "Bar" vs later in "Foo Bar Baz" -> earlier wins
        expect(scoreMatch('bar', 'Bar X')).toBeGreaterThan(scoreMatch('bar', 'Foo Bar'))
    })

    it('ranks shorter names higher on equal-band ties (exact stays exact)', () => {
        // both are prefix matches starting at 0; shorter name wins
        expect(scoreMatch('star', 'Star')).toBeGreaterThan(scoreMatch('star', 'Star Wars Episode'))
    })
})

describe('rankItems', () => {
    const items = [
        { name: 'Star Wars' },
        { name: 'The Star' },
        { name: 'Star' },
        { name: 'Starwarship' },
        { name: 'Unrelated' }
    ]
    const getName = (i: { name: string }) => i.name

    it('drops non-matching items', () => {
        const out = rankItems(items, 'star', getName, 10)
        expect(out.map(i => i.name)).not.toContain('Unrelated')
    })

    it('returns nothing for a query that matches nothing', () => {
        expect(rankItems(items, 'zzzzz', getName, 10)).toEqual([])
    })

    it('orders by score: exact > prefix(shorter) > word-boundary', () => {
        const out = rankItems(items, 'star', getName, 10).map(i => i.name)
        expect(out[0]).toBe('Star') // exact
        expect(out.indexOf('Star Wars')).toBeLessThan(out.indexOf('The Star'))
    })

    it('respects the limit', () => {
        const out = rankItems(items, 'star', getName, 2)
        expect(out).toHaveLength(2)
        expect(out[0].name).toBe('Star')
    })

    it('is stable on ties (preserves original order for equal scores)', () => {
        const tied = [{ name: 'Alpha One' }, { name: 'Alpha Two' }]
        const out = rankItems(tied, 'alpha', getName, 10).map(i => i.name)
        expect(out).toEqual(['Alpha One', 'Alpha Two'])
    })

    it('matches fuzzy/subsequence as a fallback', () => {
        const out = rankItems([{ name: 'James Bond' }], 'jbond', getName, 10)
        expect(out).toHaveLength(1)
    })
})

describe('recent searches', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('returns empty when nothing stored', () => {
        expect(getRecentSearches()).toEqual([])
    })

    it('adds and reads back a query', () => {
        addRecentSearch('star wars')
        expect(getRecentSearches()).toEqual(['star wars'])
    })

    it('puts most-recent first (unshift)', () => {
        addRecentSearch('first')
        addRecentSearch('second')
        expect(getRecentSearches()).toEqual(['second', 'first'])
    })

    it('dedupes (delete-then-unshift), keeping the latest position', () => {
        addRecentSearch('alpha')
        addRecentSearch('beta')
        addRecentSearch('alpha')
        expect(getRecentSearches()).toEqual(['alpha', 'beta'])
    })

    it('dedupes case- and diacritics-insensitively but stores the new casing', () => {
        addRecentSearch('São Paulo')
        addRecentSearch('sao paulo')
        const out = getRecentSearches()
        expect(out).toHaveLength(1)
        expect(out[0]).toBe('sao paulo')
    })

    it('caps at MAX_RECENT_SEARCHES', () => {
        for (let i = 0; i < MAX_RECENT_SEARCHES + 5; i++) {
            addRecentSearch(`query ${i}`)
        }
        const out = getRecentSearches()
        expect(out).toHaveLength(MAX_RECENT_SEARCHES)
        // newest first
        expect(out[0]).toBe(`query ${MAX_RECENT_SEARCHES + 4}`)
    })

    it('ignores empty/whitespace queries', () => {
        addRecentSearch('   ')
        addRecentSearch('')
        expect(getRecentSearches()).toEqual([])
    })

    it('trims before storing', () => {
        addRecentSearch('  spaced  ')
        expect(getRecentSearches()).toEqual(['spaced'])
    })

    it('clearRecentSearches empties the list', () => {
        addRecentSearch('x')
        clearRecentSearches()
        expect(getRecentSearches()).toEqual([])
    })

    it('tolerates corrupt stored JSON', () => {
        localStorage.setItem(RECENT_SEARCHES_KEY, '{not json')
        expect(getRecentSearches()).toEqual([])
    })

    it('ignores non-array / non-string entries', () => {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(['ok', 3, null, '']))
        expect(getRecentSearches()).toEqual(['ok'])
    })
})
