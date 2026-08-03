@echo off
setlocal
cd /d "%~dp0.."
if not exist ".cache\opgg-collect" mkdir ".cache\opgg-collect"
call node scripts\opgg-collect.mjs >> ".cache\opgg-collect\collector.log" 2>&1
exit /b %errorlevel%
