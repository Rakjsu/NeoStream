; ═══════════════════════════════════════════════════════════════════════
; NeoStream IPTV - Custom NSIS Installer Script
; Compatible with electron-builder
; ═══════════════════════════════════════════════════════════════════════

; NOTE: MUI_ICON, MUI_UNICON are already defined by electron-builder
; Do NOT redefine them here!

; ═══════════════════════════════════════════════════════════════════════
; WELCOME/FINISH PAGE - SIDEBAR (only if not already defined)
; ═══════════════════════════════════════════════════════════════════════

!ifndef MUI_WELCOMEFINISHPAGE_BITMAP
  !define MUI_WELCOMEFINISHPAGE_BITMAP "${BUILD_RESOURCES_DIR}\installer-sidebar.bmp"
!endif

!ifndef MUI_UNWELCOMEFINISHPAGE_BITMAP
  !define MUI_UNWELCOMEFINISHPAGE_BITMAP "${BUILD_RESOURCES_DIR}\uninstaller-sidebar.bmp"
!endif

; ═══════════════════════════════════════════════════════════════════════
; WELCOME PAGE TEXT
; ═══════════════════════════════════════════════════════════════════════

!define MUI_WELCOMEPAGE_TITLE "Bem-vindo ao NeoStream IPTV"
!define MUI_WELCOMEPAGE_TEXT "Este assistente ira guia-lo atraves da instalacao do NeoStream IPTV.$\r$\n$\r$\nRecursos principais:$\r$\n$\r$\n  - TV ao vivo com EPG integrado$\r$\n  - Filmes e Series on-demand$\r$\n  - Download para assistir offline$\r$\n  - Multiplos perfis de usuario$\r$\n  - Atualizacoes automaticas$\r$\n$\r$\nClique em Avancar para continuar."

; ═══════════════════════════════════════════════════════════════════════
; DIRECTORY PAGE TEXT
; ═══════════════════════════════════════════════════════════════════════

!define MUI_DIRECTORYPAGE_TEXT_TOP "O NeoStream IPTV sera instalado na pasta abaixo.$\r$\n$\r$\nPara instalar em uma pasta diferente, clique em Procurar."

; ═══════════════════════════════════════════════════════════════════════
; FINISH PAGE 
; ═══════════════════════════════════════════════════════════════════════

!define MUI_FINISHPAGE_TITLE "Instalacao Concluida!"
!define MUI_FINISHPAGE_TEXT "O NeoStream IPTV foi instalado com sucesso no seu computador.$\r$\n$\r$\nClique em Concluir para fechar o instalador."
