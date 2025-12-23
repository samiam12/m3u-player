# M3U Player - MPEG-TS Player

A modern, web-based M3U playlist player with full MPEG-TS support, EPG integration, and channel categorization - similar to TiviMate.

## Features

- ✅ **MPEG-TS Support**: Full support for MPEG-TS streams using HLS.js
- ✅ **M3U Playlist Parsing**: Supports M3U/M3U8 playlists from URLs or local files
- ✅ **EPG Integration**: XMLTV EPG support with automatic channel alignment
- ✅ **CORS Proxy**: Built-in server-side proxy to bypass CORS restrictions
- ✅ **Channel Categories**: Organize channels by category/group-title
- ✅ **Search & Filter**: Search channels and filter by category
- ✅ **Stream Validation**: Validates streams to avoid 404 errors
- ✅ **Keyboard Shortcuts**: Navigate channels with arrow keys, space for play/pause, F for fullscreen
- ✅ **Multiview (4x)**: Watch up to 4 channels at once (Multiview button)
- ✅ **Pick Multiview Audio**: Choose which multiview slot plays audio (🔇/🔊 per slot)
- ✅ **Fullscreen Layout**: Hide sidebars for a cleaner fullscreen/theater UI
- ✅ **Modern UI**: Clean, dark-themed interface similar to TiviMate
- ✅ **Error Handling**: Graceful error handling with automatic retry and recovery
- ✅ **Auto-Recovery**: Automatic stream recovery on network errors

## Usage

### Install as an “app” on Linux (Pop!_OS)
This installs:
- a **systemd user service** to keep the local server/proxy running in the background (no terminal needed)
- a **desktop launcher** (“M3U Player”) in your Applications menu

Run once:
```bash
cd /home/aliyahlover/m3u-player
bash linux/install.sh
```

After that:
- open **Activities → Applications → M3U Player**
- it will start the service (if needed) and open `http://localhost:8000`

Uninstall:
```bash
bash linux/uninstall.sh
```

### Running the Server (manual)
The included Python server automatically makes the player accessible on your network:

```bash
cd /home/aliyahlover/m3u-player
python3 server.py
```

The server will:
- Bind to all network interfaces (accessible from other devices)
- Display both localhost and network IP addresses
- Automatically detect your network IP (e.g., `10.0.0.91`)

**Access from iPad/other devices:**
- Open Safari or any browser on your iPad
- Navigate to: `http://10.0.0.91:8000` (replace with your server's IP)
- The player will work perfectly on tablets and mobile devices!

**Local access:**
- Open `http://localhost:8000` on your computer

### Option 2: Direct File Opening

You can also open `index.html` directly in your browser, but note that:
- Loading M3U/EPG files from URLs may fail due to CORS
- Local file uploads will work fine

## How to Use

1. **Load M3U Playlist**:
   - Enter an M3U playlist URL in the "M3U Playlist URL/File" field, OR
   - Click "Browse" to upload a local M3U file

2. **Load EPG (Optional)**:
   - Enter an EPG XML URL in the "EPG XML URL/File" field, OR
   - Click "Browse" to upload a local EPG XML file
   - EPG will automatically align with channels using tvg-id or channel name matching

3. **Browse Channels**:
   - Channels are displayed in the sidebar
   - Use the category filter to filter by channel group
   - Use the search box to find specific channels

4. **Play Channels**:
   - Click on any channel to start playback
   - The video player supports HLS/MPEG-TS streams
   - EPG information will appear below the player for the selected channel

## M3U Format Support

The player supports standard M3U format with these attributes:
- `tvg-id`: Channel ID for EPG matching
- `tvg-name`: Channel name
- `tvg-logo`: Channel logo URL
- `group-title`: Channel category/group

Example M3U entry:
```
#EXTINF:-1 tvg-id="channel1" tvg-name="Channel 1" tvg-logo="http://example.com/logo.png" group-title="News",Channel 1
http://example.com/stream.m3u8
```

## EPG Format Support

The player supports XMLTV format EPG files. EPG channels are matched with M3U channels using:
1. Exact `tvg-id` match (preferred)
2. Fuzzy channel name matching (fallback)

## Technical Details

- **Video Playback**: Uses HLS.js library for HLS/MPEG-TS stream playback
- **Stream Validation**: Performs HEAD requests and HLS playlist checks to validate streams
- **Browser Support**: Works in all modern browsers (Chrome, Firefox, Safari, Edge)
- **No Backend Required**: Pure client-side JavaScript, no server-side code needed

## Keyboard Shortcuts

- **↑ / ↓**: Navigate between channels
- **Space**: Play/Pause video
- **F**: Toggle fullscreen
- **Mouse**: Click channels to play

## Troubleshooting

### Streams not playing?
- The player now includes automatic retry and recovery
- Check browser console for detailed error messages
- Verify the stream URL is accessible
- Some streams may require CORS headers from the server
- Try different browsers (Safari has native HLS support)
- The server proxy helps with CORS issues

### EPG not aligning?
- Ensure your M3U has `tvg-id` attributes
- Check that EPG channel IDs match M3U `tvg-id` values
- The player will try fuzzy name matching as fallback
- The server proxy automatically handles CORS for EPG files

### CORS Errors?
- **The server now includes a built-in proxy!** Use `python3 server.py` to run the server
- The proxy automatically handles CORS for M3U and EPG files
- If direct fetch fails, the player will automatically use the server proxy
- Public CORS proxies are used as a fallback if server proxy is unavailable

## License

This project is provided as-is for personal use.

