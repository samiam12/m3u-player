# Render Docker Deployment Guide

## Current Setup

- **Runtime**: Docker
- **Dockerfile**: ./Dockerfile (installs FFmpeg, Python deps)
- **Port**: 10000
- **Health Check**: GET /

## Important: Web Service Settings

If Render's **web service settings** are overriding `render.yaml`:

1. Go to Dashboard → Services → m3u-player
2. Check the **"Build Command"** field
   - Should be EMPTY or "Docker"
   - NOT "python server.py"

3. Check the **"Start Command"** field
   - Should be EMPTY
   - Docker's CMD handles it

## Troubleshooting

**If you see: `ModuleNotFoundError: No module named 'requests'`**
- Render is running Python on the host (wrong!)
- Not using Docker container (where requests is installed)

**Fix:**
1. Clear the "Start Command" field in Render dashboard
2. Save the service
3. Redeploy

**If you see: `ffmpeg: True` in logs**
- FFmpeg installed correctly ✓
- Transcode will work ✓

## Testing

Once deployed, check logs for:

```
[TRANSCODE] ffmpeg: True, ffprobe: True
[TRANSCODE] Detected codec: h264
```

This means Docker container is running properly.
