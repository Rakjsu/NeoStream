/**
 * Testes do redator central de credenciais (função pura, sem Electron).
 *
 * Cada bloco usa a saída REAL do formato que produz o vazamento — a linha do
 * `util.inspect` que o electron-log grava no arquivo, a URL Xtream com a
 * credencial no caminho, o stderr do ffmpeg — e não uma versão idealizada.
 */
import { describe, it, expect } from 'vitest'
import { redactSecrets, redactLogLine, REDACTED } from './logRedaction'

describe('redactSecrets — credencial no CAMINHO da URL (Xtream)', () => {
    it('mascara usuário e senha de /live/, mantendo host e id do stream', () => {
        const out = redactSecrets('http://provedor.tv:8080/live/joao123/s3nh4Secreta/12345.ts')
        expect(out).not.toContain('joao123')
        expect(out).not.toContain('s3nh4Secreta')
        expect(out).toBe('http://provedor.tv:8080/live/***/***/12345.ts')
    })

    it('mascara /movie/, /series/ e /timeshift/', () => {
        expect(redactSecrets('http://p:8080/movie/u/senha/9.mkv')).toBe('http://p:8080/movie/***/***/9.mkv')
        expect(redactSecrets('http://p:8080/series/u/senha/77.mp4')).toBe('http://p:8080/series/***/***/77.mp4')
        expect(redactSecrets('http://p:8080/timeshift/u/senha/60/2026-01-01:10-00/1.m3u8'))
            .toBe('http://p:8080/timeshift/***/***/60/2026-01-01:10-00/1.m3u8')
    })

    it('mascara mesmo quando o id do stream não tem extensão', () => {
        expect(redactSecrets('http://p:8080/live/u/senha/12345')).toBe('http://p:8080/live/***/***/12345')
    })

    it('mascara na linha de erro do ffmpeg (extensão colada no ":" da mensagem)', () => {
        const out = redactSecrets('[Transcode t1] http://p:8080/live/joao/s3nh4/1.ts: Server returned 403 Forbidden')
        expect(out).not.toContain('s3nh4')
        // O diagnóstico que o suporte precisa continua legível.
        expect(out).toContain('Server returned 403 Forbidden')
        expect(out).toContain('/live/***/***/1.ts')
    })

    it('mascara a URL dentro da mensagem do node-fetch', () => {
        const out = redactSecrets('FetchError: request to http://p:8080/movie/joao/s3nh4/9.mkv failed, reason: socket hang up')
        expect(out).not.toContain('s3nh4')
        expect(out).toContain('reason: socket hang up')
    })

    it('NÃO mutila caminhos legítimos de terceiros que só parecem Xtream', () => {
        // TMDB: /movie/<id>/<recurso> não tem o terceiro segmento de stream.
        expect(redactSecrets('https://api.themoviedb.org/3/movie/550/videos?language=pt-BR'))
            .toBe('https://api.themoviedb.org/3/movie/550/videos?language=pt-BR')
        expect(redactSecrets('GET /movie/550/videos 200')).toBe('GET /movie/550/videos 200')
    })
})

describe('redactSecrets — credencial no userinfo da URL', () => {
    it('mascara http://usuario:senha@host', () => {
        const out = redactSecrets('http://joao:s3nh4@prov.tv:8080/player_api.php')
        expect(out).toBe('http://***:***@prov.tv:8080/player_api.php')
    })

    it('não confunde host:porta com userinfo', () => {
        expect(redactSecrets('http://prov.tv:8080/x')).toBe('http://prov.tv:8080/x')
    })
})

describe('redactSecrets — query string', () => {
    it('mascara username= e password= preservando os demais parâmetros', () => {
        const out = redactSecrets('http://host/api?username=joe&password=s3cr3t&x=1')
        expect(out).toContain(`username=${REDACTED}`)
        expect(out).toContain(`password=${REDACTED}`)
        expect(out).not.toContain('s3cr3t')
        expect(out).toContain('x=1')
    })

    it('mascara a chave do TMDB (api_key=) sem apagar o resto da URL', () => {
        const out = redactSecrets('https://api.themoviedb.org/3/search/movie?api_key=9c1f2ab3de&query=matrix')
        expect(out).not.toContain('9c1f2ab3de')
        expect(out).toContain('query=matrix')
        expect(out).toContain('/3/search/movie')
    })

    it('mascara o PIN do controle web', () => {
        expect(redactSecrets('http://192.168.0.7:8974/setup?pin=1234')).not.toContain('1234')
    })

    it('mascara a URL do XMLTV do provedor', () => {
        const out = redactSecrets('[EPG Cache] Downloading from: http://host/xmltv.php?username=U&password=P')
        expect(out).not.toContain('username=U')
        expect(out).not.toContain('password=P')
    })
})

