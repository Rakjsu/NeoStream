/**
 * 🧩 Juntar os pedaços de um download paralelo num arquivo só.
 *
 * O laço vivia dentro do handler de download e tinha um buraco: o stream de
 * LEITURA de cada parte tinha `on('error')`, o de ESCRITA não tinha nenhum. Um
 * `'error'` em stream sem listener é exceção ASSÍNCRONA — não cai no `catch` do
 * handler, sobe como uncaughtException e abre o diálogo de crash do Electron.
 * É a mesma armadilha do EPIPE que este projeto já levou uma vez.
 *
 * E o gatilho é banal: a junção precisa de cerca de 1,25× o tamanho do filme
 * livre em disco (as partes ainda ocupam o total e o arquivo final começa a ser
 * escrito ao lado antes da primeira sair), então um filme de 5 GB derrubava o
 * app num disco com 5,5 GB livres — em vez de mostrar a mensagem acionável que
 * o handler já tem pronta para "arquivo incompleto".
 *
 * Extraído para poder ser testado com arquivos de verdade: é justamente o
 * caminho de erro que ninguém exercita à mão.
 */
import fs from 'node:fs'

/**
 * Concatena `partes` (na ordem) em `destino` e apaga cada parte consumida.
 *
 * Parte que não existe é pulada — o download paralelo pode ter usado menos
 * conexões do que o teto.
 *
 * @throws o erro de I/O (disco cheio, permissão, caminho inválido) como
 * REJEIÇÃO, para o chamador poder transformá-lo em mensagem.
 */
export async function juntarPartes(destino: string, partes: string[]): Promise<void> {
    const escrita = fs.createWriteStream(destino)

    // A corrida com esta promessa é o que transforma o 'error' assíncrono do
    // stream de escrita numa rejeição que o `await` enxerga.
    const falhaDaEscrita = new Promise<never>((_, reject) => {
        escrita.on('error', reject)
    })
    // Se o erro chegar depois de todas as corridas terem terminado, esta
    // promessa ficaria sem dono e viraria unhandledRejection — o problema que
    // este módulo existe para evitar.
    falhaDaEscrita.catch(() => { /* tratada pela corrida abaixo */ })

    try {
        for (const parte of partes) {
            if (!fs.existsSync(parte)) continue
            await Promise.race([falhaDaEscrita, new Promise<void>((resolve, reject) => {
                const leitura = fs.createReadStream(parte)
                leitura.on('error', reject)
                leitura.on('end', () => {
                    // Antivírus segurando o arquivo no Windows não pode
                    // derrubar uma junção que já deu certo.
                    try { fs.unlinkSync(parte) } catch { /* best-effort */ }
                    resolve()
                })
                leitura.pipe(escrita, { end: false })
            })])
        }
        await Promise.race([falhaDaEscrita, new Promise<void>(resolve => escrita.end(resolve))])
    } catch (erro) {
        escrita.destroy()
        throw erro
    }
}
