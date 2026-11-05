@echo off
chcp 65001 >nul
title 我的照片墙
cd /d "%~dp0"

rem ---- 找 node：优先程序自带的 runtime\node.exe，其次包根 node.exe，最后系统 node ----
set "NODE=%~dp0runtime\node.exe"
if exist "%NODE%" goto run
set "NODE=%~dp0node.exe"
if exist "%NODE%" goto run
for %%I in (node.exe) do if exist "%%~$PATH:I" set "NODE=%%~$PATH:I"
if exist "%NODE%" goto run

echo [出错了] 找不到 node.exe
echo 请确认下载的包完整（里面应该有 runtime 文件夹），或安装 Node.js 后再双击本文件。
echo.
pause
exit /b 1

:run
echo 正在启动，浏览器稍后自动打开……
echo 第一次使用会让你选照片文件夹、设个密码，跟着页面走就行。
echo 想停止：直接关闭这个窗口即可。
echo.
"%NODE%" server.mjs %*
echo.
echo 已停止。如果是意外退出，把上面的错误信息截图发给分享给你的人。
pause
