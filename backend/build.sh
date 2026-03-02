#!/usr/bin/env bash
# build.sh – Render build script for the FastAPI backend (native runtime).
# Set as "Build Command" in Render dashboard if NOT using Docker.
set -o errexit

pip install --upgrade pip
pip install -r requirements.txt
