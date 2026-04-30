import Store from 'electron-store'

interface StoreSchema {
    auth: {
        url?: string
        username?: string
        password?: string
        userInfo?: any
    }
    favorites: any[]
    history: any[]
    settings: {
        theme?: string
        language?: string
        player?: any
        allowInvalidProviderCertificates?: boolean
        approvedProviderHosts?: string[]
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
