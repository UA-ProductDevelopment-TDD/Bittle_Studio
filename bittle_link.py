"""Bittle Link: serve the standalone robot console without the simulator.

Uses only the Python standard library. Web Bluetooth and Web Serial need a secure context,
which the browser grants to http://127.0.0.1, so the console must be served rather than opened as a file.

    python bittle_link.py [--port 8770] [--no-browser]
"""
import argparse
import functools
import http.server
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent / 'web' / 'bittle-link'


class Handler(http.server.SimpleHTTPRequestHandler):
    # Windows' registry can map .js to text/plain, which browsers refuse for ES modules.
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, format, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description='Serve the standalone Bittle Link console.')
    parser.add_argument('--port', type=int, default=8770)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', args.port), functools.partial(Handler, directory=str(ROOT)))
    url = f'http://127.0.0.1:{args.port}/'
    print(f'Bittle Link console at {url}\nKeep this window open. Press Ctrl+C to stop.')
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
