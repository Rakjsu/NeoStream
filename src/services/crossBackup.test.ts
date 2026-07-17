import { describe, expect, it } from 'vitest';
import { parseMobileBackupAccounts } from './crossBackup';

const mobileBackup = (accounts: unknown[]) => JSON.stringify({
    app: 'neostream-mobile',
    version: 5,
    accounts,
    activeId: null,
    favorites: {},
    progress: {},
    watched: [],
    parental: {}
});

describe('parseMobileBackupAccounts (backup do celular → playlists)', () => {
    it('extrai contas xtream/m3u/stalker com apelido', () => {
        const result = parseMobileBackupAccounts(mobileBackup([
            { id: 'a', url: 'http://host:8080', username: 'user', password: 'pw', type: 'xtream', alias: 'Casa' },
            { id: 'b', url: 'http://x/lista.m3u', username: '', password: '', type: 'm3u' },
            { id: 'c', url: 'http://portal/c/', username: '00:1A:79:AA:BB:CC', password: '', type: 'stalker' },
            { id: 'ruim', url: '   ' },
        ]));
        expect(result.error).toBeUndefined();
        expect(result.accounts).toHaveLength(3);
        expect(result.accounts[0]).toEqual({
            name: 'Casa', url: 'http://host:8080', username: 'user', password: 'pw', type: 'xtream'
        });
        expect(result.accounts[1].type).toBe('m3u');
        expect(result.accounts[2].type).toBe('stalker');
    });

    it('conta antiga sem type vira xtream', () => {
        const result = parseMobileBackupAccounts(mobileBackup([
            { id: 'a', url: 'http://h', username: 'u', password: 'p' }
        ]));
        expect(result.accounts[0].type).toBe('xtream');
    });

    it('rejeita backup criptografado, de outro app e JSON quebrado', () => {
        expect(parseMobileBackupAccounts('NEOENC1:abc').error).toBe('encrypted');
        expect(parseMobileBackupAccounts(JSON.stringify({ app: 'neostream', accounts: [] })).error).toBe('invalid');
        expect(parseMobileBackupAccounts('{oops').error).toBe('invalid');
        expect(parseMobileBackupAccounts(mobileBackup([])).error).toBe('invalid');
    });
});
