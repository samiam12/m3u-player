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
from pathlib import Path

# Use PORT from environment (Render) or default to 8002
PORT = int(os.environ.get('PORT', 8002))

print("[SERVER] Starting M3U Player Server")
print(f"[SERVER] Using Streamlink for recording")
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

    # ==================== RECORDING HANDLERS ====================

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
                        print(f"[RECORDING] Starting: {filename} from {channel}", flush=True)
                        # Use streamlink to record the stream
                        cmd = [
                            'streamlink',
                            '--hls-segment-timeout', '30',
                            '--retry-stream', '3',
                            '--http-header', 'User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            url,
                            'best',  # Best quality
                            '-o', str(filepath)
                        ]
                        
                        print(f"[RECORDING] streamlink command: {' '.join(cmd)}", flush=True)
                        print(f"[RECORDING] URL: {url}", flush=True)
                        
                        process = subprocess.Popen(
                            cmd,
                            stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE,
                            text=True
                        )
                        ACTIVE_RECORDINGS[filename] = {
                            'process': process,
                            'channel': channel,
                            'url': url,
                            'startTime': timestamp
                        }
                        
                        # Wait for process to complete and capture output
                        stdout_data, stderr_data = process.communicate()
                        print(f"[RECORDING] Process completed: {filename}", flush=True)
                        print(f"[RECORDING] Return code: {process.returncode}", flush=True)
                        if stderr_data:
                            print(f"[RECORDING] stderr ({len(stderr_data)} bytes):", flush=True)
                            print(stderr_data, flush=True)
                        
                        # Check if streamlink succeeded
                        if process.returncode != 0:
                            print(f"[RECORDING] streamlink failed with return code {process.returncode}", flush=True)

                        
                        # Store recording info
                        if filepath.exists():
                            size = filepath.stat().st_size
                            duration = int(time.time()) - timestamp
                            RECORDED_FILES[filename] = {
                                'channel': channel,
                                'size': size,
                                'duration': duration,
                                'timestamp': timestamp
                            }
                            print(f"[RECORDING] Complete: {filename} ({size} bytes, {duration}s)", flush=True)
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
            print(f"[RECORDING] Active recordings: {list(ACTIVE_RECORDINGS.keys())}")
            
            # Find and stop the active recording
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
                print(f"[RECORDING] No matching recording found to stop")
            
            response = json.dumps({'success': stopped})
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
                    if filename in RECORDED_FILES:
                        info = RECORDED_FILES[filename]
                    else:
                        # Get info from file
                        try:
                            size = filepath.stat().st_size
                            mtime = filepath.stat().st_mtime
                            duration = 0
                            info = {
                                'channel': 'Unknown',
                                'size': size,
                                'duration': duration,
                                'timestamp': int(mtime)
                            }
                        except:
                            continue
                    
                    recordings.append({
                        'filename': filename,
                        'channel': info.get('channel', 'Unknown'),
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

