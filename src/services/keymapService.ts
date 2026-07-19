/**
 * ⌨️ Atalhos personalizáveis do player: cada ação tem uma tecla-letra que o
 * usuário pode trocar no overlay "?" (as teclas estruturais — espaço, setas,
 * vírgula/ponto e Esc — são fixas). Persistido em localStorage e incluído no
 * backup completo.
 */

export type PlayerAction =
    | 'togglePlay' | 'seekBack' | 'seekForward' | 'mute' | 'fullscreen'
    | 'subtitles' | 'stats' | 'bookmark' | 'abLoop' | 'screenshot'
    | 'videoFilter' | 'normalize';

export const KEYMAP_STORAGE_KEY = 'neostream_keymap_v1';

export const DEFAULT_LETTERS: Record<PlayerAction, string> = {
    togglePlay: 'k',
    seekBack: 'j',
    seekForward: 'l',
    mute: 'm',
    fullscreen: 'f',
    subtitles: 'c',
    stats: 'i',
    bookmark: 'x',
    abLoop: 'b',
    screenshot: 's',
    videoFilter: 'v',
    normalize: 'n',
};

// Teclas estruturais que sempre acompanham a ação, independente da letra.
const FIXED_KEYS: Partial<Record<PlayerAction, string[]>> = {
    togglePlay: [' '],
    seekBack: ['arrowleft'],
    seekForward: ['arrowright'],
};

// Reservadas pra funções fixas do player/overlay — nunca reatribuíveis.
const RESERVED = new Set([' ', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', ',', '.', 'escape', '?']);

export type SetLetterResult = 'ok' | 'invalid' | 'reserved' | 'conflict';

function readOverrides(): Partial<Record<PlayerAction, string>> {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(KEYMAP_STORAGE_KEY) || '{}');
        if (!parsed || typeof parsed !== 'object') return {};
        const out: Partial<Record<PlayerAction, string>> = {};
        for (const action of Object.keys(DEFAULT_LETTERS) as PlayerAction[]) {
            const value = (parsed as Record<string, unknown>)[action];
            if (typeof value === 'string' && /^[a-z0-9]$/.test(value)) out[action] = value;
        }
        return out;
    } catch {
        return {};
    }
}

class KeymapService {
    // O handler de keydown do player consulta a cada tecla — cacheado aqui.
    private cache: Record<string, PlayerAction> | null = null;

    getLetters(): Record<PlayerAction, string> {
        return { ...DEFAULT_LETTERS, ...readOverrides() };
    }

    getKeyToAction(): Record<string, PlayerAction> {
        if (this.cache) return this.cache;
        const map: Record<string, PlayerAction> = {};
        for (const [action, keys] of Object.entries(FIXED_KEYS) as [PlayerAction, string[]][]) {
            for (const key of keys) map[key] = action;
        }
        for (const [action, letter] of Object.entries(this.getLetters()) as [PlayerAction, string][]) {
            map[letter] = action;
        }
        this.cache = map;
        return map;
    }

    setLetter(action: PlayerAction, rawKey: string): SetLetterResult {
        const key = rawKey.toLowerCase();
        if (!/^[a-z0-9]$/.test(key)) return RESERVED.has(key) ? 'reserved' : 'invalid';
        const letters = this.getLetters();
        const holder = (Object.keys(letters) as PlayerAction[]).find(a => letters[a] === key);
        if (holder && holder !== action) return 'conflict';
        const overrides = readOverrides();
        if (key === DEFAULT_LETTERS[action]) delete overrides[action];
        else overrides[action] = key;
        localStorage.setItem(KEYMAP_STORAGE_KEY, JSON.stringify(overrides));
        this.cache = null;
        window.dispatchEvent(new Event('neostream:keymap'));
        return 'ok';
    }

    resetLetters(): void {
        localStorage.removeItem(KEYMAP_STORAGE_KEY);
        this.cache = null;
        window.dispatchEvent(new Event('neostream:keymap'));
    }
}

export const keymapService = new KeymapService();
