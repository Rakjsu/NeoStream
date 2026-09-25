/**
 * 🔁🔎 Varredura de EPG em segundo plano para as regras de gravação automática
 * e os alertas por palavra-chave.
 *
 * Antes as duas coisas só olhavam o `epgByChannel` do Guia, que só é
 * preenchido para as linhas RENDERIZADAS da categoria aberta: a regra só
 * agendava se a pessoa abrisse o Guia, escolhesse a categoria do canal e
 * rolasse até a linha dele — e o alerta por palavra-chave, idem. Com o app na
 * bandeja por dias, nenhuma das duas disparava nunca.
 *
 * Aqui a varredura é desacoplada da rolagem: roda no boot (com atraso, para
 * não disputar banda com o carregamento) e depois a cada ciclo, e também logo
 * depois de a pessoa cadastrar uma regra ou palavra-chave. Só roda quando há
 * regra ou palavra-chave cadastrada.
 *
 * Banda: cair na cadeia de fontes públicas canal a canal, sobre centenas de
 * canais, é caro. Por isso há TETO de canais por passada, prioridade (canais
 * que uma regra restrita nomeia; favoritos; canais com EPG do provedor, que o
 * main responde de um índice em memória), no máximo 2 buscas da varredura de
 * uma vez (o limitador compartilhado tem 4 — sobram 2 para a tela do Guia) e
 * reuso do cache compartilhado com o Guia.
 */
import { recordingRuleService, ruleMatches, type RecordingRule } from './recordingRuleService';
import { listKeywords, scanEpgForKeywords } from './epgKeywordAlertService';
import { scheduledRecordingService, scheduleId } from './scheduledRecordingService';
import { parentalService } from './parentalService';
import { profileService } from './profileService';
import { favoritesService } from './favoritesService';
import { loadChannelEpg, type GuiaEpgCanal, type GuiaEpgProgram } from './guiaEpgCache';

/** Mesmos padrões que a TV ao vivo e o Guia usam (lista branca infantil / bloqueio adulto). */
export const KIDS_ALLOWED_PATTERNS = ['infantil', 'infantis', 'kids', 'criança', '24 horas infantis'];
export const BLOCKED_CATEGORY_PATTERNS = ['adult', 'adulto', '+18', '18+', 'xxx', 'erotic', 'erótico'];

/** Canais por passada. Acima disso a cobertura é parcial, por prioridade. */
export const TETO_CANAIS_VARREDURA = 150;
/** Buscas simultâneas da varredura (de um limitador compartilhado de 4). */
export const CONCORRENCIA_VARREDURA = 2;
/** Espera depois do boot antes da primeira passada. */
export const ATRASO_BOOT_MS = 60_000;
/** Cadência das passadas e idade máxima do cache que a varredura aceita. */
export const CICLO_VARREDURA_MS = 6 * 60 * 60 * 1000;

export interface CanalAoVivo extends GuiaEpgCanal {
    category_id: string;
}

export interface CategoriaAoVivo {
    category_id: string;
    category_name: string;
}

/**
 * Categorias e canais que o perfil pode ver — a mesma regra do Guia. Sem isso a
 * varredura agendaria gravação (e mostraria no sino o título do programa) de
 * canal adulto num perfil infantil.
 */
export function filtrarCanaisPermitidos<S extends { category_id: string }, C extends CategoriaAoVivo>(
    streams: S[],
    categorias: C[],
    opts: { bloquearAdulto: boolean; perfilInfantil: boolean }
): { categorias: C[]; streams: S[] } {
    const permitidas = categorias.filter(cat => {
        const nome = cat.category_name.toLowerCase();
        if (opts.bloquearAdulto && BLOCKED_CATEGORY_PATTERNS.some(p => nome.includes(p))) return false;
        if (opts.perfilInfantil && !KIDS_ALLOWED_PATTERNS.some(p => nome.includes(p))) return false;
        return true;
    });
    const ids = new Set(permitidas.map(c => c.category_id));
    return { categorias: permitidas, streams: streams.filter(s => ids.has(s.category_id)) };
}

