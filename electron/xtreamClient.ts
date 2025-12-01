export interface XtreamAccount {
    username: string
    password: string
    url: string
}

export interface XtreamResponse {
    user_info: any
    server_info: any
}

export class XtreamClient {
    private baseUrl: string
    private username: string
    private password: string

    constructor(url: string, username: string, password: string) {
        this.baseUrl = url.endsWith('/') ? url.slice(0, -1) : url
        this.username = username
        this.password = password
    }

    private async fetch(action: string, params: Record<string, string> = {}) {
        const url = new URL(`${this.baseUrl}/player_api.php`)
        url.searchParams.append('username', this.username)
        url.searchParams.append('password', this.password)
        url.searchParams.append('action', action)

        for (const [key, value] of Object.entries(params)) {
            url.searchParams.append(key, value)
        }

        const response = await fetch(url.toString())
        if (!response.ok) {
    async getVODStreams() {
                return this.fetch('get_vod_streams')
            }

    async getSeries() {
                return this.fetch('get_series')
            }
        }
