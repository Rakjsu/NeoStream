import { describe, it, expect } from 'vitest'
import { isConcurrentSafeSource } from './playerExtras'

/**
 * 🔒 Regressão do "filme/série não inicia" (v4.42.x).
 *
 * O preview de miniatura monta um 2º <video> com a MESMA fonte do player.
 * Em provedor Xtream (limite de 1 conexão por conta), a 2ª conexão derruba a
 * reprodução principal. Por isso o preview só pode carregar a fonte quando ela
 * é local/baixada — nunca num stream remoto do provedor.
 */
describe('isConcurrentSafeSource', () => {
    it('bloqueia streams remotos do provedor (a causa do bug)', () => {
        expect(isConcurrentSafeSource('http://provedor.tv:8080/movie/user/pass/123.mp4')).toBe(false)
        expect(isConcurrentSafeSource('https://cdn.exemplo.com/live/canal.m3u8')).toBe(false)
        expect(isConcurrentSafeSource('http://10.0.0.5/vod/filme.mkv')).toBe(false)
    })

    it('libera fontes locais/baixadas (leitura concorrente é grátis)', () => {
        expect(isConcurrentSafeSource('blob:http://localhost/uuid')).toBe(true)
        expect(isConcurrentSafeSource('file:///C:/Users/me/Downloads/filme.mp4')).toBe(true)
        expect(isConcurrentSafeSource('http://127.0.0.1:52341/dl/filme.mp4')).toBe(true)
        expect(isConcurrentSafeSource('http://localhost:8080/transcode/live.m3u8')).toBe(true)
    })

    it('não confunde host que apenas contém "localhost"', () => {
        expect(isConcurrentSafeSource('http://localhost.evil.com/x.mp4')).toBe(false)
        expect(isConcurrentSafeSource('http://127.0.0.1.evil.com/x.mp4')).toBe(false)
    })
})
