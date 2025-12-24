#!/usr/bin/env python3
"""
Simple HTTP server for M3U Player
Run this script to serve the player locally and avoid CORS issues
"""

import http.server
import socketserver
import os
import sys
import webbrowser
import urllib.request
import urllib.parse
import json
import time
import string
import random
import subprocess
import threading
import shutil
import requests
from pathlib import Path

# Use PORT from environment (Render) or default to 8002
PORT = int(os.environ.get('PORT', 8002))

print("[SERVER] Starting M3U Player Server")
print(f"[SERVER] Using direct HTTP streaming for recording")
print(f"[SERVER] PORT: {PORT}")

# In-memory party and chat storage
PARTIES = {}  # {party_code: {"host": str, "members": [dict], "channel": str, "playing": bool, "timestamp": float}}
MESSAGES = {}  # {party_code: [{"username": str, "text": str, "timestamp": float}]}
MESSAGE_HISTORY_LIMIT = 100

# Recording storage and state
RECORDINGS_DIR = Path('recordings')
RECORDINGS_DIR.mkdir(exist_ok=True)
ACTIVE_RECORDINGS = {}  # {filename: {"process": Process, "channel": str, "url": str, "startTime": timestamp}}
RECORDED_FILES = {}  # {filename: {"channel": str, "size": bytes, "duration": seconds, "timestamp": float}}

print(f"[SERVER] Recordings directory: {RECORDINGS_DIR.absolute()}")

def generate_party_code():
    """Generate a random 6-character party code"""
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

