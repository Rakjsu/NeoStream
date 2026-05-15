import { describe, it, expect, beforeEach } from 'vitest'
import { parentalService } from './parentalService'

beforeEach(() => {
    // Reset the in-memory localStorage between tests, then reset the
    // singleton's state via setConfig so each test starts from defaults.
    localStorage.clear()
    sessionStorage.clear()
    parentalService.setConfig({
        enabled: false,
        pin: null,
        maxRating: '18',
        blockAdultCategories: true,
        filterByTMDB: true,
    })
    parentalService.lockSession()
})

describe('parentalService PIN', () => {
    it('starts without a PIN', () => {
        expect(parentalService.hasPin()).toBe(false)
        expect(parentalService.verifyPin('0000')).toBe(false)
    })

    it('stores and verifies a PIN', () => {
        parentalService.setPin('1234')
        expect(parentalService.hasPin()).toBe(true)
        expect(parentalService.verifyPin('1234')).toBe(true)
        expect(parentalService.verifyPin('9999')).toBe(false)
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
