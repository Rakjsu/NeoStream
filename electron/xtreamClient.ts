import axios from 'axios'
import { getInvalidCertificateGuidance, getProviderHttpsAgent, isTlsCertificateError } from './certificatePolicy'

export interface XtreamAccount {
    username: string
    password: string
    url: string
}

export interface XtreamResponse {
    user_info: Record<string, unknown>
    server_info: Record<string, unknown>
}

interface NetworkError extends Error {
    code?: string
    request?: unknown
    response?: unknown
}

const isNetworkError = (error: unknown): error is NetworkError =>
    error instanceof Error

export class XtreamClient {
    private baseUrl: string
    private username: string
    private password: string

    constructor(url: string, username: string, password: string) {
        this.baseUrl = url.endsWith('/') ? url.slice(0, -1) : url
        this.username = username
        this.password = password
    }

    private async makeRequest(action: string, params: Record<string, string> = {}): Promise<unknown> {
        const url = new URL(`${this.baseUrl}/player_api.php`)
        url.searchParams.append('username', this.username)
        url.searchParams.append('password', this.password)
        url.searchParams.append('action', action)

        for (const [key, value] of Object.entries(params)) {
            url.searchParams.append(key, value)
        }

        const requestUrl = url.toString()
        let response
        try {
            response = await axios.get(requestUrl, {
                timeout: 15000,
                validateStatus: () => true,  // Don't throw on any status
                httpsAgent: getProviderHttpsAgent(requestUrl, this.baseUrl)
            })
        } catch (error: unknown) {
            if (isTlsCertificateError(error)) {
                throw new Error(getInvalidCertificateGuidance())
            }

            throw error
        }

        if (response.status !== 200) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        return response.data
    }

    async authenticate(): Promise<XtreamResponse> {
        try {
            const url = new URL(`${this.baseUrl}/player_api.php`);
            url.searchParams.append('username', this.username);
            url.searchParams.append('password', this.password);

            const fullUrl = url.toString();
            console.log('[XtreamClient] Authenticating to:', fullUrl.replace(this.password, '***'));

            const response = await axios.get(fullUrl, {
                timeout: 15000,
                validateStatus: () => true,  // Don't throw on any status
                httpsAgent: getProviderHttpsAgent(fullUrl, this.baseUrl)
            });

            console.log('[XtreamClient] Response status:', response.status, response.statusText);
            console.log('[XtreamClient] Response data:', response.data);

            if (response.status !== 200) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = response.data;

            if (data.user_info && data.user_info.auth === 0) {
                throw new Error('Usuário ou senha incorretos');
            }

            if (!data.user_info) {
                throw new Error('Resposta inválida do servidor - sem informações de usuário');
            }

            console.log('[XtreamClient] Authentication successful');
            return data;
        } catch (error: unknown) {
            console.error('[XtreamClient] Authentication error:', error);

            // Mensagens de erro mais específicas
            if (isNetworkError(error) && (error.code === 'ENOTFOUND' || error.message.includes('ENOTFOUND'))) {
                throw new Error(`Servidor não encontrado: ${this.baseUrl}\n\nVerifique se a URL está correta.`);
            }

            if (isNetworkError(error) && (error.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED'))) {
                throw new Error(`Conexão recusada: ${this.baseUrl}\n\nO servidor pode estar offline.`);
            }

            if (isNetworkError(error) && (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED' || error.message.includes('timeout'))) {
                throw new Error(`Tempo esgotado ao conectar em: ${this.baseUrl}\n\nO servidor demorou muito para responder.`);
            }

            if (isTlsCertificateError(error)) {
                throw new Error(getInvalidCertificateGuidance());
            }

            // Erro de rede genérico
            if (isNetworkError(error) && error.request && !error.response) {
                throw new Error(`Falha na conexão com: ${this.baseUrl}\n\nVerifique sua internet e se o servidor está acessível.`);
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

    async getLiveCategories() {
        return this.makeRequest('get_live_categories')
    }

    async getVodCategories() {
        return this.makeRequest('get_vod_categories')
    }

    async getSeriesCategories() {
        return this.makeRequest('get_series_categories')
    }

    // Build VOD stream URL
    getVodStreamUrl(streamId: number, container: string = 'mp4'): string {
        return `${this.baseUrl}/movie/${this.username}/${this.password}/${streamId}.${container}`
    }

    // Build live stream URL
    getLiveStreamUrl(streamId: number): string {
        return `${this.baseUrl}/live/${this.username}/${this.password}/${streamId}.m3u8`
    }

    // Build series episode URL
    getSeriesStreamUrl(streamId: number, container: string = 'mp4'): string {
        return `${this.baseUrl}/series/${this.username}/${this.password}/${streamId}.${container}`
    }
}
