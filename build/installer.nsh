; ═══════════════════════════════════════════════════════════════════════
; NeoStream IPTV - Custom NSIS Installer Script
; Design baseado no app: cores #a855f7 (purple) → #ec4899 (pink)
; Background: #0f0f1a (dark)
; ═══════════════════════════════════════════════════════════════════════

; NOTE: MUI_ICON, MUI_UNICON are managed by electron-builder

; ═══════════════════════════════════════════════════════════════════════
; BRANDING TEXT
; ═══════════════════════════════════════════════════════════════════════

BrandingText "NeoStream IPTV v3.9.0"

; ═══════════════════════════════════════════════════════════════════════
; WELCOME PAGE CUSTOMIZATION
; ═══════════════════════════════════════════════════════════════════════

!define MUI_WELCOMEPAGE_TITLE "Bem-vindo ao NeoStream IPTV"
!define MUI_WELCOMEPAGE_TEXT "Este assistente ira guia-lo atraves da instalacao do NeoStream IPTV.$\r$\n$\r$\nRecursos principais:$\r$\n$\r$\n  - TV ao vivo com EPG integrado$\r$\n  - Filmes e Series on-demand$\r$\n  - Download para assistir offline$\r$\n  - Multiplos perfis de usuario$\r$\n  - Atualizacoes automaticas$\r$\n$\r$\nClique em Avancar para continuar."

; ═══════════════════════════════════════════════════════════════════════
; DIRECTORY PAGE
; ═══════════════════════════════════════════════════════════════════════

!define MUI_DIRECTORYPAGE_TEXT_TOP "O NeoStream IPTV sera instalado na pasta abaixo.$\r$\n$\r$\nPara instalar em uma pasta diferente, clique em Procurar."

; ═══════════════════════════════════════════════════════════════════════
; FINISH PAGE - With proper text visibility
; ═══════════════════════════════════════════════════════════════════════

!define MUI_FINISHPAGE_TITLE "Instalacao Concluida!"
!define MUI_FINISHPAGE_TEXT "O NeoStream IPTV foi instalado com sucesso no seu computador.$\r$\n$\r$\nAproveite sua experiencia de streaming!$\r$\n$\r$\nClique em Concluir para fechar o instalador."
!define MUI_FINISHPAGE_RUN_TEXT "Iniciar NeoStream IPTV"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Criar atalho na Area de Trabalho"

; ═══════════════════════════════════════════════════════════════════════
; CHECK IF APP IS RUNNING (for uninstaller)
; ═══════════════════════════════════════════════════════════════════════

!macro customUnInit
  ; Check if NeoStream IPTV is running before uninstall
  FindWindow $0 "" "NeoStream IPTV"
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "O NeoStream IPTV esta em execucao.$\r$\n$\r$\nFeche o aplicativo antes de desinstalar." /SD IDOK
    Abort
  ${EndIf}
!macroend

; ═══════════════════════════════════════════════════════════════════════
; CHECK IF APP IS RUNNING (for installer)
; ═══════════════════════════════════════════════════════════════════════

!macro customInit
  ; Check if NeoStream IPTV is running before install
  FindWindow $0 "" "NeoStream IPTV"
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "O NeoStream IPTV esta em execucao.$\r$\n$\r$\nFeche o aplicativo e tente novamente." /SD IDOK
    Abort
  ${EndIf}
!macroend

; ═══════════════════════════════════════════════════════════════════════
; CUSTOM SHORTCUT - Use app icon properly
; ═══════════════════════════════════════════════════════════════════════

!macro customInstall
  ; Create desktop shortcut with correct icon
  CreateShortCut "$DESKTOP\NeoStream IPTV.lnk" "$INSTDIR\NeoStream IPTV.exe" "" "$INSTDIR\NeoStream IPTV.exe" 0
  
  ; Create start menu shortcut with correct icon
  CreateDirectory "$SMPROGRAMS\NeoStream IPTV"
  CreateShortCut "$SMPROGRAMS\NeoStream IPTV\NeoStream IPTV.lnk" "$INSTDIR\NeoStream IPTV.exe" "" "$INSTDIR\NeoStream IPTV.exe" 0
  CreateShortCut "$SMPROGRAMS\NeoStream IPTV\Desinstalar.lnk" "$INSTDIR\Uninstall NeoStream IPTV.exe" "" "$INSTDIR\Uninstall NeoStream IPTV.exe" 0
!macroend

!macro customUnInstall
  ; Remove shortcuts
  Delete "$DESKTOP\NeoStream IPTV.lnk"
  RMDir /r "$SMPROGRAMS\NeoStream IPTV"
!macroend
