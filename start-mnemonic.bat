@echo off
chcp 65001 >nul
title mnemonic

set MNEMONIC_PORT=3457
set MNEMONIC_NAMESPACE=reasonix

REM ── 数据库路径 ──────────────────────────────────────────
REM 放同步盘上，跨设备共享同一份记忆库
set MNEMONIC_DB_DIR=D:\说剑与你听-60FFD3\华为家庭存储\知识库\mnemonic
REM ────────────────────────────────────────────────────────

echo [mnemonic] 启动中...
echo   Port: %MNEMONIC_PORT%
echo   Namespace: %MNEMONIC_NAMESPACE%
if "%MNEMONIC_DB_DIR%"=="" (
  echo   Database: mnemonic/data/
) else (
  echo   Database: %MNEMONIC_DB_DIR%
)
echo.
echo 管理界面: http://localhost:%MNEMONIC_PORT%/
echo.

node D:\Reasonix\mnemonic\src\index.js

if errorlevel 1 (
  echo.
  echo [mnemonic] 启动失败，按任意键退出
  pause >nul
)
