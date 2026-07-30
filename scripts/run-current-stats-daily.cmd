@echo off
setlocal
cd /d "%~dp0.."
if not exist ".cache\current-stats" mkdir ".cache\current-stats"
call npm run stats:daily >> ".cache\current-stats\scheduler.log" 2>&1
exit /b %errorlevel%
