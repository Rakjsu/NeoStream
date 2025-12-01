import https from 'https'
import http from 'http'

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

    private async httpRequest(urlString: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const url = new URL(urlString);
            const client = url.protocol === 'https:' ? https : http;

            console.log('[XtreamClient] Making request to:', urlString.replace(this.password, '***'));

            const req = client.get(urlString, (res) => {
                let data = '';

                console.log('[XtreamClient] Response status:', res.statusCode, res.statusMessage);

                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                    return;
                }

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        console.log('[XtreamClient] Response data:', parsed);
                        resolve(parsed);
                    } catch (error) {
                        console.error('[XtreamClient] JSON parse error:', error);
                        reject(new Error('Invalid JSON response'));
                    }
                });
            });

            req.on('error', (error) => {
                console.error('[XtreamClient] Request error:', error);
                reject(error);
            });

            req.setTimeout(15000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
        });
    }

    private async makeRequest(action: string, params: Record<string, string> = {}) {
        const url = new URL(`${this.baseUrl}/player_api.php`)
        url.searchParams.append('username', this.username)
        url.searchParams.append('password', this.password)
        url.searchParams.append('action', action)

        for (const [key, value] of Object.entries(params)) {
            url.searchParams.append(key, value)
        }

        return this.httpRequest(url.toString());
    }

    async authenticate(): Promise<XtreamResponse> {
        try {
            const url = new URL(`${this.baseUrl}/player_api.php`);
            url.searchParams.append('username', this.username);
            url.searchParams.append('password', this.password);

            const fullUrl = url.toString();
            console.log('[XtreamClient] Authenticating...');

            const data = await this.httpRequest(fullUrl);

            if (data.user_info && data.user_info.auth === 0) {
                throw new Error('Usuário ou senha incorretos');
            }

            if (!data.user_info) {
                throw new Error('Resposta inválida do servidor - sem informações de usuário');
            }

            console.log('[XtreamClient] Authentication successful');
            return data;
        } catch (error: any) {
            console.error('[XtreamClient] Authentication error:', error);

            // Mensagens de erro mais específicas
            if (error.code === 'ENOTFOUND') {
                throw new Error(`Servidor não encontrado: ${this.baseUrl}\n\nVerifique se a URL está correta.`);
            }

            if (error.code === 'ECONNREFUSED') {
                throw new Error(`Conexão recusada: ${this.baseUrl}\n\nO servidor pode estar offline.`);
            }

            if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
                throw new Error(`Tempo esgotado ao conectar em: ${this.baseUrl}\n\nO servidor demorou muito para responder.`);
            }

            throw error;
        }
    }

    async getLiveStreams() {
        return this.makeRequest('get_live_streams')
    }

    async getVODStreams() {
        return this.makeRequest('get_vod_streams')
    }

    async getSeries() {
        return this.makeRequest('get_series')
    }
}
