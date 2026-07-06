# NeoStream 📺

Player IPTV completo para desktop, construído com **Electron**, **React** e **TypeScript**. TV ao vivo com guia e gravação, filmes e séries com visual inspirado em streaming, metadados do TMDB e integração profunda com o Windows.

---

## ✨ O que ele faz

### 📡 TV ao Vivo
- Canais agrupados por qualidade (4K/FHD/HD/SD) com fallback automático quando um stream cai
- **Guia EPG** em grade (fonte primária: o próprio provedor via `xmltv.php`; fallback pra mi.tv/meuguia/Open-EPG), com busca de programas e paginação
- **Catch-up/replay** (timeshift) em canais com arquivo do provedor
- **Zapping dentro do player**: lista de canais com busca, PgUp/PgDn troca canal, digitar o número pula direto (com OSD estilo TV)
- **Multi-view 2×2**: até 4 canais ao mesmo tempo, clique move o áudio
- **Lembretes de programa** com notificação nativa do Windows

### ⏺ DVR (gravação)
- Botão de gravar no player ao vivo (ffmpeg embutido, MPEG-TS à prova de queda)
- **Gravação agendada pelo guia**: clica num programa futuro → grava sozinho do início ao fim
- Seção **Gravações** em Downloads: assistir no app, excluir, abrir pasta
- **Modo bandeja**: fechar a janela mantém o app vivo — agendamentos e lembretes disparam mesmo "fechado"; opção de iniciar com o Windows

### 🎬 Filmes e Séries
- Grades virtualizadas com capas, busca global esperta (Ctrl+K, fuzzy e sem acento)
- Modal de detalhes com **trailer tocando no topo** (YouTube via TMDB), episódios ao lado, navegação por teclado e progresso por episódio
- **Autoplay do próximo episódio** com countdown cancelável
- Progresso, favoritos, histórico e "assistir depois" **por perfil e por playlist**
- Downloads offline (paralelo, com fila por temporada)
- Legendas automáticas (OpenSubtitles) com escolha de idioma; faixas de áudio em streams HLS

### 👤 Perfis e aparência
- Até 5 perfis com avatar, **cor própria (re-tema o app ao trocar)** e PIN opcional
- Perfil Kids com filtragem de conteúdo + Controle Parental por categoria
- Temas: fundo padrão/AMOLED + 6 cores de destaque
- Multi-playlist: vários provedores Xtream salvos, troca rápida

### 🖥️ Integrações
- **Cast** para Smart TVs via DLNA (com remux automático pra Samsung) e AirPlay
- **MPV opcional** (download com 1 clique): pseudo-embutido, troca de faixa de áudio/legenda em MP4 com memória por conteúdo
- **Gamepad**: navegue o app inteiro pelo controle (D-pad, A/B, LB/RB pra zapping)
- Picture-in-Picture flutuante, atalhos de teclado no player
- **Auto-update silencioso** via GitHub Releases (Windows/Linux/macOS)

---

## 🚀 Desenvolvimento

```bash
npm install       # dependências
npm run dev       # Vite + Electron em modo dev
npm run test:run  # ~390 testes unitários (vitest)
npm run test:e2e  # ~24 testes E2E (Playwright + mock Xtream)
npm run build:win # build Windows (NSIS + portable)
```

- **Stack:** Electron 43 · React 19 · TypeScript 6 · Vite 8 · Tailwind 4
- **CI:** typecheck + lint + unit + E2E + `npm audit` em Windows/Linux/macOS; tag `v*.*.*` publica a release com feeds de auto-update
- **Chaves de API são do usuário:** os builds **não embutem** chave nenhuma. Cada pessoa configura as próprias em **Configurações → APIs** dentro do app — TMDB (gratuita: capas, sinopses, notas, trailers e controle parental) e OpenSubtitles (opcional: busca de legendas online). Ao adicionar a primeira playlist, o app guia a configuração. Para desenvolvimento local, `VITE_TMDB_API_KEY` e `OPEN_SUBTITLES_*` num `.env` (nunca commitado) valem como fallback.

---

## 🙏 Créditos

- [TMDB](https://www.themoviedb.org/) pela API de metadados de filmes/séries
- [hls.js](https://github.com/video-dev/hls.js) e [mpv](https://mpv.io/) pelo playback
- [OpenSubtitles](https://www.opensubtitles.com/) pelas legendas

## ⚠️ Aviso

Aplicativo para uso pessoal. Garanta que você tem os direitos de reproduzir o conteúdo do seu provedor IPTV. Este produto usa a API do TMDB mas não é endossado ou certificado pelo TMDB.

---

**Built with ❤️ by [Rakjsu](https://github.com/Rakjsu)**
