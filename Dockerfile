FROM python:3.11-slim

# Install system dependencies including FFmpeg and SSL/TLS support
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ffmpeg \
    libssl-dev \
    curl \
    ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Verify FFmpeg installation
RUN ffmpeg -version | head -n 1 && \
    ffprobe -version | head -n 1 && \
    echo "✓ FFmpeg installed successfully"

# Set working directory
WORKDIR /app

# Copy application files
COPY . /app/

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    if [ -f requirements.txt ]; then \
        pip install --no-cache-dir -r requirements.txt; \
    fi

# Set environment variables for Render
ENV PORT=10000
EXPOSE 10000

# Health check - verify server is running
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:10000/ || exit 1

# Run the server