def get_party(code):
    """Get party by code, cleanup if expired (>1 hour)"""
    if code not in PARTIES:
        return None
    party = PARTIES[code]
    # Cleanup expired parties (older than 1 hour)
    if time.time() - party.get('timestamp', time.time()) > 3600:
        del PARTIES[code]
        MESSAGES.pop(code, None)
        return None
    return party

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        """Handle preflight CORS requests"""
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        """Handle GET requests with proxy support"""
        print(f"[SERVER] GET {self.path}")
        # Party endpoints
        if self.path.startswith('/party/create'):
            self.handle_party_create()
        elif self.path.startswith('/party/join'):
            self.handle_party_join()
        elif self.path.startswith('/party/state'):
            self.handle_party_state()
        elif self.path.startswith('/party/messages'):
            self.handle_party_messages()
        elif self.path.startswith('/party/leave'):
            self.handle_party_leave()
        # Recording endpoints
        elif self.path.startswith('/recording/list'):
            self.handle_recording_list()
        elif self.path.startswith('/recording/play'):
            self.handle_recording_play()
        # Debug logging endpoint
        elif self.path.startswith('/debug?'):
            self.handle_debug()
        # Proxy endpoint for CORS bypass
        elif self.path.startswith('/proxy?'):
            self.handle_proxy()
        # Stream transcoding endpoint for audio codec conversion
        elif self.path.startswith('/stream?'):
            self.handle_stream_transcode()
        else:
            # Regular file serving
            super().do_GET()

    def do_POST(self):
        """Handle POST requests"""
        print(f"[SERVER] POST {self.path}")
        # Party endpoints
        if self.path.startswith('/party/update'):
            self.handle_party_update()
        elif self.path.startswith('/party/send-message'):
            self.handle_send_message()
        # Recording endpoints
        elif self.path.startswith('/recording/start'):
            self.handle_recording_start()
        elif self.path.startswith('/recording/stop'):
            self.handle_recording_stop()
        elif self.path.startswith('/recording/delete'):
            self.handle_recording_delete()
        else:
            self.send_error(404)

    def handle_debug(self):
        """Handle debug log messages from client"""
        try:
            parsed_path = urllib.parse.urlparse(self.path)
            query_params = urllib.parse.parse_qs(parsed_path.query)
            message = query_params.get('msg', [''])[0]
            level = query_params.get('level', ['INFO'])[0]
            
            if message:
                print(f"[CLIENT-{level}] {message}")
            
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'OK')
        except Exception as e:
            print(f"[DEBUG] Error: {e}")
            self.send_error(500)

    def handle_party_create(self):
        """Create a new party session"""
        try:
            parsed_path = urllib.parse.urlparse(self.path)
            query_params = urllib.parse.parse_qs(parsed_path.query)
            username = query_params.get('username', ['Anonymous'])[0][:50]
            
            party_code = generate_party_code()
            PARTIES[party_code] = {
                'host': username,
                'members': [{'username': username, 'id': 'host', 'timestamp': time.time()}],
                'channel': '',
                'playing': False,
                'currentTime': 0,
                'timestamp': time.time()
            }
            MESSAGES[party_code] = []
            
            response = json.dumps({'success': True, 'party_code': party_code})
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response.encode())
            print(f"[PARTY] Created: {party_code} (host: {username})")
        except Exception as e:
            self.send_error(500, str(e))

    def handle_party_join(self):
        """Join an existing party"""
        try:
            parsed_path = urllib.parse.urlparse(self.path)
            query_params = urllib.parse.parse_qs(parsed_path.query)
            party_code = query_params.get('code', [''])[0].upper()
            username = query_params.get('username', ['Anonymous'])[0][:50]
            
            party = get_party(party_code)
            if not party:
                response = json.dumps({'success': False, 'error': 'Party not found'})
                status = 404
            else:
                # Add member to party
                member_id = f"member_{len(party['members'])}"
                party['members'].append({'username': username, 'id': member_id, 'timestamp': time.time()})
                party['timestamp'] = time.time()
                
                response = json.dumps({
                    'success': True,
                    'channel': party.get('channel', ''),
                    'playing': party.get('playing', False),
                    'currentTime': party.get('currentTime', 0),
                    'members': party['members']
                })
                status = 200
                print(f"[PARTY] Joined: {party_code} (user: {username})")
            
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response.encode())
        except Exception as e:
            self.send_error(500, str(e))

    def handle_party_state(self):
        """Get current party state"""
        try:
            parsed_path = urllib.parse.urlparse(self.path)
            query_params = urllib.parse.parse_qs(parsed_path.query)
            party_code = query_params.get('code', [''])[0].upper()
            
            party = get_party(party_code)
            if not party:
                response = json.dumps({'success': False, 'error': 'Party not found'})
                status = 404
            else:
                party['timestamp'] = time.time()  # Keep party alive
                response = json.dumps({
                    'success': True,
                    'host': party['host'],
                    'members': party['members'],
                    'channel': party.get('channel', ''),
                    'playing': party.get('playing', False),
                    'currentTime': party.get('currentTime', 0)
                })
                status = 200
            
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response.encode())
        except Exception as e:
            self.send_error(500, str(e))

    def handle_party_messages(self):
        """Get chat messages for party"""
        try:
            parsed_path = urllib.parse.urlparse(self.path)
            query_params = urllib.parse.parse_qs(parsed_path.query)
            party_code = query_params.get('code', [''])[0].upper()
            since = float(query_params.get('since', [0])[0])
            
            party = get_party(party_code)
            if not party:
                response = json.dumps({'success': False, 'error': 'Party not found'})
                status = 404
            else:
                party['timestamp'] = time.time()
                messages = MESSAGES.get(party_code, [])
                # Filter messages since timestamp
                recent_messages = [m for m in messages if m.get('timestamp', 0) > since]
                response = json.dumps({'success': True, 'messages': recent_messages})
                status = 200
            
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response.encode())
        except Exception as e:
            self.send_error(500, str(e))

    def handle_party_leave(self):
        """Leave a party (cleanup when all members leave)"""
        try:
            parsed_path = urllib.parse.urlparse(self.path)
            query_params = urllib.parse.parse_qs(parsed_path.query)
            party_code = query_params.get('code', [''])[0].upper()
            
            if party_code in PARTIES:
                # Just update timestamp to keep party alive but mark as stale
                PARTIES[party_code]['timestamp'] = time.time()
            
            response = json.dumps({'success': True})
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response.encode())
        except Exception as e:
            self.send_error(500, str(e))

    def handle_party_update(self):
        """Update party state (host changes channel/play/pause)"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            data = json.loads(body)
            
            party_code = data.get('code', '').upper()
            party = get_party(party_code)
            
            if not party:
                response = json.dumps({'success': False, 'error': 'Party not found'})
                status = 404
            else:
                # Update party state
                if 'channel' in data:
                    party['channel'] = data['channel']
                if 'playing' in data:
                    party['playing'] = data['playing']
                if 'currentTime' in data:
                    party['currentTime'] = data['currentTime']
                party['timestamp'] = time.time()
                
                response = json.dumps({'success': True})
                status = 200
                print(f"[PARTY] Updated: {party_code} - channel: {party.get('channel', '')}, time: {party.get('currentTime', 0):.1f}s, playing: {party.get('playing')}")
            
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response.encode())
        except Exception as e:
            self.send_error(500, str(e))

    def handle_send_message(self):
        """Add message to party chat"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            data = json.loads(body)
            
            party_code = data.get('code', '').upper()
            party = get_party(party_code)
            
            if not party:
                response = json.dumps({'success': False, 'error': 'Party not found'})
                status = 404
            else:
                username = data.get('username', 'Anonymous')[:50]
                text = data.get('text', '')[:500]
                
                if text.strip():
                    message = {
                        'username': username,
                        'text': text,
                        'timestamp': time.time()
                    }
                    if party_code not in MESSAGES:
                        MESSAGES[party_code] = []
                    MESSAGES[party_code].append(message)
                    
                    # Keep only last N messages
                    if len(MESSAGES[party_code]) > MESSAGE_HISTORY_LIMIT:
                        MESSAGES[party_code] = MESSAGES[party_code][-MESSAGE_HISTORY_LIMIT:]
                    
                    party['timestamp'] = time.time()
                    response = json.dumps({'success': True})
                    status = 200
                else:
                    response = json.dumps({'success': False, 'error': 'Empty message'})
                    status = 400
            
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response.encode())
        except Exception as e:
            self.send_error(500, str(e))

    def handle_proxy(self):
        """Proxy requests to bypass CORS"""
        try:
            # Parse query parameters
            parsed_path = urllib.parse.urlparse(self.path)
            query_params = urllib.parse.parse_qs(parsed_path.query)
            target_url = query_params.get('url', [None])[0]
            
            if not target_url:
                self.send_error(400, "Missing 'url' parameter")
                return
            
            # Decode URL
            target_url = urllib.parse.unquote(target_url)
            
            print(f"[PROXY] Fetching: {target_url[:100]}...")
            
            # Fetch the target URL
            req = urllib.request.Request(target_url)
            req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
            req.add_header('Accept', '*/*')
            
            try:
                with urllib.request.urlopen(req, timeout=60) as response:
                    content = response.read()
                    content_type = response.headers.get('Content-Type', 'text/plain')
                    
                    # If no content type, try to detect from URL
                    if content_type == 'text/plain':
                        if target_url.endswith('.xml') or 'xmltv' in target_url.lower():
                            content_type = 'application/xml'
                        elif target_url.endswith('.m3u') or target_url.endswith('.m3u8'):
                            content_type = 'application/vnd.apple.mpegurl'
                    
                    print(f"[PROXY] Success: {len(content)} bytes, type: {content_type}")
                    
                    # Send response
                    self.send_response(200)
                    self.send_header('Content-Type', content_type)
                    self.send_header('Content-Length', str(len(content)))
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                    self.send_header('Access-Control-Allow-Headers', 'Content-Type')
                    self.end_headers()
                    self.wfile.write(content)
            except urllib.error.HTTPError as e:
                error_body = e.read().decode('utf-8', errors='ignore')[:200]
                print(f"[PROXY] HTTP Error {e.code}: {e.reason}")
                self.send_error(e.code, f"Proxy HTTP error: {e.reason}")
            except urllib.error.URLError as e:
                print(f"[PROXY] URL Error: {str(e)}")
                self.send_error(502, f"Proxy connection error: {str(e)}")
                
        except Exception as e:
            print(f"[PROXY] Exception: {str(e)}")
            import traceback
            traceback.print_exc()
            self.send_error(500, f"Proxy error: {str(e)}")

    def handle_stream_transcode(self):
        """Stream with audio codec transcoding (E-AC-3 → AAC) + HEVC detection
        
        Architecture:
        - Input: MPEG-TS stream (may have E-AC-3, broken timestamps, etc)
        - Probe: Detect video codec (H.264 vs HEVC)
        - FFmpeg: Transcode audio E-AC-3 → AAC, handle video based on codec
        - Output: MPEG-TS with AAC audio (Chrome-safe, mpegts.js compatible)
        
        Video codec handling:
        - H.264: Copy video as-is (fast, no quality loss)
        - HEVC: Auto-transcode to H.264 (libx264 veryfast preset)
        
        Audio: Always transcode to AAC (browser requirement)
        
        Key flags for IPTV stability:
        - genpts+igndts: Generate missing PTS, ignore broken DTS
        - reconnect: Auto-reconnect on timeout
        - ac 2: Force stereo audio
        
        Error responses:
        - 415: Unsupported codec (only if codec detection fails)
        - 502: FFmpeg crash or transcode error
        - 503: FFmpeg unavailable on server
        """
        try:
            # Parse query parameters
            parsed_path = urllib.parse.urlparse(self.path)
            query_params = urllib.parse.parse_qs(parsed_path.query)
            target_url = query_params.get('url', [None])[0]
            
            if not target_url:
                self.send_error(400, "Missing 'url' parameter")
                return
            
            # Decode URL
            target_url = urllib.parse.unquote(target_url)
            
            print(f"[TRANSCODE] Request for: {target_url[:80]}...", flush=True)
            
            # Check if ffmpeg/ffprobe are available
            ffmpeg_available = False
            ffprobe_available = False
            try:
                result = subprocess.run(['ffmpeg', '-version'], capture_output=True, timeout=5)
                ffmpeg_available = result.returncode == 0
                result = subprocess.run(['ffprobe', '-version'], capture_output=True, timeout=5)
                ffprobe_available = result.returncode == 0
                print(f"[TRANSCODE] ffmpeg: {ffmpeg_available}, ffprobe: {ffprobe_available}", flush=True)
            except Exception as e:
                print(f"[TRANSCODE] Tool check failed: {e}", flush=True)
            
            # If ffmpeg not available, fall back to direct proxy
            if not ffmpeg_available:
                print("[TRANSCODE] ffmpeg unavailable, using direct proxy stream", flush=True)
                return self.handle_proxy_stream(target_url)
            
            # Detect video codec using ffprobe (if available)
            video_codec = 'h264'  # Default assumption
            needs_video_transcode = False
            
            if ffprobe_available:
                try:
                    print("[TRANSCODE] Probing stream codec...", flush=True)
                    probe_cmd = [
                        'ffprobe',
                        '-v', 'error',
                        '-select_streams', 'v:0',
                        '-show_entries', 'stream=codec_name',
                        '-of', 'json',
                        '-timeout', '10',  # 10s timeout to avoid stalls on dead feeds
                        target_url
                    ]
                    result = subprocess.run(probe_cmd, capture_output=True, timeout=15, text=True)
                    
                    if result.returncode == 0:
                        try:
                            probe_data = json.loads(result.stdout)
                            if probe_data.get('streams') and len(probe_data['streams']) > 0:
                                video_codec = probe_data['streams'][0].get('codec_name', 'h264').lower()
                                print(f"[TRANSCODE] Detected codec: {video_codec}", flush=True)
                                needs_video_transcode = video_codec == 'hevc'
                        except json.JSONDecodeError:
                            print("[TRANSCODE] Failed to parse probe output, assuming H.264", flush=True)
                    else:
                        print(f"[TRANSCODE] Probe failed: {result.stderr[:200]}, assuming H.264", flush=True)
                        
                except subprocess.TimeoutExpired:
                    print("[TRANSCODE] Probe timeout, assuming H.264", flush=True)
                except Exception as e:
                    print(f"[TRANSCODE] Probe error: {e}, assuming H.264", flush=True)
            
            # Build ffmpeg command based on detected codec
            video_codec_opt = '-c:v'
            video_codec_arg = 'copy'
            
            if needs_video_transcode:
                print("[TRANSCODE] HEVC detected → re-encoding video (libx264, veryfast)", flush=True)
                video_codec_arg = 'libx264'
                # Additional options for H.264 encoding
                ffmpeg_cmd = [
                    'ffmpeg',
                    '-reconnect', '1',
                    '-reconnect_streamed', '1',
                    '-reconnect_delay_max', '2',
                    '-fflags', '+genpts+igndts',
                    '-flags', 'low_delay',
                    '-hide_banner',
                    '-loglevel', 'error',
                    '-i', target_url,
                    '-c:v', 'libx264',                # Transcode video to H.264
                    '-preset', 'veryfast',            # Balance speed vs quality
                    '-tune', 'zerolatency',           # Optimize for low latency
                    '-c:a', 'aac',
                    '-b:a', '128k',
                    '-ac', '2',
                    '-f', 'mpegts',
                    '-'
                ]
            else:
                # H.264: copy video, only transcode audio
                ffmpeg_cmd = [
                    'ffmpeg',
                    '-reconnect', '1',
                    '-reconnect_streamed', '1',
                    '-reconnect_delay_max', '2',
                    '-fflags', '+genpts+igndts',
                    '-flags', 'low_delay',
                    '-hide_banner',
                    '-loglevel', 'error',
                    '-i', target_url,
                    '-c:v', 'copy',                   # Copy video (no transcode)
                    '-c:a', 'aac',                    # Transcode audio to AAC
                    '-b:a', '128k',
                    '-ac', '2',
                    '-f', 'mpegts',
                    '-'
                ]
            
            print(f"[TRANSCODE] Starting ffmpeg...", flush=True)
            
            try:
                # Start ffmpeg process
                process = subprocess.Popen(
                    ffmpeg_cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    bufsize=65536
                )
                
                print("[TRANSCODE] ffmpeg process started, streaming to client...", flush=True)
                
                # Send HTTP response headers for MPEG-TS
                self.send_response(200)
                self.send_header('Content-Type', 'video/mp2t')  # MPEG-TS MIME type
                self.send_header('Transfer-Encoding', 'chunked')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Cache-Control', 'no-cache, no-store')
                self.end_headers()
                
                # Stream chunks from ffmpeg to client
                chunk_size = 8192
                bytes_sent = 0
                first_chunk = True
                
                while True:
                    chunk = process.stdout.read(chunk_size)
                    if not chunk:
                        break
                    
                    if first_chunk:
                        print(f"[TRANSCODE] First chunk received ({len(chunk)} bytes)", flush=True)
                        first_chunk = False
                    
                    try:
                        self.wfile.write(chunk)
                        bytes_sent += len(chunk)
                    except BrokenPipeError:
                        print(f"[TRANSCODE] Client disconnected after {bytes_sent} bytes", flush=True)
                        break
                
                # Clean up process
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    print("[TRANSCODE] ffmpeg timeout, killing process", flush=True)
                    process.kill()
                
                print(f"[TRANSCODE] Stream complete, sent {bytes_sent} bytes", flush=True)
                
            except BrokenPipeError:
                print(f"[TRANSCODE] Client disconnected after {bytes_sent} bytes", flush=True)
                
            except Exception as e:
                error_msg = str(e)
                print(f"[TRANSCODE] ffmpeg error: {error_msg}", flush=True)
                import traceback
                traceback.print_exc()
                
                try:
                    process.kill()
                except:
                    pass
                
                # Return proper error response
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                
                error_response = json.dumps({
                    'error': 'transcode_failed',
                    'details': 'FFmpeg processing failed',
                    'message': error_msg[:200]
                })
                self.wfile.write(error_response.encode())
                
        except Exception as e:
            print(f"[TRANSCODE] Handler error: {str(e)}", flush=True)
            import traceback
            traceback.print_exc()
            
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            error_response = json.dumps({
                'error': 'server_error',
                'details': 'Internal server error',
                'message': str(e)[:200]
            })
            self.wfile.write(error_response.encode())

    def handle_proxy_stream(self, target_url):
        """Fallback: proxy stream directly without transcoding"""
        try:
            print(f"[PROXY_STREAM] Direct stream: {target_url[:80]}...")
            
            req = urllib.request.Request(target_url)
            req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
            req.add_header('Accept', '*/*')
            
            with urllib.request.urlopen(req, timeout=60) as response:
                # Send response headers
                self.send_response(200)
                self.send_header('Content-Type', response.headers.get('Content-Type', 'video/mp2t'))
                self.send_header('Transfer-Encoding', 'chunked')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                
                # Stream chunks
                chunk_size = 65536
                bytes_sent = 0
                while True:
                    chunk = response.read(chunk_size)
                    if not chunk:
                        break
                    
                    try:
                        self.wfile.write(chunk)
                        bytes_sent += len(chunk)
                    except BrokenPipeError:
                        print(f"[PROXY_STREAM] Client disconnected after {bytes_sent} bytes")
                        break
                
                print(f"[PROXY_STREAM] Stream complete, sent {bytes_sent} bytes")
                
        except Exception as e:
            print(f"[PROXY_STREAM] Error: {str(e)}")
            self.send_error(502, f"Stream error: {str(e)}")

    # ==================== PROXY HANDLER ====================

    def handle_recording_start(self):
        """Start recording a stream"""
        print("[RECORDING_START] Handler called", flush=True)
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode())
            
            print(f"[RECORDING_START] Data received: channel={data.get('channel')}, url={data.get('url')}", flush=True)
            
            channel = data.get('channel', 'Unknown')
            url = data.get('url', '')
            
            if not url:
                response = json.dumps({'success': False, 'error': 'No URL provided'})
                self.send_response(400)
            else:
                # Create filename from channel and timestamp
                timestamp = int(time.time())
                safe_channel = channel.replace('/', '_').replace('\\', '_')[:30]
                filename = f"rec_{timestamp}_{safe_channel}.ts"
                filepath = RECORDINGS_DIR / filename
                
                # Start recording in background thread
                def record_stream():
                    try:
                        # Record the actual start time when the thread begins
                        actual_start_time = int(time.time())
                        
                        print(f"[RECORDING] Starting: {filename} from {channel}", flush=True)
                        print(f"[RECORDING] Actual start timestamp: {actual_start_time}", flush=True)
                        print(f"[RECORDING] URL: {url}", flush=True)
                        
                        # Use requests to download the stream directly
                        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
                        
                        try:
                            response = requests.get(url, headers=headers, stream=True, timeout=30)
                            response.raise_for_status()
                            
                            print(f"[RECORDING] Connected to stream, status: {response.status_code}", flush=True)
                            print(f"[RECORDING] Content-Type: {response.headers.get('content-type', 'unknown')}", flush=True)
                            
                            # Write stream to file
                            bytes_written = 0
                            chunk_size = 8192
                            max_duration = 36000  # 10 hours
                            start_time = time.time()
                            last_data_time = time.time()  # Track when data last arrived
                            no_data_timeout = 2  # Stop recording if no data for 2 seconds
                            
                            with open(filepath, 'wb') as f:
                                for chunk in response.iter_content(chunk_size=chunk_size):
                                    if chunk:
                                        f.write(chunk)
                                        bytes_written += len(chunk)
                                        last_data_time = time.time()  # Update on each chunk
                                    else:
                                        # No data - check if stream ended
                                        if time.time() - last_data_time > no_data_timeout:
                                            print(f"[RECORDING] No data for {no_data_timeout}s, assuming stream ended", flush=True)
                                            break
                                    
                                    # Check duration limit
                                    elapsed = time.time() - start_time
                                    if elapsed >= max_duration:
                                        print(f"[RECORDING] Max duration reached ({elapsed}s)", flush=True)
                                        break
                            
                            print(f"[RECORDING] Download complete: {bytes_written} bytes", flush=True)
                            
                        except requests.Timeout:
                            print(f"[RECORDING] Request timeout while connecting to stream", flush=True)
                        except requests.RequestException as e:
                            print(f"[RECORDING] Request error: {str(e)}", flush=True)

                        
                        # Store recording info - calculate duration from actual recording time
                        if filepath.exists():
                            size = filepath.stat().st_size
                            # Use the actual elapsed time from when we started recording
                            # This reflects the real duration of the recording period
                            actual_end_time = int(time.time())
                            duration = max(1, actual_end_time - actual_start_time)  # At least 1 second
                            RECORDED_FILES[filename] = {
                                'channel': channel,
                                'size': size,
                                'duration': duration,
                                'timestamp': actual_start_time
                            }
                            print(f"[RECORDING] Complete: {filename} ({size} bytes, {duration}s elapsed)", flush=True)
                        else:
                            print(f"[RECORDING] File not created: {filepath}", flush=True)

                        
                        # Cleanup
                        if filename in ACTIVE_RECORDINGS:
                            del ACTIVE_RECORDINGS[filename]
                    except Exception as e:
                        print(f"[RECORDING] Error: {filename} - {str(e)}", flush=True)
                        import traceback
                        traceback.print_exc()
                        if filename in ACTIVE_RECORDINGS:
                            del ACTIVE_RECORDINGS[filename]
                        if filename in ACTIVE_RECORDINGS:
                            del ACTIVE_RECORDINGS[filename]
                
                thread = threading.Thread(target=record_stream, daemon=True)
                thread.start()
                
                response = json.dumps({
                    'success': True,
                    'recordingId': filename,
                    'channel': channel
                })
                self.send_response(200)
            
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response.encode())
        except Exception as e:
            print(f"[RECORDING] Start error: {str(e)}")
            self.send_error(500, str(e))

    def handle_recording_stop(self):
        """Stop recording"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode())
            
            print(f"[RECORDING] Stop request for channel: {data.get('channel')}")
            print(f"[RECORDING] Client-reported duration: {data.get('duration')}s")
            print(f"[RECORDING] Active recordings: {list(ACTIVE_RECORDINGS.keys())}")
            
            # Find the active recording and update its duration from client
            client_duration = data.get('duration', 0)
            
            # Update RECORDED_FILES with client's more accurate duration measurement
            for filename, rec_info in list(RECORDED_FILES.items()):
                if rec_info.get('channel') == data.get('channel'):
                    if client_duration > 0:
                        rec_info['duration'] = client_duration
                        print(f"[RECORDING] Updated duration for {filename}: {client_duration}s (from client)")
                    break
            
            # Try to stop any active recording process
            stopped = False
            for filename, rec_info in list(ACTIVE_RECORDINGS.items()):
                if rec_info.get('channel') == data.get('channel'):
                    try:
                        print(f"[RECORDING] Terminating process for: {filename}")
                        process = rec_info['process']
                        
                        # Try graceful shutdown first with SIGTERM
                        process.terminate()
                        try:
                            process.wait(timeout=3)  # Wait 3 seconds for graceful shutdown
                            print(f"[RECORDING] Process terminated gracefully")
                        except subprocess.TimeoutExpired:
                            # If it doesn't shut down gracefully, kill it
                            print(f"[RECORDING] Process didn't terminate, killing...")
                            process.kill()
                            process.wait()
                        
                        # Give it a moment for file system to sync
                        time.sleep(0.5)

                        stopped = True
                        print(f"[RECORDING] Stopped: {filename}")
                        break
                    except Exception as e:
                        print(f"[RECORDING] Error stopping {filename}: {e}")
                        rec_info['process'].kill()
                        stopped = True
            
            if not stopped:
                print(f"[RECORDING] No matching recording found to stop (but duration updated)")
            
            response = json.dumps({'success': True})
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response.encode())
        except Exception as e:
            print(f"[RECORDING] Stop error: {str(e)}")
            self.send_error(500, str(e))

    def handle_recording_list(self):
        """List all recordings"""
        try:
            # Scan recordings directory for files
            recordings = []
            print(f"[RECORDING] Scanning directory: {RECORDINGS_DIR}")
            if RECORDINGS_DIR.exists():
                all_files = list(RECORDINGS_DIR.glob('rec_*.ts'))
                print(f"[RECORDING] Found {len(all_files)} recording files")
                for filepath in all_files:
                    filename = filepath.name
                    print(f"[RECORDING] Processing file: {filename}")
                    
                    # Extract channel from filename (format: rec_TIMESTAMP_CHANNEL.ts)
                    try:
                        parts = filename.replace('.ts', '').split('_', 2)  # Split into rec, timestamp, channel
                        channel_from_file = parts[2] if len(parts) > 2 else 'Unknown'
                    except:
                        channel_from_file = 'Unknown'
                    
                    if filename in RECORDED_FILES:
                        info = RECORDED_FILES[filename]
                    else:
                        # Get info from file
                        try:
                            size = filepath.stat().st_size
                            mtime = filepath.stat().st_mtime
                            
                            # Try to get timestamp from filename for better accuracy
                            try:
                                timestamp = int(parts[1])
                            except:
                                timestamp = int(mtime)
                            
                            # Estimate duration: current time - file start time
                            duration = max(0, int(time.time()) - timestamp)
                            
                            info = {
                                'channel': channel_from_file,
                                'size': size,
                                'duration': duration,
                                'timestamp': timestamp
                            }
                        except:
                            continue
                    
                    recordings.append({
                        'filename': filename,
                        'channel': info.get('channel', channel_from_file),
                        'size': info.get('size', 0),
                        'duration': info.get('duration', 0),
                        'timestamp': info.get('timestamp', 0)
                    })
            else:
                print(f"[RECORDING] Directory does not exist: {RECORDINGS_DIR}")
            
            # Sort by timestamp descending (newest first)
            recordings.sort(key=lambda x: x['timestamp'], reverse=True)
            print(f"[RECORDING] Returning {len(recordings)} recordings")
            
            response = json.dumps({'recordings': recordings})
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response.encode())
        except Exception as e:
            print(f"[RECORDING] List error: {str(e)}")
            import traceback
            traceback.print_exc()
            self.send_error(500, str(e))

    def handle_recording_delete(self):
        """Delete a recording"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode())
            
            filename = data.get('filename', '')
            
            # Security: only allow rec_*.ts files
            if not filename.startswith('rec_') or not filename.endswith('.ts'):
                response = json.dumps({'success': False, 'error': 'Invalid filename'})
                self.send_response(400)
            else:
                filepath = RECORDINGS_DIR / filename
                try:
                    if filepath.exists():
                        filepath.unlink()
                        RECORDED_FILES.pop(filename, None)
                        print(f"[RECORDING] Deleted: {filename}")
                        response = json.dumps({'success': True})
                    else:
                        response = json.dumps({'success': False, 'error': 'File not found'})
                except Exception as e:
                    response = json.dumps({'success': False, 'error': str(e)})
                
                self.send_response(200)
            
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response.encode())
        except Exception as e:
            print(f"[RECORDING] Delete error: {str(e)}")
            self.send_error(500, str(e))

    def handle_recording_play(self):
        """Play a recording"""
        try:
            parsed_path = urllib.parse.urlparse(self.path)
            query_params = urllib.parse.parse_qs(parsed_path.query)
            filename = query_params.get('file', [None])[0]
            
            if not filename or not filename.startswith('rec_') or not filename.endswith('.ts'):
                self.send_error(400, 'Invalid filename')
                return
            
            filepath = RECORDINGS_DIR / filename
            
            if not filepath.exists():
                self.send_error(404, 'Recording not found')
                return
            
            # Serve the file with streaming support
            try:
                file_size = filepath.stat().st_size
                
                # Handle range requests for seeking
                range_header = self.headers.get('Range')
                if range_header:
                    try:
                        range_value = range_header.replace('bytes=', '')
                        if '-' in range_value:
                            start, end = range_value.split('-')
                            start = int(start) if start else 0
                            end = int(end) if end else file_size - 1
                        else:
                            start = int(range_value)
                            end = file_size - 1
                        
                        content_length = end - start + 1
                        
                        self.send_response(206)  # Partial Content
                        self.send_header('Content-Type', 'video/mp2t')
                        self.send_header('Content-Length', str(content_length))
                        self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
                        self.end_headers()
                        
                        with open(filepath, 'rb') as f:
                            f.seek(start)
                            self.wfile.write(f.read(content_length))
                    except:
                        # Fallback to full file
                        self.send_response(200)
                        self.send_header('Content-Type', 'video/mp2t')
                        self.send_header('Content-Length', str(file_size))
                        self.end_headers()
                        
                        with open(filepath, 'rb') as f:
                            self.wfile.write(f.read())
                else:
                    self.send_response(200)
                    self.send_header('Content-Type', 'video/mp2t')
                    self.send_header('Content-Length', str(file_size))
                    self.end_headers()
                    
                    with open(filepath, 'rb') as f:
                        # Stream in chunks
                        chunk_size = 1024 * 256  # 256KB chunks
                        while True:
                            chunk = f.read(chunk_size)
                            if not chunk:
                                break
                            self.wfile.write(chunk)
            except Exception as e:
                print(f"[RECORDING] Play error: {str(e)}")
                self.send_error(500, str(e))
        except Exception as e:
            print(f"[RECORDING] Play handler error: {str(e)}")
            self.send_error(500, str(e))

    def end_headers(self):
        # Add CORS headers to allow cross-origin requests
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def log_message(self, format, *args):
        # Custom log format
        print(f"[{self.log_date_time_string()}] {format % args}")

