; ═══════════════════════════════════════════════════════════════════════
; NeoStream IPTV - Custom NSIS Installer Script
; Design baseado no app: cores #a855f7 (purple) → #ec4899 (pink)
; Background: #0f0f1a (dark)
;
; Páginas:
;   Welcome   → custom (nsDialogs, full dark + arte lateral)   [customWelcomePage]
;   Directory → MUI restilizada (MUI_BGCOLOR escuro)
;   InstFiles → MUI restilizada (log roxo-claro sobre escuro)
;   Finish    → MUI restilizada (mantém checkbox "Iniciar app")
;   Un.Welcome→ custom (nsDialogs, dark)                       [customUnWelcomePage]
;
; NOTE: MUI_ICON, MUI_UNICON, MUI_HEADERIMAGE*, MUI_(UN)WELCOMEFINISHPAGE_BITMAP
;       são gerenciados pelo electron-builder (installerHeader / installerSidebar /
;       uninstallerSidebar do package.json).
; ═══════════════════════════════════════════════════════════════════════

!include "nsDialogs.nsh"
!include "WinMessages.nsh"

; ═══════════════════════════════════════════════════════════════════════
; APP THEME — dark background + light text em todas as páginas MUI
; Palette: #0f0f1a (bg) / #a855f7 (accent) / #c4b5fd (light purple) / #ffffff
; ═══════════════════════════════════════════════════════════════════════

!define MUI_BGCOLOR "0F0F1A"
!define MUI_TEXTCOLOR "FFFFFF"

; Página de progresso: log roxo-claro sobre o fundo escuro do app
!define MUI_INSTFILESPAGE_COLORS "C4B5FD 0F0F1A"

; ═══════════════════════════════════════════════════════════════════════
; BRANDING TEXT (VERSION é fornecido pelo electron-builder)
; ═══════════════════════════════════════════════════════════════════════

BrandingText "NeoStream IPTV v${VERSION}"

; ═══════════════════════════════════════════════════════════════════════
; WELCOME PAGE — totalmente custom via nsDialogs (substitui a MUI)
; Fundo #0f0f1a em toda a área, arte da sidebar à esquerda,
; título grande + tagline com accent roxo
; ═══════════════════════════════════════════════════════════════════════

!macro customWelcomePage
  Page custom nsWelcomePageCreate nsWelcomePageLeave

  Var WelcomeBmpHandle

  Function nsWelcomePageCreate
    ; Em update silencioso/assistido, pula a página (mesmo comportamento
    ; do skipPageIfUpdated usado nas páginas MUI)
    ${if} ${isUpdated}
      Abort
    ${endif}

    !insertmacro MUI_HEADER_TEXT "Bem-vindo" "Instalação do NeoStream IPTV"

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    SetCtlColors $0 0xFFFFFF 0x0F0F1A

    ; ─── Painel de arte à esquerda (mesma arte da sidebar) ───
    InitPluginsDir
    File "/oname=$PLUGINSDIR\ns-welcome-side.bmp" "${BUILD_RESOURCES_DIR}\installer-sidebar.bmp"
    ${NSD_CreateBitmap} 0 0 109u 100% ""
    Pop $1
    ${NSD_SetImage} $1 "$PLUGINSDIR\ns-welcome-side.bmp" $WelcomeBmpHandle

    ; ─── Título grande ───
    ${NSD_CreateLabel} 118u 10u 176u 24u "NeoStream IPTV"
    Pop $2
    SetCtlColors $2 0xFFFFFF 0x0F0F1A
    CreateFont $3 "Segoe UI" 17 700
    SendMessage $2 ${WM_SETFONT} $3 0

    ; ─── Versão (accent roxo) ───
    ${NSD_CreateLabel} 118u 34u 176u 11u "Versão ${VERSION}"
    Pop $4
    SetCtlColors $4 0xA855F7 0x0F0F1A
    CreateFont $5 "Segoe UI" 9 600
    SendMessage $4 ${WM_SETFONT} $5 0

    ; ─── Tagline ───
    ${NSD_CreateLabel} 118u 48u 176u 12u "Seu streaming, do seu jeito."
    Pop $6
    SetCtlColors $6 0xC4B5FD 0x0F0F1A
    CreateFont $7 "Segoe UI" 10 400 /ITALIC
    SendMessage $6 ${WM_SETFONT} $7 0

    ; ─── Texto principal ───
    ${NSD_CreateLabel} 118u 68u 176u 56u "O assistente vai instalá-lo em seu computador.$\r$\n$\r$\nTV ao vivo com EPG, filmes e séries on-demand, downloads offline e múltiplos perfis — tudo com a cara do app.$\r$\n$\r$\nClique em Avançar para continuar."
    Pop $8
    SetCtlColors $8 0xFFFFFF 0x0F0F1A

    ; ─── Rodapé sutil ───
    ${NSD_CreateLabel} 118u 128u 176u 10u "© Rakjsu — NeoStream IPTV"
    Pop $9
    SetCtlColors $9 0x6B6B8A 0x0F0F1A

    nsDialogs::Show
  FunctionEnd

  Function nsWelcomePageLeave
    ${NSD_FreeImage} $WelcomeBmpHandle
  FunctionEnd
