#!/bin/bash
# Build script for Render deployment
# Note: This is optional when using Docker (Dockerfile handles all setup)
# If running on standard Python environment (not Docker), uncomment below:

# set -e
# echo "Installing Python dependencies..."
# pip install --upgrade pip
# pip install -r requirements.txt
# echo "Build complete!"

# For Docker-based deployment on Render:
# The Dockerfile handles all system and Python dependencies
# Just ensure render.yaml points to the Dockerfile

echo "✓ For Docker deployment: Render will use the Dockerfile"
echo "✓ Dockerfile includes FFmpeg, Python deps, and health checks"
