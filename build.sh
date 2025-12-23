#!/bin/bash
# Build script for Render deployment
# Installs ffmpeg and other dependencies

set -e

echo "Installing system dependencies (ffmpeg)..."
apt-get update
apt-get install -y ffmpeg

echo "Installing Python dependencies..."
pip install --upgrade pip

if [ -f requirements.txt ]; then
    echo "Installing Python packages from requirements.txt..."
    pip install -r requirements.txt
fi

echo "Build complete!"
