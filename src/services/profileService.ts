import type { Profile, ProfilesData, CreateProfileData, UpdateProfileData } from '../types/profile';
import { syncTombstones, tombstoneItemKey } from './syncTombstones';
import { logParentalEvent } from './parentalLogService';
import { readJson } from './storageJsonCache';
import { randomSaltHex, hashPinSalgado, hashPinLegado } from './pinCrypto';

const STORAGE_KEY = 'neostream_profiles';
const MAX_PROFILES = 5;

/** PIN novo: sorteia o sal e devolve o par pra gravar junto. */
async function novoPinHash(pin: string): Promise<{ pin: string; pinSalt: string }> {
    const pinSalt = randomSaltHex();
    return { pin: await hashPinSalgado(pin, pinSalt), pinSalt };
}

// Get all data from storage
// getActiveProfile() é chamado várias vezes por card das grades (todo serviço
// de estado do usuário começa por ele), então a leitura passa pelo cache de
// parse — que revalida pela string crua e devolve o mesmo objeto enquanto o
// texto não muda. Todos os mutadores daqui leem, mutam e SALVAM em seguida.
function getStorageData(): ProfilesData {
    return readJson<ProfilesData>(STORAGE_KEY, { profiles: [], activeProfileId: null });
}

// Save data to storage
function saveStorageData(data: ProfilesData): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
        console.error('Error saving profiles to storage:', error);
    }
}

export const GUEST_PROFILE_ID = 'guest';

/**
 * Wipe every per-profile localStorage key belonging to the guest profile.
 * Matches `<base>_guest` and `<base>_guest__pl_<playlistId>` forms.
 */
function purgeGuestData(): void {
    const pattern = /_guest(__pl_|$)/;
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && pattern.test(key)) doomed.push(key);
    }
    doomed.forEach(key => localStorage.removeItem(key));
}

// Generate unique ID
function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

/**
 * Reescreve um PIN legado no formato salgado. Roda no acerto do PIN — o único
 * instante em que o app conhece o PIN em texto.
 *
 * Relê o storage DEPOIS do hash de propósito: o blob `neostream_profiles` tem
 * outros escritores (o `sync:apply-remote` do App.tsx e o `saveProfile` do
 * watchLater), e gravar um snapshot capturado antes do await desfaria a escrita
 * deles em silêncio.
 */
async function ressalgar(profileId: string, pin: string): Promise<void> {
    const pinSalt = randomSaltHex();
    const salgado = await hashPinSalgado(pin, pinSalt);
    const fresh = getStorageData();
    const alvo = fresh.profiles.find(p => p.id === profileId);
    if (!alvo) return;
    alvo.pin = salgado;
    alvo.pinSalt = pinSalt;
    saveStorageData(fresh);
}

