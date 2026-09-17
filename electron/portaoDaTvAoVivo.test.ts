import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🚪 O portão da TV ao vivo falha FECHADO.
 *
 * `categories:get-live` é quem monta `blockedCategoryIds` (a blacklist do
 * parental) e `allowedCategoryIds` (a whitelist do perfil infantil). Quando a
 * chamada volta `success: false`, os dois conjuntos ficam **vazios** — e
 * conjunto vazio não filtra nada, por desenho (`contentGate.ts`, com teste
 * próprio). Resultado: a grade inteira passava, categoria adulta inclusa, sem
 * um aviso na tela — e a MESMA lista ia para o guia do celular, que resolve o
 * `playChannel` só contra ela.
 *
 * O `if (result.success)` não tinha `else`, e o `catch` só tinha
 * `console.error` — que nem chega a rodar: o handler do main captura o erro e
 * devolve `{ success: false }`, então o caminho real era o silêncio.
 *
 * Guarda estrutural (lê o fonte) porque o repositório não tem
 * `@testing-library/react` e o `LiveTV.tsx` importa `hls.js` e depende do
 * `window.ipcRenderer`: montar a página em jsdom seria um teste maior que o
 * conserto. A REGRA pura (`shouldBlockAdultCategories`) já está coberta em
 * `src/services/contentGate.test.ts`; o que falta guarda é a FIAÇÃO.
 *
 * Mora em `electron/` pelo motivo documentado no `i18nKeys.test.ts`: o
 * `tsconfig.app.json` compila `src/` sem os tipos de `node:fs`.
 */
const LIVETV = path.join(__dirname, '..', 'src', 'pages', 'LiveTV.tsx')

const fonte = () => fs.readFileSync(LIVETV, 'utf-8').split('\r\n').join('\n')

describe('portão da TV ao vivo: sem categorias, a página não abre a grade', () => {
    it('o insucesso do categories:get-live não passa em silêncio', () => {
        const src = fonte()
        const inicio = src.indexOf('const fetchCategories')
        expect(inicio).toBeGreaterThan(-1)
        const fim = src.indexOf('}, [isKidsProfile]);', inicio)
        expect(fim).toBeGreaterThan(inicio)
        const corpo = src.slice(inicio, fim)

        // Existe ramo de insucesso…
        expect(corpo).toContain('setError')
        // …e ele é condicionado ao gate: adulto sem parental não perde a TV
        // por uma falha que, para ele, é cosmética.
        expect(corpo).toContain('shouldBlockAdultCategories')
    })

    it('o "Tentar novamente" refaz a busca que quebrou', () => {
        const src = fonte()
        const inicio = src.indexOf('{/* Retry Button')
        expect(inicio).toBeGreaterThan(-1)
        expect(src.slice(inicio, inicio + 600)).toContain('fetchCategories')
    })

    it('em erro a página não publica lista nenhuma (nem pro guia do celular)', () => {
        const src = fonte()
        const inicio = src.indexOf('const filteredStreams = useMemo')
        expect(inicio).toBeGreaterThan(-1)
        const fim = src.indexOf('// Keep the zap ref current', inicio)
        expect(fim).toBeGreaterThan(inicio)
        const trecho = src.slice(inicio, fim)

        // Regex, e não `toContain('error')`: depois da correção a palavra
        // aparece no corpo de qualquer jeito, e um `toContain` passaria sem
        // guardar nada.
        expect(trecho).toMatch(/error\s*\?\s*\[\]|if\s*\(error\)\s*return\s*\[\]/)

        // E `error` está nas deps, senão o memo congela a lista antiga.
        // `lastIndexOf('[')` e não `lastIndexOf('}), [')`: com o curto-circuito
        // a linha vira `})), [error, …]` e a segunda forma deixa de existir —
        // a busca devolveria -1 e a asserção testaria o último caractere.
        expect(trecho.slice(trecho.lastIndexOf('['))).toContain('error')
    })
})
