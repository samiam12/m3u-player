#!/usr/bin/env python3
"""
Simple HTTP server for M3U Player
Run this script to serve the player locally and avoid CORS issues
"""

import http.server
import socketserver
import os
import webbrowser
import urllib.request
import urllib.parse
import json
import time
import string
import random
from pathlib import Path

PORT = 8002

# In-memory party and chat storage
PARTIES = {}  # {party_code: {"host": str, "members": [dict], "channel": str, "playing": bool, "timestamp": float}}
MESSAGES = {}  # {party_code: [{"username": str, "text": str, "timestamp": float}]}
MESSAGE_HISTORY_LIMIT = 100

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
        # Party endpoints
        if self.path.startswith('/party/update'):
            self.handle_party_update()
        elif self.path.startswith('/party/send-message'):
            self.handle_send_message()
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

