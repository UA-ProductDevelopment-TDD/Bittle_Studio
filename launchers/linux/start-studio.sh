#!/usr/bin/env bash
# Starts the full Studio: simulator, timeline editor and robot connection.
cd "$(dirname "$0")/../.." || exit 1
if [ ! -x .venv/bin/python ]; then
  echo "Run Setup first to install Bittle Studio."
  exit 1
fi
echo "Starting Bittle Studio at http://127.0.0.1:8765"
echo "Keep this window open. Press Ctrl+C here to stop."
.venv/bin/python app/launcher.py
