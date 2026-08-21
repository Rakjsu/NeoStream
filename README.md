<div align="center">

<img src="public/neostream-logo.png" alt="NeoStream" width="120">

# NeoStream

**Você traz o seu serviço de streaming. Ele toca.**

Player IPTV para desktop — TV ao vivo com guia e gravação, filmes e séries com cara de streaming, e o celular como controle remoto.

[![Versão](https://img.shields.io/github/v/release/Rakjsu/NeoStream?style=flat-square&color=8b5cf6&label=vers%C3%A3o)](https://github.com/Rakjsu/NeoStream/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/Rakjsu/NeoStream/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/Rakjsu/NeoStream/actions/workflows/ci.yml)
[![Testes](https://img.shields.io/badge/testes-1429%20unit%20%C2%B7%2070%20e2e-22c55e?style=flat-square)](#-sob-o-capô)
[![Licença](https://img.shields.io/github/license/Rakjsu/NeoStream?style=flat-square&color=64748b)](LICENSE)
[![Plataformas](https://img.shields.io/badge/Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-1e293b?style=flat-square)](#-baixar)

[Baixar](#-baixar) · [O que faz](#-o-que-ele-faz) · [Ecossistema](#-o-celular-vira-controle) · [Sob o capô](#-sob-o-capô) · [Desenvolvimento](#-desenvolvimento)

</div>

---

O NeoStream é **um player**, no mesmo sentido que o VLC é um player. Ele não vem com nada dentro: na primeira abertura a tela está vazia — nenhuma lista, nenhum provedor, nenhum canal. Você informa o endereço de um serviço que **já** contratou, e ele reproduz. Não há servidor deste projeto no meio, não há catálogo, não há busca por fontes.

Fala os protocolos abertos de sempre: **Xtream Codes**, **playlist M3U/M3U8**, **portal Stalker/Ministra**, **EPG XMLTV** e **HLS**.

## 📥 Baixar

| Sistema | Arquivo | Observação |
|---|---|---|
| **Windows** | `Installer.exe` ou `Portable.exe` | O portátil roda sem instalar |
| **macOS** | `.dmg` ou `-mac.zip` | Apple Silicon (arm64); sem assinatura da Apple |
| **Linux** | `.AppImage` | `chmod +x` e executar |

**[→ Última versão](https://github.com/Rakjsu/NeoStream/releases/latest)**

Depois de instalado, o app **se atualiza sozinho** — com que frequência, e se instala automático, você decide em Configurações → Atualizações.

## ✨ O que ele faz

### 📡 TV ao vivo
Guia de programação em grade (do seu provedor, do **seu próprio XMLTV** ou de fontes públicas), com busca de programas, filtro por gênero e mini-guia ao pairar no canal. As variantes do mesmo canal (FHD/HD/SD) se agrupam num card só. Zapping dentro do player com busca, PgUp/PgDn e número digitado, com OSD de TV — mais histórico dos últimos canais, zap aleatório e a possibilidade de esconder o que você nunca assiste.

**Pausar o ao vivo** com buffer local de ~30 minutos, **catch-up/replay** onde o provedor oferece, **assistir do início** um programa em andamento, e **multi-view 2×2** com o áudio seguindo o clique.

### ⏺ Gravação (DVR)
Grave o canal ao vivo com um botão, ou **agende pelo guia** clicando num programa futuro. Dá para criar **regras**: "grave tudo cujo título casar com esta expressão". As gravações têm renomear, proteger contra a faxina automática, exportar e converter para MP4 sem perda.

Fechar a janela mantém o app na bandeja — **agendamento e lembrete disparam com o app "fechado"**.

### 🎬 Filmes e séries
Grades virtualizadas, busca global esperta (Ctrl+K, sem acento, tolerante a erro de digitação, e também **por pessoa**, cruzando filmografia com o seu catálogo). Ficha com **trailer tocando no topo**, episódios ao lado e progresso por episódio. Autoplay do próximo com contagem cancelável.

Downloads offline com fila por temporada, **só de madrugada** se você preferir, e download inteligente que já enfileira o próximo episódio. Legendas do OpenSubtitles com estilo, sincronização e suporte a legenda forçada.

### 📱 O celular vira controle
Este é o pedaço que separa o NeoStream de um player comum. Um **servidor próprio na sua rede local** (HTTP + WebSocket escritos do zero) transforma qualquer celular em controle, sem instalar nada: abre o navegador, aponta a câmera para o **QR** e digita o **PIN de 4 dígitos**.

Do celular você **controla o player** (play, pause, seek, volume, faixa de áudio, sleep, zap por número, trackpad que vira setas), **navega o guia e o catálogo**, **manda gravar**, **transmite para o Chromecast** e vê **o que está tocando**. Também dá para **baixar no celular** uma gravação do PC, **mandar para o PC** um download feito no celular, e **passar o vídeo de um aparelho para o outro** de onde parou, por QR.

Com o app companheiro, ainda há **espelho do "continuar assistindo"** entre PC e celular, e **modo festa** 🎉 — qualquer celular pareado joga um filme na fila da TV.

> O pareamento é opt-in, protegido por PIN com bloqueio por tentativas, e **nada disso sai da sua rede local**. Há HTTPS opcional com certificado próprio.

### 👥 Perfis, família e privacidade
Até 5 perfis com avatar, cor que **re-tematiza o app** e PIN opcional, mais uma **sessão de convidado** que não deixa histórico. Controle parental por categoria, perfil infantil com **limite diário de tela**, **janela de horário permitido**, troca automática para o Kids no horário e relatório semanal de uso.

### 🖥️ Integrações e conforto
**Chromecast**, **DLNA** (com remux automático para as Samsungs) e **AirPlay** — todos implementados do zero. **Gamepad** navega o app inteiro. **MPV opcional** em um clique. Picture-in-picture, **modo cinema** com luz ambiente amostrada do próprio vídeo, **modo rádio** (só áudio), marcadores de posição, loop A–B, screenshot do frame, filtros de vídeo e **atalhos remapeáveis**.

E **estatísticas de verdade**: mapa do ano, heatmap de hábitos, tempo por canal e por perfil, recordes, meta diária — mais a **retrospectiva anual** com a sua persona de espectador.

### 💾 Backup e várias máquinas
Backup completo (perfis, progresso, favoritos, estatísticas, playlists e as suas chaves de API), com **senha opcional e cifra AES**. Automático semanal, se quiser. E **sincronização entre máquinas** por uma pasta do Dropbox/Drive/OneDrive: cada máquina escreve o seu arquivo, o app faz o merge — inclusive respeitando o que você apagou de propósito.

## 🔧 Sob o capô

Coisas que não aparecem na tela, mas explicam o resto:

- **16 dependências de produção.** WebSocket, DLNA, Chromecast, AirPlay, encoder de QR (com Reed-Solomon), parser do feed de update e public suffix list — tudo escrito à mão, de propósito. Menos superfície, menos surpresa.
- **1429 testes unitários** em 154 arquivos e **70 testes E2E** em 31, com Playwright dirigindo o Electron de verdade contra um servidor Xtream simulado.
- **CI em camadas** no Windows, Linux e macOS: auditoria de dependências, typecheck, lint, unitários, build, *bundle guard* (um empacotamento errado do ffmpeg mata o DVR em silêncio — o CI barra), E2E e regressão visual. Mais uma rodada semanal para pegar CVE em dependência que não mudou.
- **Segurança tratada como recurso**: credenciais são apagadas do log antes de tocar o disco, os servidores locais só aceitam a origem do próprio app, o proxy DLNA valida token e confina destino, e o feed de auto-update é re-hasheado no CI antes de virar release.
- **Catálogo em SQLite** (o embutido no Node, sem dependência nativa), com migração transacional e rollback automático para o formato anterior se algo der errado.

## 🛠️ Desenvolvimento

```bash
npm install        # dependências
npm run dev        # Vite + Electron
npm run test:run   # 1429 testes unitários (vitest)
npm run test:e2e   # 70 testes E2E (Playwright + Electron + mock Xtream)
npm run lint
npm run build:win  # também: build:mac, build:linux
```

**Stack:** Electron 43 · React 19 · TypeScript 6 · Vite 8 · Tailwind 4 · Node 22 no CI

Interface em **português, inglês e espanhol** (1151 strings por idioma), incluindo a página do controle no celular.

> **Nota:** o TypeScript está travado no 6 de propósito. O `typescript-eslint` estável ainda não aceita o 7 — subir quebra o `npm ci` do CI, e isso já derrubou a `main` duas vezes. A trava e a condição para removê-la estão em [`.github/dependabot.yml`](.github/dependabot.yml).

## 🔑 Chaves de API

**Os builds não embutem chave nenhuma.** Cada pessoa cadastra as suas em **Configurações → APIs**:

- **TMDB** (gratuita) — capas, sinopses, notas, elenco, trailers e a classificação usada pelo controle parental
- **OpenSubtitles** (opcional) — busca de legendas
- **Trakt** (opcional) — sincroniza o que você assistiu, com aplicativo criado por você

O app guia essa configuração ao adicionar a primeira playlist. Para desenvolvimento local, um `.env` (nunca commitado) serve de fallback.

## ⚖️ Aviso legal

O NeoStream **não hospeda, não indexa, não distribui e não sugere** conteúdo, provedores, listas ou fontes. Não existe servidor deste projeto, catálogo embutido ou mecanismo de busca por fontes — sem um endereço que **você** forneça, o app não tem o que exibir e não contata servidor de conteúdo nenhum.

**Use apenas com serviços e conteúdos que você tem o direito de acessar** — a assinatura que você contratou, o seu próprio servidor de mídia, transmissões abertas ou material licenciado. A responsabilidade pelo que se acessa é de quem configura.

É titular de direitos e acredita que algo aqui viola os seus? Abra uma [issue](https://github.com/Rakjsu/NeoStream/issues) apontando o ponto exato — o material sob controle do projeto é removido ou corrigido, e você é informado do que foi feito. Falha de segurança tem [canal privado](https://github.com/Rakjsu/NeoStream/security/advisories/new).

## 🙏 Créditos

[TMDB](https://www.themoviedb.org/) pelos metadados · [hls.js](https://github.com/video-dev/hls.js) e [mpv](https://mpv.io/) pela reprodução · [OpenSubtitles](https://www.opensubtitles.com/) pelas legendas · [ffmpeg](https://ffmpeg.org/) pela gravação

Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB.

---

<div align="center">

**[Rakjsu](https://github.com/Rakjsu)** · [MIT](LICENSE) · Irmãos do projeto: [NeoStream TV](https://github.com/Rakjsu/NeoStream-TV) (Samsung Tizen)

</div>
