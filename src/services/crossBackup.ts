/**
 * 🔗 Ecossistema desktop ↔ celular: leitura do backup do NeoStream Mobile
 * (app 'neostream-mobile', v1–v5) pra importar as contas como playlists.
 * Parse PURO; quem grava é o main (IPC playlists:import-mobile).
 */

export interface MobileAccountImport {
    name?: string;
    url: string;
    username: string;
    password: string;
    type: 'xtream' | 'm3u' | 'stalker';
}

export interface MobileBackupParseResult {
    accounts: MobileAccountImport[];
    error?: 'encrypted' | 'invalid';
}

/** Prefixo dos backups protegidos por senha no mobile (crypto-js AES). */
const MOBILE_ENC_PREFIX = 'NEOENC1:';

export function parseMobileBackupAccounts(text: string): MobileBackupParseResult {
    if (text.trim().startsWith(MOBILE_ENC_PREFIX)) return { accounts: [], error: 'encrypted' };
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { accounts: [], error: 'invalid' };
    }
    const backup = parsed as { app?: string; accounts?: unknown } | null;
    if (!backup || backup.app !== 'neostream-mobile' || !Array.isArray(backup.accounts)) {
        return { accounts: [], error: 'invalid' };
    }
    const accounts: MobileAccountImport[] = [];
    for (const raw of backup.accounts) {
        const account = raw as { url?: unknown; username?: unknown; password?: unknown; type?: unknown; alias?: unknown } | null;
        if (!account || typeof account.url !== 'string' || !account.url.trim()) continue;
        accounts.push({
            name: typeof account.alias === 'string' && account.alias.trim() ? account.alias.trim() : undefined,
            url: account.url,
            username: typeof account.username === 'string' ? account.username : '',
            password: typeof account.password === 'string' ? account.password : '',
            type: account.type === 'm3u' || account.type === 'stalker' ? account.type : 'xtream',
        });
    }
    return accounts.length > 0 ? { accounts } : { accounts: [], error: 'invalid' };
}
