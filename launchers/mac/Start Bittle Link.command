#!/usr/bin/env bash
# Starts only the Bittle Link robot console (no simulator). Uses Setup's Python, or else any Python 3.
cd "$(dirname "$0")/../.." || exit 1
if [ -x .venv/bin/python ]; then
  .venv/bin/python app/bittle_link.py "$@"
elif command -v python3 >/dev/null 2>&1; then
  python3 app/bittle_link.py "$@"
else
  echo "Run Setup first: it installs Python for Bittle Studio."
fi
read -r -p "Press Enter to close this window." _
