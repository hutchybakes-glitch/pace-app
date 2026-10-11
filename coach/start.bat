@echo off
rem Pacer laptop coach: double-click to start. Leave the window open while you run.
title Pacer laptop coach
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"

rem 1. Python's own private folder for the coach (made once)
if not exist ".venv\Scripts\python.exe" (
  echo Setting up Python for the coach, once...
  python -m venv .venv || (echo. & echo Python 3 is needed: install it free from https://www.python.org and tick "Add to PATH". & pause & exit /b 1)
)

rem 2. Whisper, for voice (installed once, free and open source)
if not exist ".venv\deps-ok.txt" (
  echo Installing Whisper for voice, once - a few minutes...
  ".venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check faster-whisper && echo ok> ".venv\deps-ok.txt"
)

rem 3. Everything else: Ollama, the model, the proxy, the tunnel
".venv\Scripts\python.exe" run.py
pause
