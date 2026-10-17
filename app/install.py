"""Install Bittle Studio on Windows, macOS or Linux (called by the Setup launchers): create .venv, install the
Python packages and the 3D viewer library. Run again after getting a new version, it installs whatever changed.

The Setup launchers run this with their own Python from .tools (see app/setup-versions.txt); only the standard library
is used here. pybullet comes ready-made from this project's GitHub release (app/pybullet-wheels.json, built by
.github/workflows/pybullet-wheels.yml), so no C++ compiler is needed; where there is none, pip builds it.
The 3D viewer library (three.js) is downloaded straight from the npm registry and checked against
app/package-lock.json, so Node.js is not needed.
"""
import base64
import hashlib
import io
import json
import platform
import shutil
import ssl
import subprocess
import sys
import sysconfig
import tarfile
import urllib.error
import urllib.request
import venv
from pathlib import Path

APP = Path(__file__).resolve().parent
ROOT = APP.parent
VENV = ROOT / '.venv'
VENV_PYTHON = VENV / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
WHEELS = ROOT / '.tools' / 'wheels'
BUILD_HINT = {'win32': ' On Windows, install "Desktop development with C++" from https://visualstudio.microsoft.com/visual-cpp-build-tools/ and try again.',
              'darwin': ' On a Mac, run "xcode-select --install" once and try again.',
              'linux': ' On Linux, install your distribution\'s build-essential package and try again.'}


def step(text):
    print(f'\n=== {text} ===', flush=True)


def fail(text):
    print(f'\nSetup stopped: {text}', flush=True)
    sys.exit(1)


def pip(*args):
    return subprocess.call([str(VENV_PYTHON), '-m', 'pip', *args, '--disable-pip-version-check'])


def setup_python():
    """The Python version the Setup launchers install (app/setup-versions.txt)."""
    for line in (APP / 'setup-versions.txt').read_text(encoding='utf-8').splitlines():
        key, _, value = line.partition(' ')
        if key == 'python':
            return value.strip()


def platform_key():
    """win-amd64, macos-arm64, linux-x86_64, ...: the keys of app/pybullet-wheels.json."""
    if sys.platform == 'darwin':
        return 'macos-' + platform.machine()
    return sysconfig.get_platform()


def venv_matches():
    """True when .venv was made from the Python running this script, so an older one (another Python) is replaced."""
    try:
        config = (VENV / 'pyvenv.cfg').read_text(encoding='utf-8')
    except OSError:
        return False
    home = next((value.strip() for key, _, value in (line.partition('=') for line in config.splitlines()) if key.strip() == 'home'), '')
    return bool(home) and VENV_PYTHON.exists() and Path(home).resolve() == Path(sys._base_executable).parent.resolve()


def physics_wheel():
    """Download the ready-made pybullet for this computer into .tools/wheels; return it as a pip argument, or nothing."""
    info = json.loads((APP / 'pybullet-wheels.json').read_text(encoding='utf-8'))
    wheel = info['wheels'].get(platform_key())
    if not wheel or wheel['file'].split('-')[2] != f'cp{sys.version_info.major}{sys.version_info.minor}':
        print(f'\nNo ready-made physics package (pybullet) for this computer ({platform_key()}, Python {platform.python_version()}): '
              'pip will build it, which needs a C++ compiler.')
        return []
    step(f'Downloading the physics package (pybullet {info["version"]})')
    path = WHEELS / wheel['file']
    if not pip('download', '--no-deps', '--dest', str(WHEELS), info['url'] + wheel['file']) and path.exists():
        if hashlib.sha256(path.read_bytes()).hexdigest() == wheel['sha256']:
            return [str(path)]
        path.unlink()
        print('The downloaded physics package does not match app/pybullet-wheels.json.')
    print('Without the ready-made physics package, pip will build it, which needs a C++ compiler.')
    return []


def python_packages():
    python = setup_python()
    if not platform.python_version().startswith(python + '.'):
        print(f'Warning: this is Python {platform.python_version()}. Bittle Studio is tested with Python {python}, which the '
              'Setup launchers install; run Setup instead if the packages do not install.')
    if not venv_matches():
        if VENV.exists():
            step(f'Replacing the Python environment in {VENV.name} (it was made with another Python)')
            try:
                shutil.rmtree(VENV)
            except OSError:
                fail(f'the old {VENV.name} folder is in use. Close Bittle Studio and Bittle Link, then run Setup again.')
        else:
            step(f'Creating the Python environment in {VENV.name}')
        venv.create(VENV, with_pip=True)
    wheel = physics_wheel()
    step('Installing the Python packages (this can take a few minutes the first time)')
    if pip('install', '-r', str(APP / 'requirements.txt'), *wheel):
        fail('the Python packages could not be installed.' + ('' if wheel else BUILD_HINT.get(sys.platform, '')))


def download(url):
    try:
        with urllib.request.urlopen(url, timeout=120) as response:
            return response.read()
    except urllib.error.URLError as error:
        if not isinstance(error.reason, ssl.SSLCertVerificationError):
            raise
    # Setup's Python may not find this computer's certificates (some Macs and Linux systems): use the certifi
    # bundle that came with the Python packages instead.
    cafile = subprocess.check_output([str(VENV_PYTHON), '-c', 'import certifi; print(certifi.where())'], text=True).strip()
    with urllib.request.urlopen(url, timeout=120, context=ssl.create_default_context(cafile=cafile)) as response:
        return response.read()


def viewer_library():
    lock = json.loads((APP / 'package-lock.json').read_text(encoding='utf-8'))
    entry = lock['packages']['node_modules/three']
    target = APP / 'node_modules' / 'three'
    stamp = target / '.installed-version'
    if stamp.exists() and stamp.read_text().strip() == entry['version']:
        return
    step(f'Downloading the 3D viewer library (three.js {entry["version"]})')
    data = download(entry['resolved'])
    algorithm, expected = entry['integrity'].split('-', 1)
    if base64.b64encode(hashlib.new(algorithm, data).digest()).decode() != expected:
        fail('the downloaded 3D viewer library does not match package-lock.json. Try again later.')
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for member in archive.getmembers():
            # npm tarballs keep everything under package/; skip anything that would escape the target folder.
            name = Path(member.name)
            if name.parts[:1] != ('package',) or '..' in name.parts or not (member.isfile() or member.isdir()):
                continue
            destination = target.joinpath(*name.parts[1:])
            if member.isdir():
                destination.mkdir(parents=True, exist_ok=True)
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(archive.extractfile(member).read())
    stamp.write_text(entry['version'])


def main():
    python_packages()
    viewer_library()
    (ROOT / 'saved-motions').mkdir(exist_ok=True)
    step('Ready')
    print('Start Bittle Studio with the "Start Bittle Studio" launcher in the launchers folder for your system.')


if __name__ == '__main__':
    main()
