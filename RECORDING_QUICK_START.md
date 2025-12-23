# Recording Features - Quick Start Guide

## Installation Requirements

Before using the recording feature, make sure **ffmpeg** is installed:

### Linux (Ubuntu/Debian)
```bash
sudo apt-get update
sudo apt-get install ffmpeg
```

### macOS
```bash
brew install ffmpeg
```

### Windows
Download from https://ffmpeg.org/download.html or use:
```bash
choco install ffmpeg
```

---

## How to Use

### 1. Record a Live Stream

1. **Select and play a channel** from the sidebar
2. **Click the ⏺ Record button** in the HUD (red button on left)
3. The button turns **red with a pulsing animation**
4. **Click again to stop** recording
5. See a toast notification with duration: "Recording stopped (5m 30s)"
6. File saved in `recordings/` folder

### 2. View and Play Recordings

1. **Click the 🎞️ Recordings button** (film strip icon)
2. A modal opens showing all saved recordings
3. Each recording shows:
   - Channel name
   - Date & time recorded
   - Duration
   - File size
4. **Click ▶ Play** to watch the recording
5. **Click 🗑️ Delete** to remove (confirmation required)

### 3. Schedule a Future Recording

1. **Click 🎞️ Recordings** to open recordings modal
2. **Click ⏱️ Schedule** button at the bottom
3. Fill in the form:
   - **Channel**: Pick from dropdown
   - **Start Time**: Set when recording should begin
   - **Duration**: How long to record (in minutes)
4. **Click Schedule** to confirm
5. Toast shows: "Recording scheduled for 'Channel Name' at [time]"
6. App will automatically:
   - Load the channel at scheduled time
   - Start recording
   - Stop recording after specified duration

---

## Recorded Files

### Location
```
m3u-player/
└── recordings/
    ├── rec_1703350000_Channel1.ts
    ├── rec_1703353600_Channel2.ts
    └── rec_1703357200_Channel3.ts
```

### Naming Convention
`rec_[UNIX_TIMESTAMP]_[CHANNEL_NAME].ts`

### File Format
- **Type**: MPEG-TS (`.ts`)
- **Codec**: Copy of original stream (no re-encoding)
- **Size**: Depends on stream bitrate and duration
  - Example: 1GB per hour for HD stream

---

## Tips & Tricks

### Recording Long Streams
- Max automatic duration is 10 hours per recording
- For longer streams, stop and restart

### Playback
- Seek/pause works normally in recorded files
- Same player as live streams

### Scheduling
- Use "ASAP" scheduling: Set start time to 5 minutes from now
- Can schedule multiple recordings (runs sequentially)
- Keep app/browser open for scheduled recordings to work

### Disk Space
- Regularly delete old recordings to free space
- Example: 1 hour HD = ~1.5GB typically
- Check `du -sh recordings/` to see total size

---

## Troubleshooting

### "Failed to start recording: Unknown error"
- Check that ffmpeg is installed: `ffmpeg -version`
- Verify stream URL is valid and accessible
- Check disk space in recordings directory

### Recording starts but stops immediately
- Stream may be offline or protected
- Check browser console for errors (F12)
- Try playing stream first to verify it works

### Can't see recordings in modal
- Try refreshing page (F5)
- Check that `recordings/` folder exists in project directory
- Look at server logs for errors

### Scheduled recording didn't start
- Keep browser/app open at scheduled time
- Check if channel was available at that time
- Verify system time is correct

---

## Performance Considerations

### Server Load
- Recording uses ffmpeg (CPU-intensive for transcoding)
- Current setup: stream copy (minimal CPU)
- One recording per stream doesn't stress typical systems

### Network
- Requires stable connection for entire recording duration
- Network interruptions will stop recording
- Recorded portion is still saved

### Storage
- Check available disk space before recording long streams
- `du -sh recordings/` to check directory size

---

## Advanced: Manual Recording

If UI is unavailable, manually record using ffmpeg:

```bash
# Start recording
ffmpeg -i "STREAM_URL" -c copy recordings/manual_rec.ts &

# Stop recording (from another terminal)
pkill -f "ffmpeg.*manual_rec"
```

---

## File Cleanup

To delete all recordings:
```bash
rm -rf recordings/
mkdir recordings/
```

To delete recordings older than 7 days:
```bash
find recordings/ -name "rec_*.ts" -mtime +7 -delete
```

---

## What's Next?

Check out other features:
- **Multiview**: Watch 4 channels simultaneously
- **Group Watching**: Sync playback with friends
- **EPG**: View program guide with channel info
- **Favorites**: Mark channels to watch later

For more info, see [RECORDING_FEATURES.md](RECORDING_FEATURES.md)
