; Earful: hooks for the electron-builder NSIS installer (picked up automatically from build/installer.nsh).
;
; The user's library lives in %APPDATA%\Earful\data, outside the install folder, and the installer
; never removes it ("deleteAppDataOnUninstall": false, and updates always keep app data).
; As a second safety net, copy it aside before the old version is replaced.

!macro customInit
  Push $R0
  ; Electron keeps app data per user, whatever the install mode: use the user's own Roaming folder.
  ReadEnvStr $R0 APPDATA
  IfFileExists "$R0\Earful\data\library.json" 0 earful_no_library
    CreateDirectory "$R0\Earful\backups"
    CopyFiles /SILENT "$R0\Earful\data\library.json" "$R0\Earful\backups\library-before-install-${VERSION}.json"
  earful_no_library:
  Pop $R0
!macroend
