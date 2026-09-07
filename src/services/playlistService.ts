import { hasTmdbApiKey, setTmdbOnboardingPending } from './tmdbKey'

// Playlist Service - thin renderer wrapper over the playlists:* IPC surface.
//
// Data separation (v1): favorites / watch-later / history / watch progress
// are GLOBAL across playlists (they key by stream ids, which differ per
// provider — collisions are possible but accepted). Provider-derived caches
// (content fetch timestamp, EPG test results) are cleared on switch and the
// app reloads so every page refetches from the new provider.

export interface PlaylistSummary {
    id: string
    name: string
    url: string
    username: string
    active: boolean
    type: 'xtream' | 'm3u' | 'stalker'
}

interface IpcResult {
    success: boolean
    error?: string
}

export const playlistService = {
    async list(): Promise<PlaylistSummary[]> {
        const result = await window.ipcRenderer.invoke('playlists:list') as IpcResult & {
            playlists?: PlaylistSummary[]
        }
        return result.success && Array.isArray(result.playlists) ? result.playlists : []
    },

    async add(input: { name?: string; url: string; username: string; password: string }): Promise<IpcResult> {
        return await window.ipcRenderer.invoke('playlists:add', input) as IpcResult
    },

    async addM3u(input: { name?: string; url: string }): Promise<IpcResult & { channelCount?: number }> {
        return await window.ipcRenderer.invoke('playlists:add-m3u', input) as IpcResult & { channelCount?: number }
    },

    /**
     * Lista M3U de um arquivo do computador. Não recebe caminho: quem abre o
     * diálogo do sistema é o processo principal, e o caminho escolhido nunca
     * passa pelo renderer (`playlists:add-m3u-file`).
     */
    async addM3uFromFile(input: { name?: string } = {}): Promise<IpcResult & { channelCount?: number; canceled?: boolean; fileName?: string }> {
        return await window.ipcRenderer.invoke('playlists:add-m3u-file', input) as IpcResult & { channelCount?: number; canceled?: boolean; fileName?: string }
    },

    async addStalker(input: { name?: string; url: string; mac: string }): Promise<IpcResult & { channelCount?: number }> {
        return await window.ipcRenderer.invoke('playlists:add-stalker', input) as IpcResult & { channelCount?: number }
    },

    async switchTo(id: string): Promise<IpcResult> {
        return await window.ipcRenderer.invoke('playlists:switch', { id }) as IpcResult
    },

    async remove(id: string): Promise<IpcResult & { loggedOut?: boolean }> {
        return await window.ipcRenderer.invoke('playlists:remove', { id }) as IpcResult & { loggedOut?: boolean }
    },

    async rename(id: string, name: string): Promise<IpcResult> {
        return await window.ipcRenderer.invoke('playlists:rename', { id, name }) as IpcResult
    },

    /** Drop localStorage caches that are derived from the active provider. */
    clearProviderCaches(): void {
        try {
            localStorage.removeItem('contentLastFetch')
            localStorage.removeItem('epg_test_results')
        } catch {
            // localStorage unavailable — reload below still refetches everything
        }
    },

    /**
     * Full restart of the renderer on the dashboard after a provider change.
     * With `promptTmdbOnboarding` (playlist just ADDED) and no TMDB key yet,
     * the dashboard redirects once to Configurações → APIs explaining why and
     * how to create the user's own free key.
     */
    reloadIntoDashboard(promptTmdbOnboarding = false): void {
        if (promptTmdbOnboarding && !hasTmdbApiKey()) setTmdbOnboardingPending()
        this.clearProviderCaches()
        window.location.hash = '#/dashboard'
        window.location.reload()
    }
}
