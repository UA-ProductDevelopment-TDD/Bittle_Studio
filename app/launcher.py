"""Start the local server, then open the workbench once it is ready."""
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

url = 'http://127.0.0.1:8765'


def ready():
    try:
        with urllib.request.urlopen(url + '/api/model', timeout=1) as response:
            return response.status == 200
    except OSError:
        return False


if ready():
    webbrowser.open(url)
    print('Bittle Studio is already running. Reusing the existing simulation.')
else:
    process = subprocess.Popen([sys.executable, 'server.py'], cwd=Path(__file__).parent)
    try:
        for _ in range(120):
            if process.poll() is not None:
                raise SystemExit('Server could not start; see the error above.')
            if ready():
                webbrowser.open(url)
                break
            time.sleep(.5)
        else:
            print('Still starting. Open ' + url + ' once the server is ready.')
        process.wait()
    except KeyboardInterrupt:
        process.terminate()
        process.wait()
