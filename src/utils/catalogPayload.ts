// 🛡️ Blindagem do payload de catálogo vindo do main.
//
// Provedor com conta expirada / senha trocada / domínio estacionado responde
// HTTP 200 com um OBJETO (ex.: `{"user_info":{"auth":0}}`) ou HTML, e o cliente
// só rejeita status ≠ 200. Esse valor caía direto no state e o `.filter()`/
// `.map()` seguinte estourava DENTRO do render — o ErrorBoundary trocava a tela
// inteira (Home, Filmes, Séries, TV) por "Algo deu errado nesta tela".
//
// O guarda principal está no main (catalogCache: resposta não-lista vira erro e
// o SWR serve o cache bom anterior). Isto aqui é a segunda linha: mesmo que algo
// escape, a tela mostra catálogo vazio em vez de cair.

/** Devolve a lista recebida, ou `[]` para qualquer coisa que não seja lista. */
export function asList<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}
