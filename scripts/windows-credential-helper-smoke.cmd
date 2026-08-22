@echo off
setlocal
set "ELECTRON_RUN_AS_NODE=1"
set "ARKME_ROOT=%LOCALAPPDATA%\Programs\arkme"
set "ARKME_PLUGIN=%ARKME_ROOT%\resources\app.asar.unpacked\node_modules\@senguoyun\dsh-arkme"
"%ARKME_ROOT%\arkme.exe" "%TEMP%\windows-credential-helper-smoke.mjs" "%ARKME_PLUGIN%\assets\windows\arkme-credential-helper.exe" > "%TEMP%\windows-credential-helper-smoke.out" 2>&1
> "%TEMP%\windows-credential-helper-smoke.exit" echo %ERRORLEVEL%
