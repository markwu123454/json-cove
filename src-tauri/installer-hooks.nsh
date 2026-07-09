; Custom Explorer icons for the associated file types.
;
; Tauri registers each extension (.json/.jsonl/.ndjson/.ldjson) to a ProgID but
; points every one at the app's own icon. This POSTINSTALL hook runs *after*
; those associations exist: for each extension we read back the ProgID Tauri
; wrote and repoint its DefaultIcon at the matching bundled .ico. Reading the
; ProgID back keeps this independent of Tauri's internal ProgID naming.
;
; The .ico files are shipped via `bundle.resources` and land in
; `$INSTDIR\fileicons\`. Tauri removes the ProgID keys (and this subkey) plus the
; resource files on uninstall, so no uninstall hook is needed.

!macro NSIS_HOOK_POSTINSTALL
  Push $R0

  ReadRegStr $R0 SHCTX "Software\Classes\.json" ""
  StrCmp $R0 "" +2 0
    WriteRegStr SHCTX "Software\Classes\$R0\DefaultIcon" "" "$INSTDIR\fileicons\json.ico,0"

  ReadRegStr $R0 SHCTX "Software\Classes\.jsonl" ""
  StrCmp $R0 "" +2 0
    WriteRegStr SHCTX "Software\Classes\$R0\DefaultIcon" "" "$INSTDIR\fileicons\jsonl.ico,0"

  ReadRegStr $R0 SHCTX "Software\Classes\.ndjson" ""
  StrCmp $R0 "" +2 0
    WriteRegStr SHCTX "Software\Classes\$R0\DefaultIcon" "" "$INSTDIR\fileicons\ndjson.ico,0"

  ReadRegStr $R0 SHCTX "Software\Classes\.ldjson" ""
  StrCmp $R0 "" +2 0
    WriteRegStr SHCTX "Software\Classes\$R0\DefaultIcon" "" "$INSTDIR\fileicons\ldjson.ico,0"

  Pop $R0

  ; Nudge the shell so the new icons appear without a reboot / cache clear.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
