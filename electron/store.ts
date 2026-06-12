import Store from 'electron-store'

interface StoreSchema {
    auth: {
        url?: string
        username?: string
        password?: string
        userInfo?: unknown
    }
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