/**
 * Agenda os programas FUTUROS que casam com alguma regra (dedupe pelo
 * scheduleId). Devolve quantos agendou. É o mesmo passo que o Guia faz sobre
 * a grade carregada.
 */
export function aplicarRegrasDeGravacao(
    canais: Array<{ name: string; stream_id: number }>,
    programasDe: (channelName: string) => GuiaEpgProgram[] | undefined,
    nowMs = Date.now(),
    regras: RecordingRule[] = recordingRuleService.list()
): number {
    if (regras.length === 0) return 0;
    const agendados = new Set(scheduledRecordingService.list().map(s => s.id));
    let novos = 0;
    for (const canal of canais) {
        const programas = programasDe(canal.name);
        if (!programas) continue;
        for (const programa of programas) {
            if (Date.parse(programa.start) <= nowMs) continue;
            const id = scheduleId(canal.name, programa.start);
            if (agendados.has(id)) continue;
            if (!ruleMatches(regras, programa.title, canal.name)) continue;
            scheduledRecordingService.add({
                channelName: canal.name,
                streamId: canal.stream_id,
                title: programa.title,
                startIso: programa.start,
                endIso: programa.end
            });
            agendados.add(id);
            novos += 1;
        }
    }
    return novos;
}

/**
 * Quais canais a passada busca, em ordem de prioridade e cortados no teto:
 *  1. canais que uma regra RESTRITA a canal nomeia (a regra não vale nada sem eles);
 *  2. favoritos;
 *  3. canais com id de EPG do provedor (o main responde de um índice em memória);
 *  4. o resto.
 * Sem regra sem restrição e sem palavra-chave, só o grupo 1 entra.
 */
export function escolherCanaisParaVarredura<S extends GuiaEpgCanal>(
    streams: S[],
    regras: RecordingRule[],
    keywords: string[],
    favoritos: Set<string>,
    teto = TETO_CANAIS_VARREDURA
): S[] {
    if (regras.length === 0 && keywords.length === 0) return [];
    const restricoes = regras
        .map(r => r.channelName?.trim().toLowerCase())
        .filter((c): c is string => !!c);
    const precisaDeTodos = keywords.length > 0 || regras.some(r => !r.channelName?.trim());
    const nomeado = (s: S) => {
        const nome = s.name.toLowerCase();
        return restricoes.some(r => nome.includes(r));
    };
    const faixa = (s: S): number => {
        if (nomeado(s)) return 0;
        if (favoritos.has(String(s.stream_id))) return 1;
        if (s.epg_channel_id) return 2;
        return 3;
    };
    const candidatos = precisaDeTodos ? streams : streams.filter(nomeado);
    const vistos = new Set<string>();
    const unicos = candidatos.filter(s => {
        if (vistos.has(s.name)) return false;
        vistos.add(s.name);
        return true;
    });
    // sort estável: dentro da faixa, a ordem do provedor.
    return unicos
        .map((s, i) => ({ s, i, f: faixa(s) }))
        .sort((a, b) => a.f - b.f || a.i - b.i)
        .slice(0, Math.max(0, teto))
        .map(x => x.s);
}

function janelaSecundaria(): boolean {
    try {
        const hash = window.location.hash;
        return hash.startsWith('#/pip') || hash.startsWith('#/multiview');
    } catch {
        return false;
    }
}

interface RespostaIpc<T> {
    success?: boolean;
    data?: T;
}

export interface ResultadoVarredura {
    canais: number;
    agendados: number;
    alertas: number;
}

const VAZIO: ResultadoVarredura = { canais: 0, agendados: 0, alertas: 0 };

/**
 * Uma passada completa: lista os canais permitidos, busca o EPG dos
 * escolhidos (cache compartilhado com o Guia) e aplica regras e alertas.
 */