describe('redactSecrets — objetos serializados (util.inspect / JSON)', () => {
    it('mascara chave SEM aspas com valor entre aspas simples (formato do electron-log)', () => {
        // Linha literal que o transporte de arquivo produz para a resposta do
        // player_api.php — o formato que o redator antigo deixava passar inteiro.
        const line = "[XtreamClient] Response data: { user_info: { username: 'joao123', "
            + "password: 's3nh4Secreta', auth: 1, status: 'Active', exp_date: '1790000000' } }"
        const out = redactSecrets(line)
        expect(out).not.toContain('s3nh4Secreta')
        expect(out).not.toContain('joao123')
        // Campos úteis pro diagnóstico sobrevivem.
        expect(out).toContain('auth: 1')
        expect(out).toContain("status: 'Active'")
        expect(out).toContain("exp_date: '1790000000'")
    })

    it('mascara "password":"..." em JSON e deixa os outros campos intactos', () => {
        const out = redactSecrets('{"user":"joe","password":"hunter2"}')
        expect(out).not.toContain('hunter2')
        expect(out).toContain(`"password":"${REDACTED}"`)
        expect(out).toContain('"user":"joe"')
    })

    it('mascara o Api-Key do OpenSubtitles em header serializado', () => {
        const out = redactSecrets("headers: { 'Api-Key': 'osKeyAbc123', 'Content-Type': 'application/json' }")
        expect(out).not.toContain('osKeyAbc123')
        expect(out).toContain("'Content-Type': 'application/json'")
    })

    it('mascara apiKey/api_key em qualquer grafia', () => {
        expect(redactSecrets("{ apiKey: 'abc123' }")).not.toContain('abc123')
        expect(redactSecrets('{"api_key":"abc123"}')).not.toContain('abc123')
    })

    it('mascara Authorization: Bearer/Basic', () => {
        expect(redactSecrets('Authorization: Bearer eyJhbGciOi.JIUzI1.NiJ9')).not.toContain('eyJhbGciOi')
        expect(redactSecrets('Authorization: Basic am9hbzpzM25oNA==')).not.toContain('am9hbzpzM25oNA')
    })

    it('é insensível a maiúsculas na chave', () => {
        expect(redactSecrets('PASSWORD=topsecret')).not.toContain('topsecret')
        expect(redactSecrets('Username=admin')).toContain(`Username=${REDACTED}`)
    })

    it('não avança além do fim do valor', () => {
        expect(redactSecrets('password=abc&keep=this')).toContain('keep=this')
        expect(redactSecrets("{ password: 'abc', canais: 1200 }")).toContain('canais: 1200')
    })
})

describe('redactSecrets — mensagens normais chegam intactas ao suporte', () => {
    const inocentes = [
        '[Catalog] 12345 canais carregados em 1.2s (playlist pl_7)',
        '[DLNA] Proxy GET token=1a2b3c4d range=bytes=0-1023 known=true',
        '[Update] Baixando de https://github.com/Rakjsu/NeoStream/releases/download/v4.45.0/app.exe',
        'Error: connect ECONNREFUSED 192.168.0.1:8080',
        '[Timeshift] ffmpeg saiu (code 1): Invalid data found when processing input',
        '[WebRemote] servidor ouvindo em http://192.168.0.7:8974',
    ]

    it.each(inocentes)('preserva %s', (linha) => {
        expect(redactSecrets(linha)).toBe(linha)
    })

    it('devolve entrada vazia inalterada', () => {
        expect(redactSecrets('')).toBe('')
    })
})

describe('redactLogLine (transform final do transporte de arquivo)', () => {
    it('redige a linha já formatada pelo electron-log', () => {
        const linha = "[XtreamClient] Response data: { password: 's3nh4Secreta' }"
        expect(redactLogLine({ data: linha })).not.toContain('s3nh4Secreta')
    })

    it('tolera data não-string sem quebrar o transporte', () => {
        expect(redactLogLine({ data: undefined })).toBe('undefined')
    })
})
