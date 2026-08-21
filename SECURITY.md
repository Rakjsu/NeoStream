# Política de segurança

## Versões com suporte

Só a última versão publicada em [Releases](https://github.com/Rakjsu/NeoStream/releases) recebe correção. O app se atualiza sozinho, então "estar na última" é o estado normal.

## Como relatar uma falha

**Não abra uma issue pública para falha de segurança.** Use o canal privado:

**[→ Reportar vulnerabilidade](https://github.com/Rakjsu/NeoStream/security/advisories/new)**
(aba *Security* → *Report a vulnerability*)

O relato fica visível só para você e para o mantenedor até haver correção.

Ajuda muito incluir: o que acontece, como reproduzir, versão do NeoStream e sistema operacional, e — se souber — o impacto concreto (o que um atacante consegue).

Este é um projeto de uma pessoa só, sem equipe de segurança. A resposta vem em prazo razoável e em linguagem simples, não em SLA corporativo.

## O que está no escopo

O que vale relatar, em ordem de gravidade:

- **Credenciais de provedor vazando** para qualquer lugar além do servidor que o usuário configurou.
- **Execução de código** a partir de conteúdo do provedor — playlist, EPG, nome de canal ou legenda maliciosos que virem código no app.
- **Falha no pareamento pela rede local**: acesso ao controle remoto ou ao pareamento com o celular sem o PIN, ou qualquer forma de furar esse gate.
- **Escape do sandbox do renderer** ou abuso das pontes de IPC entre o processo principal e a interface.
- **Controle parental / bloqueio por PIN** contornável de forma não óbvia.

## O que **não** é falha de segurança

- **O app aceita conexões em texto claro (`http://`).** É deliberado: muitos provedores de IPTV só oferecem HTTP, e recusar quebraria o app para quem já usa. A limitação está documentada no próprio app.
- **Credenciais gravadas sem criptografia própria** no armazenamento do usuário. O sistema operacional protege essa área contra outros aplicativos; o NeoStream não adiciona cifra por cima. Em máquina com acesso físico ou administrativo, esses dados são legíveis — é uma limitação conhecida, não um bug. (Uma proposta concreta de melhoria aqui é bem-vinda como *issue* normal.)
- **Conteúdo que o provedor do usuário entrega.** O NeoStream não hospeda, não indexa e não distribui conteúdo — veja o [aviso legal no README](README.md#-aviso-legal).

## Chaves de API

Os builds **não embutem chave nenhuma**. Cada pessoa cadastra as próprias (TMDB, OpenSubtitles) dentro do app. Se você encontrar qualquer chave dentro de um artefato publicado, isso **é** falha — relate pelo canal privado acima.
