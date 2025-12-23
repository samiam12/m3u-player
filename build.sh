#!/bin/bash
# Build script for Render deployment
# Downloads prebuilt ffmpeg binary since apt-get is read-only

set -e

echo "Downloading ffmpeg binary..."

# Create bin directory
mkdir -p ~/.local/bin

# Download ffmpeg static build for Linux
wget -q https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -O /tmp/ffmpeg.tar.xz

echo "Extracting ffmpeg..."
tar -xf /tmp/ffmpeg.tar.xz -C /tmp
cp /tmp/ffmpeg-*-amd64-static/ffmpeg ~/.local/bin/
chmod +x ~/.local/bin/ffmpeg

# Add to PATH
export PATH="$HOME/.local/bin:$PATH"

echo "Installing Python dependencies..."
pip install --upgrade pip

if [ -f requirements.txt ]; then
    echo "Installing Python packages from requirements.txt..."
    pip install -r requirements.txt
fi

echo "Build complete! ffmpeg version:"
ffmpeg -version | head -1

