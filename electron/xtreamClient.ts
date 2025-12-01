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
            throw new Error(`Xtream API Error: ${response.statusText}`)
        }
        return response.json()
    }

    async authenticate(): Promise<XtreamResponse> {
        try {
            const url = new URL(`${this.baseUrl}/player_api.php`);
            url.searchParams.append('username', this.username);
            url.searchParams.append('password', this.password);

            const fullUrl = url.toString();
            console.log('[XtreamClient] Authenticating to:', fullUrl.replace(this.password, '***'));

            const response = await fetch(fullUrl);

            console.log('[XtreamClient] Response status:', response.status, response.statusText);

            if (!response.ok) {
                throw new Error(`Authentication failed: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            console.log('[XtreamClient] Response data:', data);

            if (data.user_info && data.user_info.auth === 0) {
                throw new Error('Authentication failed: Invalid credentials');
            }

            if (!data.user_info) {
                throw new Error('Authentication failed: No user info in response');
            }

            console.log('[XtreamClient] Authentication successful');
            return data;
        } catch (error: any) {
            console.error('[XtreamClient] Authentication error:', error);

            // Melhorar mensagens de erro
            if (error.message.includes('fetch')) {
                throw new Error(`Não foi possível conectar ao servidor ${this.baseUrl}. Verifique se a URL está correta e o servidor está online.`);
            }

            throw error;
        }
    }

    async getLiveStreams() {
        return this.fetch('get_live_streams')
    }

    async getVODStreams() {
        return this.fetch('get_vod_streams')
    }

    async getSeries() {
        return this.fetch('get_series')
    }
}
