"""Checks for the Setup pins (app/setup-versions.txt, app/pybullet-wheels.json) and install.py's environment checks."""
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import install

APP = install.APP
LAUNCHERS = APP.parent / 'launchers'


def pins():
    lines = (APP / 'setup-versions.txt').read_text(encoding='utf-8').splitlines()
    return dict(line.split() for line in lines if line.strip() and not line.startswith('#'))


class SetupPinsTest(unittest.TestCase):
    def test_every_uv_download_has_a_checksum(self):
        found = pins()
        self.assertRegex(found['python'], r'^3\.\d+$')
        self.assertRegex(found['uv'], r'^\d+\.\d+\.\d+$')
        bootstrap = (APP / 'bootstrap.sh').read_text(encoding='utf-8')
        targets = re.findall(r'\) target=(\S+) ;;', bootstrap)
        self.assertEqual(len(targets), 4)
        archives = [f'uv-{target}.tar.gz' for target in targets] + ['uv-x86_64-pc-windows-msvc.zip']
        self.assertIn('%PIN_uv-x86_64-pc-windows-msvc.zip%', (LAUNCHERS / 'windows' / 'Setup.cmd').read_text(encoding='utf-8'))
        for archive in archives:
            self.assertRegex(found.get(archive, ''), r'^[0-9a-f]{64}$', archive)
        self.assertEqual(install.setup_python(), found['python'])

    def test_pybullet_wheels_match_the_requirements(self):
        info = json.loads((APP / 'pybullet-wheels.json').read_text(encoding='utf-8'))
        self.assertIn(f'pybullet=={info["version"]}', (APP / 'requirements.txt').read_text(encoding='utf-8').split())
        self.assertRegex(info['url'], rf'/releases/download/pybullet-{re.escape(info["version"])}-build\d+/$')
        python = 'cp' + pins()['python'].replace('.', '')
        for key, wheel in info['wheels'].items():
            self.assertRegex(key, r'^(win|macos|linux)-(amd64|arm64|x86_64|aarch64)$')
            name, version, tag = wheel['file'].split('-')[:3]
            self.assertEqual((name, version, tag), ('pybullet', info['version'], python), wheel['file'])
            self.assertRegex(wheel['sha256'], r'^[0-9a-f]{64}$')

    def test_platform_key(self):
        self.assertRegex(install.platform_key(), r'^(win|macos|linux)-')


class VenvTest(unittest.TestCase):
    def check(self, config):
        with tempfile.TemporaryDirectory() as folder:
            venv = Path(folder)
            python = venv / install.VENV_PYTHON.relative_to(install.VENV)
            python.parent.mkdir(parents=True)
            python.touch()
            if config is not None:
                (venv / 'pyvenv.cfg').write_text(config, encoding='utf-8')
            with mock.patch.object(install, 'VENV', venv), mock.patch.object(install, 'VENV_PYTHON', python):
                return install.venv_matches()

    def test_only_a_venv_from_this_python_is_kept(self):
        home = Path(sys._base_executable).parent
        self.assertTrue(self.check(f'home = {home}\ninclude-system-site-packages = false\n'))
        self.assertFalse(self.check(f'home = {home.parent / "another-python"}\n'))
        self.assertFalse(self.check('include-system-site-packages = false\n'))
        self.assertFalse(self.check(None))


if __name__ == '__main__':
    unittest.main()
