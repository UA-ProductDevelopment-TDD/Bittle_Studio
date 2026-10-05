#!/usr/bin/env bash
# Gets the latest version from GitHub, then refreshes the installed packages.
cd "$(dirname "$0")/../.." || exit 1
PY=""
for candidate in python3.12 python3.11 python3.10 python3; do
  if command -v "$candidate" >/dev/null 2>&1; then PY="$candidate"; break; fi
done
if [ -z "$PY" ]; then
  echo "Python 3.11 or 3.12 is needed. Get it from https://www.python.org/downloads/ (or your package manager)."
  exit 1
fi
"$PY" app/install.py --update
read -r -p "Press Enter to close this window." _
