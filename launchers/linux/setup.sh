#!/usr/bin/env bash
# Install once, and again after getting a new version: Python, the packages and the 3D viewer library (app/bootstrap.sh).
cd "$(dirname "$0")/../.." || exit 1
bash app/bootstrap.sh
