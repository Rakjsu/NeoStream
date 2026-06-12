import Store from 'electron-store'
import type { PlaylistEntry } from './playlistsModel'

interface StoreSchema {
    // MIRROR of the active playlist's credentials (see playlistsModel.ts).
    // All existing main-process code keeps reading 'auth' unchanged.
    auth: {
        url?: string
        username?: string
        password?: string
        userInfo?: unknown
    }
    playlists: PlaylistEntry[]
    activePlaylistId?: string
    favorites: unknown[]
    history: unknown[]
    settings: {
        theme?: string
        language?: string
        player?: unknown
        allowInvalidProviderCertificates?: boolean
        approvedProviderHosts?: string[]
        // EXPERIMENTAL — user-configured mpv.exe path for the MPV PoC (mpvPlayer.ts)
        mpvPath?: string
    }
}

const store = new Store<StoreSchema>({
    defaults: {
        auth: {},
        playlists: [],
        favorites: [],
        history: [],
        settings: {
            theme: 'dark',
            language: 'en',
            allowInvalidProviderCertificates: true,
            approvedProviderHosts: []
        }
    }
})

export default store