export const profileService = {
    // Get all profiles
    getAllProfiles(): Profile[] {
        const data = getStorageData();
        return data.profiles;
    },

    // Get active profile
    getActiveProfile(): Profile | null {
        const data = getStorageData();
        if (!data.activeProfileId) return null;
        return data.profiles.find(p => p.id === data.activeProfileId) || null;
    },

    // Set active profile
    setActiveProfile(profileId: string): boolean {
        const data = getStorageData();
        const profile = data.profiles.find(p => p.id === profileId);
        if (!profile) return false;

        // Leaving the guest session: wipe its data and drop the entry.
        if (data.activeProfileId === GUEST_PROFILE_ID && profileId !== GUEST_PROFILE_ID) {
            purgeGuestData();
            data.profiles = data.profiles.filter(p => p.id !== GUEST_PROFILE_ID);
        }

        data.activeProfileId = profileId;
        profile.lastUsed = new Date().toISOString();
        saveStorageData(data);

        // Profile-personalized accent: switching profiles re-themes the app.
        if (profile.accentColor) {
            void import('./themeService').then(({ themeService, ACCENT_PRESETS }) => {
                if (ACCENT_PRESETS.some(p => p.id === profile.accentColor)) {
                    themeService.setTheme({ accent: profile.accentColor as typeof ACCENT_PRESETS[number]['id'] });
                }
            });
        }
        return true;
    },

    // Clear active profile (logout)
    clearActiveProfile(): void {
        const data = getStorageData();
        if (data.activeProfileId === GUEST_PROFILE_ID) {
            purgeGuestData();
            data.profiles = data.profiles.filter(p => p.id !== GUEST_PROFILE_ID);
        }
        data.activeProfileId = null;
        saveStorageData(data);
    },

    /**
     * Start a fresh guest session: temporary profile that leaves no trace —
     * any previous guest data is wiped now, and again when the session ends
     * (profile switch or logout). Doesn't count toward the profile limit.
     */
    startGuestSession(): Profile {
        purgeGuestData();
        const data = getStorageData();
        const now = new Date().toISOString();
        const guest: Profile = {
            id: GUEST_PROFILE_ID,
            name: 'Convidado',
            avatar: '🎭',
            isGuest: true,
            watchLater: [],
            continueWatching: [],
            createdAt: now,
            lastUsed: now
        };
        data.profiles = [...data.profiles.filter(p => p.id !== GUEST_PROFILE_ID), guest];
        data.activeProfileId = GUEST_PROFILE_ID;
        saveStorageData(data);
        return guest;
    },

    /** True while a guest session is active. */
    isGuestActive(): boolean {
        return this.getActiveProfile()?.isGuest === true;
    },

    // Create new profile
    async createProfile(profileData: CreateProfileData): Promise<Profile | null> {
        const data = getStorageData();

        // Check limit (the transient guest entry doesn't count)
        if (data.profiles.filter(p => !p.isGuest).length >= MAX_PROFILES) {
            console.error(`Cannot create profile: maximum of ${MAX_PROFILES} profiles reached`);
            return null;
        }

        // Validate name
        if (!profileData.name || profileData.name.trim().length === 0) {
            console.error('Profile name is required');
            return null;
        }

        if (profileData.name.length > 20) {
            console.error('Profile name must be 20 characters or less');
            return null;
        }

        const now = new Date().toISOString();
        const newProfile: Profile = {
            id: generateId(),
            name: profileData.name.trim(),
            avatar: profileData.avatar,
            ...(profileData.pin ? await novoPinHash(profileData.pin) : {}),
            isKids: profileData.isKids || false,
            accentColor: profileData.accentColor,
            watchLater: [],
            continueWatching: [],
            createdAt: now,
            lastUsed: now
        };

        data.profiles.push(newProfile);

        // If this is the first profile, set it as active
        if (data.profiles.length === 1) {
            data.activeProfileId = newProfile.id;
        }

        saveStorageData(data);
        return newProfile;
    },

    // Update profile
    async updateProfile(profileId: string, updates: UpdateProfileData): Promise<boolean> {
        const data = getStorageData();
        const profile = data.profiles.find(p => p.id === profileId);
        if (!profile) return false;

        if (updates.name !== undefined) {
            if (updates.name.trim().length === 0 || updates.name.length > 20) {
                console.error('Invalid profile name');
                return false;
            }
            profile.name = updates.name.trim();
        }

        if (updates.avatar !== undefined) {
            profile.avatar = updates.avatar;
        }

        if (updates.pin !== undefined) {
            if (updates.pin === null) {
                // Remove PIN — o sal vai junto, senão sobra sal órfão apontando
                // pra um formato que não existe mais neste registro.
                delete profile.pin;
                delete profile.pinSalt;
            } else {
                const novo = await novoPinHash(updates.pin);
                profile.pin = novo.pin;
                profile.pinSalt = novo.pinSalt;
            }
        }

        if (updates.preferredQuality !== undefined) {
            profile.preferredQuality = updates.preferredQuality;
        }

        if (updates.accentColor !== undefined) {
            profile.accentColor = updates.accentColor;
        }

        saveStorageData(data);
        return true;
    },

    // Get preferred quality for active profile
    getPreferredQuality(): '4k' | 'fhd' | 'hd' | 'sd' | 'auto' {
        const profile = this.getActiveProfile();
        return profile?.preferredQuality || 'auto';
    },

    // Set preferred quality for active profile
    async setPreferredQuality(quality: '4k' | 'fhd' | 'hd' | 'sd' | 'auto'): Promise<boolean> {
        const profile = this.getActiveProfile();
        if (!profile) return false;
        return this.updateProfile(profile.id, { preferredQuality: quality });
    },

    // Delete profile
    deleteProfile(profileId: string): boolean {
        const data = getStorageData();

        // Cannot delete active profile
        if (data.activeProfileId === profileId) {
            console.error('Cannot delete active profile');
            return false;
        }

        const index = data.profiles.findIndex(p => p.id === profileId);
        if (index === -1) return false;

        data.profiles.splice(index, 1);
        saveStorageData(data);
        // Ledger de deleções: sem tombstone o unionById do sync trata o perfil
        // como "novidade do outro lado" e ele volta no ciclo seguinte, já
        // religado aos dados antigos (que nunca foram apagados).
        syncTombstones.record(STORAGE_KEY, tombstoneItemKey(profileId));
        return true;
    },

    // Verify PIN
    async verifyPin(profileId: string, pin: string): Promise<boolean> {
        const profile = getStorageData().profiles.find(p => p.id === profileId);
        if (!profile) return false;

        // No PIN set
        if (!profile.pin) return true;

        // O critério é "o hash salgado bateu?", NÃO "existe pinSalt?". Um perfil
        // pode chegar aqui com sal presente e hash no formato antigo: ele nasce
        // migrado numa máquina, viaja inteiro pelo sync, e uma build antiga na
        // outra ponta regrava só o `pin`. Decidir pela presença do sal deixaria
        // esse perfil TRANCADO pra sempre — e apagar o perfil também pede PIN.
        let ok = profile.pinSalt
            ? (await hashPinSalgado(pin, profile.pinSalt)) === profile.pin
            : false;

        if (!ok && (await hashPinLegado(pin)) === profile.pin) {
            ok = true;
            await ressalgar(profileId, pin);
        }

        logParentalEvent(ok ? 'pin_ok' : 'pin_fail', `PIN do perfil ${profile.name}`);
        return ok;
    },

    // Check if profile has PIN
    /** 👶 União das whitelists de canais de todos os perfis kids. */
    getKidsAllowedChannelIds(): Set<string> {
        const data = getStorageData();
        const ids = new Set<string>();
        for (const profile of data.profiles) {
            if (!profile.isKids) continue;
            for (const id of profile.allowedChannelIds ?? []) ids.add(id);
        }
        return ids;
    },

    /**
     * Alterna um canal na whitelist dos perfis kids: presente em algum →
     * remove de todos; ausente → adiciona a todos (gestão em conjunto).
     */
    toggleKidsChannel(streamId: string): { allowed: boolean; kidsCount: number } {
        const data = getStorageData();
        const kids = data.profiles.filter(p => p.isKids);
        if (kids.length === 0) return { allowed: false, kidsCount: 0 };
        const present = kids.some(p => (p.allowedChannelIds ?? []).includes(streamId));
        for (const profile of kids) {
            const current = new Set(profile.allowedChannelIds ?? []);
            if (present) current.delete(streamId);
            else current.add(streamId);
            profile.allowedChannelIds = [...current];
        }
        saveStorageData(data);
        return { allowed: !present, kidsCount: kids.length };
    },

    hasPin(profileId: string): boolean {
        const data = getStorageData();
        const profile = data.profiles.find(p => p.id === profileId);
        return profile ? !!profile.pin : false;
    },

    // Migrate existing Watch Later data to default profile
    migrateExistingData(): void {
        const data = getStorageData();

        // Only migrate if no profiles exist
        if (data.profiles.length > 0) return;

        try {
            // Check for old Watch Later data
            const oldWatchLater = localStorage.getItem('watchLater');
            if (oldWatchLater) {
                const items = JSON.parse(oldWatchLater);

                // Create default profile with old data
                const now = new Date().toISOString();
                const defaultProfile: Profile = {
                    id: 'default',
                    name: 'Default',
                    avatar: '👤',
                    watchLater: items,
                    continueWatching: [],
                    createdAt: now,
                    lastUsed: now
                };

                data.profiles.push(defaultProfile);
                data.activeProfileId = 'default';
                saveStorageData(data);

                // Remove old data
                localStorage.removeItem('watchLater');
            }
        } catch (error) {
            console.error('Error migrating existing data:', error);
        }
    },

    // Initialize (call on app start)
    initialize(): void {
        this.migrateExistingData();

        // Create default Kids profile if no profiles exist
        const data = getStorageData();
        if (data.profiles.length === 0) {
            const now = new Date().toISOString();
            const kidsProfile: Profile = {
                id: 'kids-default',
                name: 'Kids',
                avatar: '👶',
                isKids: true,
                watchLater: [],
                continueWatching: [],
                createdAt: now,
                lastUsed: now
            };
            data.profiles.push(kidsProfile);
            saveStorageData(data);
        }
    }
};
