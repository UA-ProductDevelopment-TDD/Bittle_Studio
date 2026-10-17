#!/usr/bin/env bash
# Used by the Mac and Linux Setup launchers, from the Bittle Studio folder: downloads uv and, with it, Python into .tools
# (see app/setup-versions.txt), then app/install.py makes the Python environment and installs the packages.
# No Python, compiler or administrator rights are needed beforehand.
pin() { awk -v key="$1" '$1 == key { print $2 }' app/setup-versions.txt; }
stop() { echo; echo "Setup stopped: $1"; exit 1; }

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) target=aarch64-apple-darwin ;;
  Darwin-x86_64) target=x86_64-apple-darwin ;;
  Linux-x86_64) target=x86_64-unknown-linux-gnu ;;
  Linux-aarch64 | Linux-arm64) target=aarch64-unknown-linux-gnu ;;
  *) stop "Setup does not support this computer ($(uname -sm))." ;;
esac
export UV_PYTHON_INSTALL_DIR="$PWD/.tools/python" UV_MANAGED_PYTHON=1 UV_PYTHON_INSTALL_BIN=0 UV_PYTHON_INSTALL_REGISTRY=0 UV_SYSTEM_CERTS=1
uv=.tools/uv/uv

if [ ! -x "$uv" ]; then
  archive="uv-$target.tar.gz"
  url="https://github.com/astral-sh/uv/releases/download/$(pin uv)/$archive"
  echo
  echo "=== Downloading uv $(pin uv) (it installs Python for Bittle Studio) ==="
  mkdir -p .tools/uv
  if command -v curl >/dev/null 2>&1; then curl -fL --retry 3 -o ".tools/$archive" "$url"; else wget -O ".tools/$archive" "$url"; fi ||
    stop "uv could not be downloaded. Check the internet connection and run Setup again."
  sum=$( (sha256sum ".tools/$archive" 2>/dev/null || shasum -a 256 ".tools/$archive") | cut -d' ' -f1)
  if [ "$sum" != "$(pin "$archive")" ]; then
    rm -f ".tools/$archive"
    stop "the downloaded uv does not match its checksum in app/setup-versions.txt."
  fi
  tar -xzf ".tools/$archive" -C .tools/uv --strip-components 1 "uv-$target/uv" || stop "uv could not be unpacked."
  rm -f ".tools/$archive"
fi

python=$(pin python)
"$uv" python install "$python" || stop "Python $python could not be installed. Check the internet connection and run Setup again."
interpreter=$("$uv" python find --system "$python") || stop "Python $python could not be found after installing it."
"$interpreter" app/install.py
