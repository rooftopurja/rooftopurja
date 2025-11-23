import http.server, socketserver

class UTF8Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Content-Type", "text/html; charset=utf-8")
        super().end_headers()

PORT = 4280
with socketserver.TCPServer(("", PORT), UTF8Handler) as httpd:
    print(f"🌐 Serving UTF-8 content on http://localhost:{PORT}")
    httpd.serve_forever()
