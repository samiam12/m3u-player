#!/bin/bash
# Build script for Render deployment
# Installs streamlink for robust stream recording

set -e

echo "Installing Python dependencies..."
pip install --upgrade pip

if [ -f requirements.txt ]; then
    echo "Installing Python packages from requirements.txt..."
    pip install -r requirements.txt
fi

echo "Build complete! Streamlink version:"
streamlink --version

