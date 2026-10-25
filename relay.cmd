@echo off
rem Relay terminal client. Uses Node 24; no Bun, no build step.
where node >nul 2>nul
if errorlevel 1 (
  echo Relay needs Node 24 or newer. Install it from https://nodejs.org/ and try again.
  exit /b 1
)
node "%~dp0cli.mjs" %*
exit /b %ERRORLEVEL%