!macroend

; ═══════════════════════════════════════════════════════════════════════
; DIRECTORY PAGE (MUI restilizada — escura via MUI_BGCOLOR)
; ═══════════════════════════════════════════════════════════════════════

!define MUI_DIRECTORYPAGE_TEXT_TOP "O NeoStream IPTV será instalado na pasta abaixo.$\r$\n$\r$\nPara instalar em uma pasta diferente, clique em Procurar."

; ═══════════════════════════════════════════════════════════════════════
; FINISH PAGE (MUI restilizada — mantida para preservar o checkbox
; "Iniciar NeoStream IPTV" que o electron-builder conecta via
; MUI_FINISHPAGE_RUN + StartApp)
; ═══════════════════════════════════════════════════════════════════════

!define MUI_FINISHPAGE_TITLE "Instalação concluída!"
!define MUI_FINISHPAGE_TEXT "O NeoStream IPTV foi instalado com sucesso no seu computador.$\r$\n$\r$\nAproveite sua experiência de streaming!$\r$\n$\r$\nClique em Concluir para fechar o instalador."
!define MUI_FINISHPAGE_RUN_TEXT "Iniciar NeoStream IPTV"

; ═══════════════════════════════════════════════════════════════════════
; UNINSTALLER WELCOME — custom via nsDialogs (substitui MUI_UNPAGE_WELCOME)
; ═══════════════════════════════════════════════════════════════════════

!macro customUnWelcomePage
  UninstPage custom un.nsWelcomePageCreate un.nsWelcomePageLeave

  Var UnWelcomeBmpHandle

  Function un.nsWelcomePageCreate
    !insertmacro MUI_HEADER_TEXT "Desinstalar" "NeoStream IPTV"

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    SetCtlColors $0 0xFFFFFF 0x0F0F1A

    InitPluginsDir
    File "/oname=$PLUGINSDIR\ns-unwelcome-side.bmp" "${BUILD_RESOURCES_DIR}\uninstaller-sidebar.bmp"
    ${NSD_CreateBitmap} 0 0 109u 100% ""
    Pop $1
    ${NSD_SetImage} $1 "$PLUGINSDIR\ns-unwelcome-side.bmp" $UnWelcomeBmpHandle

    ${NSD_CreateLabel} 118u 10u 176u 24u "NeoStream IPTV"
    Pop $2
    SetCtlColors $2 0xFFFFFF 0x0F0F1A
    CreateFont $3 "Segoe UI" 17 700
    SendMessage $2 ${WM_SETFONT} $3 0

    ${NSD_CreateLabel} 118u 36u 176u 12u "Desinstalação"
    Pop $4
    SetCtlColors $4 0xA855F7 0x0F0F1A
    CreateFont $5 "Segoe UI" 10 600
    SendMessage $4 ${WM_SETFONT} $5 0

    ${NSD_CreateLabel} 118u 56u 176u 64u "O NeoStream IPTV será removido do seu computador.$\r$\n$\r$\nSuas listas, perfis e configurações NÃO serão apagados — você pode reinstalar quando quiser.$\r$\n$\r$\nClique em Avançar para continuar."
    Pop $6
    SetCtlColors $6 0xFFFFFF 0x0F0F1A

    nsDialogs::Show
  FunctionEnd

  Function un.nsWelcomePageLeave
    ${NSD_FreeImage} $UnWelcomeBmpHandle
  FunctionEnd
!macroend

; ═══════════════════════════════════════════════════════════════════════
; CHECK IF APP IS RUNNING (uninstaller)
; ═══════════════════════════════════════════════════════════════════════

!macro customUnInit
  ; Check if NeoStream IPTV is running before uninstall
  FindWindow $0 "" "NeoStream IPTV"
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "O NeoStream IPTV está em execução.$\r$\n$\r$\nFeche o aplicativo antes de desinstalar." /SD IDOK
    Abort
  ${EndIf}
!macroend

; ═══════════════════════════════════════════════════════════════════════
; CHECK IF APP IS RUNNING (installer)
; ═══════════════════════════════════════════════════════════════════════

!macro customInit
  ; Check if NeoStream IPTV is running before install
  FindWindow $0 "" "NeoStream IPTV"
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "O NeoStream IPTV está em execução.$\r$\n$\r$\nFeche o aplicativo e tente novamente." /SD IDOK
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
