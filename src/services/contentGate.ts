/**
 * Regras PURAS de visibilidade de conteúdo (controle parental + perfil
 * infantil).
 *
 * Moram num módulo próprio, e não dentro do hook da grade, porque a grade do
 * desktop NÃO é o único consumidor: o controle web (WebRemoteBridge) manda
 * catálogo pro celular e precisa aplicar exatamente o mesmo gate. Enquanto a
 * regra vivia só no hook, o celular — autenticado com um PIN de 4 dígitos que
 * a criança da casa também tem — recebia o catálogo cru que a tela escondia.
 * Regra nova entra AQUI; quem filtra chama daqui.
 */

export const BLOCKED_CATEGORY_PATTERNS = ['adult', 'adulto', '+18', '18+', 'xxx', 'terror', 'horror', 'erotic', 'erótico'];

/** Pure rule: does this category name match the blocked keyword list? */
export function isCategoryNameBlocked(categoryName: string): boolean {
    const lowerName = categoryName.toLowerCase();
    return BLOCKED_CATEGORY_PATTERNS.some(p => lowerName.includes(p));
}

/** Na TV ao vivo o perfil infantil é WHITELIST: só estas categorias passam. */
export const KIDS_ALLOWED_CATEGORY_PATTERNS = ['infantil', 'infantis', 'kids', 'criança', '24 horas infantis'];

export function isCategoryNameKidsAllowed(categoryName: string): boolean {
    const lowerName = categoryName.toLowerCase();
    return KIDS_ALLOWED_CATEGORY_PATTERNS.some(p => lowerName.includes(p));
}

/** Retrato do gate: perfil ativo + config parental + destranca da sessão. */
export interface ContentGateState {
    isKidsProfile: boolean;
    parentalEnabled: boolean;
    blockAdultCategories: boolean;
    sessionUnlocked: boolean;
}

/** Parental valendo agora: ligado e sessão ainda não destravada com o PIN. */
export function isParentalActive(state: ContentGateState): boolean {
    return state.parentalEnabled && !state.sessionUnlocked;
}

/** Vale montar o conjunto de categorias bloqueadas? */
export function shouldBlockAdultCategories(state: ContentGateState): boolean {
    return state.isKidsProfile || (isParentalActive(state) && state.blockAdultCategories);
}

/** Nada a filtrar: sem perfil infantil e sem parental valendo. */
export function isContentGateOff(state: ContentGateState): boolean {
    return !state.isKidsProfile && !isParentalActive(state);
}

/**
 * `category_id` do Xtream chega número (filme), string ou lista (série).
 * Normalizar num lugar só evita o furo silencioso de comparar 66 com '66' —
 * o item passaria pelo gate por diferença de tipo, não por decisão.
 */
export function toCategoryIds(value: unknown): string[] {
    const list = Array.isArray(value) ? value : [value];
    return list.map(id => (id === null || id === undefined ? '' : String(id)));
}

/** Chave de comparação de título usada pelos caches de classificação. */
export function normalizeContentName(name: string): string {
    return name.toLowerCase().trim().replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ');
}

export interface ItemVisibilityInput {
    /** Categorias a que o item pertence (série pode ter mais de uma). */
    categoryIds: string[];
    name: string;
    blockedCategoryIds: ReadonlySet<string>;
    /** Nomes normalizados escondidos do perfil infantil. */
    hiddenNames: ReadonlySet<string>;
    /** Classificação do TMDB em cache, por nome normalizado. */
    cachedRatings: ReadonlyMap<string, string | null>;
    /** `parentalService.isContentBlocked` — injetado pra manter isto puro. */
    isRatingBlocked: (rating: string) => boolean;
    state: ContentGateState;
}

/** Filme/série visível sob o gate (categoria, classificação e ocultos). */
export function isItemVisibleUnderGate(input: ItemVisibilityInput): boolean {
    if (input.categoryIds.some(id => input.blockedCategoryIds.has(id))) return false;

    const normalized = normalizeContentName(input.name);

    if (isParentalActive(input.state)) {
        const rating = input.cachedRatings.get(normalized);
        if (rating && input.isRatingBlocked(rating)) return false;
    }

    if (input.state.isKidsProfile && input.hiddenNames.has(normalized)) return false;

    return true;
}

/**
 * Canal ao vivo: parental é blacklist de categoria, infantil é whitelist.
 * Whitelist VAZIA não filtra nada — mesmo fallback da TV ao vivo, pra conta
 * cujas categorias não usam nenhuma das palavras infantis não ficar sem canal.
 */
export function isLiveCategoryVisible(categoryId: string, gate: {
    blockedCategoryIds: ReadonlySet<string>;
    /** null = sem whitelist (perfil adulto). */
    allowedCategoryIds: ReadonlySet<string> | null;
}): boolean {
    if (gate.blockedCategoryIds.has(categoryId)) return false;
    const allowed = gate.allowedCategoryIds;
    if (allowed && allowed.size > 0 && !allowed.has(categoryId)) return false;
    return true;
}
