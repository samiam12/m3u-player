#!/bin/bash
# Build script for Render deployment
# Installs system dependencies and Python packages for M3U Player

set -e

echo "=========================================="
echo "M3U Player Build Script for Render"
echo "=========================================="

echo ""
echo "Step 1: Updating package lists..."
apt-get update -y

echo ""
echo "Step 2: Installing system dependencies..."
echo "  - FFmpeg (for audio/video transcoding)"
echo "  - libssl-dev (SSL support)"
echo "  - curl (HTTP utilities)"
apt-get install -y \
    ffmpeg \
    libssl-dev \
    curl \
    ca-certificates

echo ""
echo "Step 3: Verifying FFmpeg installation..."
ffmpeg -version | head -n 1
ffprobe -version | head -n 1

echo ""
echo "Step 4: Installing Python dependencies..."
pip install --upgrade pip

if [ -f requirements.txt ]; then
    echo "Installing Python packages from requirements.txt..."
    pip install -r requirements.txt
else
    echo "WARNING: requirements.txt not found"
fi

echo ""
echo "=========================================="
echo "✓ Build complete!"
echo "=========================================="
echo ""
echo "Installed components:"
echo "  - FFmpeg: $(ffmpeg -version | head -n 1 | cut -d' ' -f1-3)"
echo "  - FFprobe: installed"
echo "  - Python: $(python3 --version)"
echo ""
