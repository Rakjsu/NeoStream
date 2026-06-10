import { describe, it, expect, beforeEach } from 'vitest'
import { parentalService } from './parentalService'

beforeEach(() => {
    // Reset the in-memory localStorage between tests, then reset the
    // singleton's state via setConfig so each test starts from defaults.
    localStorage.clear()
    sessionStorage.clear()
    parentalService.setConfig({
        enabled: false,
        pinHash: null,
        pinSalt: null,
        maxRating: '18',
        blockAdultCategories: true,
        filterByTMDB: true,
    })
    parentalService.lockSession()
})

describe('parentalService PIN', () => {
    it('starts without a PIN', async () => {
        expect(parentalService.hasPin()).toBe(false)
        expect(await parentalService.verifyPin('0000')).toBe(false)
    })

    it('stores and verifies a PIN as salted hash (never plaintext)', async () => {
        await parentalService.setPin('1234')
        expect(parentalService.hasPin()).toBe(true)
        expect(await parentalService.verifyPin('1234')).toBe(true)
        expect(await parentalService.verifyPin('9999')).toBe(false)

        const stored = JSON.parse(localStorage.getItem('parentalConfig') || '{}')
        expect(stored.pin).toBeUndefined()
        expect(stored.pinHash).toMatch(/^[0-9a-f]{64}$/)
        expect(stored.pinSalt).toMatch(/^[0-9a-f]{32}$/)
        expect(JSON.stringify(stored)).not.toContain('1234')
    })

    it('uses a fresh salt on each setPin', async () => {
        await parentalService.setPin('1234')
        const first = parentalService.getConfig()
        await parentalService.setPin('1234')
        const second = parentalService.getConfig()
        expect(first.pinSalt).not.toBe(second.pinSalt)
        expect(first.pinHash).not.toBe(second.pinHash)
        // Same PIN still verifies after re-set
        expect(await parentalService.verifyPin('1234')).toBe(true)
    })

    it('session unlock toggles', () => {
        expect(parentalService.isSessionUnlocked()).toBe(false)
        parentalService.unlockSession()
        expect(parentalService.isSessionUnlocked()).toBe(true)
        parentalService.lockSession()
        expect(parentalService.isSessionUnlocked()).toBe(false)
    })
})

describe('parentalService.isContentBlocked', () => {
    it('never blocks when disabled', () => {
        parentalService.setConfig({ enabled: false, maxRating: 'L' })
        expect(parentalService.isContentBlocked('18')).toBe(false)
    })

    it('respects maxRating when enabled', () => {
        parentalService.setConfig({ enabled: true, maxRating: '12' })
        expect(parentalService.isContentBlocked('L')).toBe(false)
        expect(parentalService.isContentBlocked('10')).toBe(false)
        expect(parentalService.isContentBlocked('12')).toBe(false)
        expect(parentalService.isContentBlocked('14')).toBe(true)
        expect(parentalService.isContentBlocked('18')).toBe(true)
    })

    it('blocks "adult" tagged content when adult categories are blocked', () => {
        parentalService.setConfig({ enabled: true, blockAdultCategories: true, maxRating: '18' })
        expect(parentalService.isContentBlocked('adult')).toBe(true)
    })

    it('honours session unlock', () => {
        parentalService.setConfig({ enabled: true, maxRating: 'L' })
        parentalService.unlockSession()
        expect(parentalService.isContentBlocked('18')).toBe(false)
    })
})

describe('parentalService.shouldHideContent', () => {
    it('hides categories matching adult keywords', () => {
        parentalService.setConfig({ enabled: true, blockAdultCategories: true })
        expect(parentalService.shouldHideContent('XXX Adultos')).toBe(true)
        expect(parentalService.shouldHideContent('Erotic Movies')).toBe(true)
        expect(parentalService.shouldHideContent('Cartoons')).toBe(false)
    })

    it('returns false when disabled', () => {
        parentalService.setConfig({ enabled: false, blockAdultCategories: true })
        expect(parentalService.shouldHideContent('XXX')).toBe(false)
    })
})