export async function varrerEpgEmSegundoPlano(
    opts: { nowMs?: number; teto?: number; maxAgeMs?: number } = {}
): Promise<ResultadoVarredura> {
    if (janelaSecundaria()) return VAZIO;
    const regras = recordingRuleService.list();
    const keywords = listKeywords();
    if (regras.length === 0 && keywords.length === 0) return VAZIO;

    const ipc = window.ipcRenderer;
    if (!ipc?.invoke) return VAZIO;

    let streamsRes: RespostaIpc<CanalAoVivo[]> | undefined;
    let categoriasRes: RespostaIpc<CategoriaAoVivo[]> | undefined;
    try {
        [streamsRes, categoriasRes] = await Promise.all([
            ipc.invoke('streams:get-live') as Promise<RespostaIpc<CanalAoVivo[]>>,
            ipc.invoke('categories:get-live') as Promise<RespostaIpc<CategoriaAoVivo[]>>
        ]);
    } catch {
        return VAZIO;
    }
    if (!streamsRes?.success || !Array.isArray(streamsRes.data)) return VAZIO;

    const parental = parentalService.getConfig();
    const { streams } = filtrarCanaisPermitidos(
        streamsRes.data,
        categoriasRes?.success && Array.isArray(categoriasRes.data) ? categoriasRes.data : [],
        {
            bloquearAdulto: parental.enabled && parental.blockAdultCategories && !parentalService.isSessionUnlocked(),
            perfilInfantil: profileService.getActiveProfile()?.isKids === true
        }
    );
    const favoritos = new Set(
        favoritesService.getAll().filter(f => f.type === 'channel').map(f => String(f.id))
    );
    const escolhidos = escolherCanaisParaVarredura(streams, regras, keywords, favoritos, opts.teto);
    if (escolhidos.length === 0) return VAZIO;

    const maxAgeMs = opts.maxAgeMs ?? CICLO_VARREDURA_MS;
    const resultado = new Map<string, GuiaEpgProgram[]>();
    let proximo = 0;
    const trabalhador = async () => {
        while (proximo < escolhidos.length) {
            const canal = escolhidos[proximo++];
            resultado.set(canal.name, await loadChannelEpg(canal, { maxAgeMs }));
        }
    };
    await Promise.all(
        Array.from({ length: Math.min(CONCORRENCIA_VARREDURA, escolhidos.length) }, trabalhador)
    );

    const nowMs = opts.nowMs ?? Date.now();
    const agendados = aplicarRegrasDeGravacao(escolhidos, name => resultado.get(name), nowMs, regras);
    const alertas = scanEpgForKeywords(resultado.entries(), nowMs);
    return { canais: escolhidos.length, agendados, alertas };
}

// ---------------------------------------------------------------------------
// Agendamento: boot atrasado + ciclo + disparo manual (coalescido).
// ---------------------------------------------------------------------------
let emCurso: Promise<ResultadoVarredura> | null = null;
let repetir = false;
let bootTimer: ReturnType<typeof setTimeout> | null = null;
let cicloTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Pede uma passada agora. Se já há uma rodando, marca para rodar de novo ao
 * fim (a regra nova pode ter chegado depois da lista que ela leu).
 */
export function dispararVarreduraEpg(): Promise<ResultadoVarredura> {
    if (emCurso) {
        repetir = true;
        return emCurso;
    }
    emCurso = (async () => {
        let ultimo: ResultadoVarredura;
        do {
            repetir = false;
            ultimo = await varrerEpgEmSegundoPlano().catch(() => VAZIO);
        } while (repetir);
        return ultimo;
    })().finally(() => {
        emCurso = null;
    });
    return emCurso;
}

/** Liga o relógio da varredura (idempotente; chamar uma vez no boot). */
export function iniciarVarreduraEpg(): void {
    if (bootTimer || cicloTimer || janelaSecundaria()) return;
    bootTimer = setTimeout(() => {
        bootTimer = null;
        void dispararVarreduraEpg();
        cicloTimer = setInterval(() => { void dispararVarreduraEpg(); }, CICLO_VARREDURA_MS);
    }, ATRASO_BOOT_MS);
}

/** Desliga o relógio (testes / desmontagem). */
export function pararVarreduraEpg(): void {
    if (bootTimer) clearTimeout(bootTimer);
    if (cicloTimer) clearInterval(cicloTimer);
    bootTimer = null;
    cicloTimer = null;
}
