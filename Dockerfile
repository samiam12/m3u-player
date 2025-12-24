FROM python:3.11-slim

# Install system dependencies including FFmpeg and SSL/TLS support
# Combine RUN commands to reduce layer count and improve caching
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ffmpeg \
    libssl-dev \
    curl \
    ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    ffmpeg -version | head -n 1 && \
    ffprobe -version | head -n 1 && \
    echo "✓ FFmpeg installed successfully"

# Set working directory
WORKDIR /app

# Copy requirements first (for better Docker layer caching)
# This way, Docker only rebuilds Python deps if requirements.txt changes
COPY requirements.txt* ./

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    if [ -f requirements.txt ]; then \
        pip install --no-cache-dir -r requirements.txt; \
    fi

# Copy application files (after dependencies, so code changes don't invalidate pip cache)
COPY . /app/

# Set environment variables for Render
ENV PORT=10000
EXPOSE 10000

# Health check - verify server is running
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:10000/ || exit 1

# Run the server
CMD ["python", "server.py"]