def get_local_ip():
    """Get the local IP address"""
    import socket
    try:
        # Connect to a remote address to determine local IP
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "127.0.0.1"

def main():
    # Change to script directory
    os.chdir(Path(__file__).parent)
    
    Handler = MyHTTPRequestHandler
    
    # Bind to all interfaces (0.0.0.0) to allow network access
    with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
        local_ip = get_local_ip()
        local_url = f"http://localhost:{PORT}"
        network_url = f"http://{local_ip}:{PORT}"
        
        print(f"\n{'='*60}")
        print(f"M3U Player Server")
        print(f"{'='*60}")
        print(f"Server running on all interfaces (0.0.0.0)")
        print(f"Local access:    {local_url}")
        print(f"Network access:  {network_url}")
        print(f"")
        print(f"Access from iPad/other devices:")
        print(f"  http://{local_ip}:{PORT}")
        print(f"")
        print(f"Press Ctrl+C to stop the server")
        print(f"{'='*60}\n")
        
        # Try to open browser automatically (skip when running as a background service)
        if os.environ.get('M3U_PLAYER_NO_BROWSER', '').strip() not in ('1', 'true', 'yes'):
            try:
                webbrowser.open(local_url)
            except:
                pass
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\nServer stopped.")
            httpd.shutdown()

if __name__ == "__main__":
    main()

