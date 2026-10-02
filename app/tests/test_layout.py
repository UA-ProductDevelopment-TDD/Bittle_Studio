"""Checks for the repository layout, fixed asset URLs and the saved-motions pack folder."""
import json
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import engine
import packs
import server

BUTTON = {'name': 'Greet', 'color': 'blue', 'steps': [{'kind': 'command', 'command': 'khi', 'wait_ms': 1000}, {'kind': 'motion', 'motion_id': 'm1', 'wait_ms': 0}]}
SKILL = {'id': 'm1', 'name': 'Wave', 'type': 'behavior', 'signature': 'abc', 'skill': [-1, 0, 0, 1, 5, 200, -128]}
PACK = {'format': 'bittle-link-pack', 'version': 1, 'controls': [BUTTON], 'skills': [SKILL]}


class LayoutTest(unittest.TestCase):
    def test_folders(self):
        root = engine.PROJECT
        for name in ('app', 'robot-models', 'saved-motions', 'docs', 'scripts', 'README.md', 'setup.cmd', 'launch-studio.cmd', 'launch-bittle-link.cmd'):
            self.assertTrue((root / name).exists(), name)
        self.assertEqual(engine.ROOT, root / 'app')
        self.assertEqual(engine.DATA, root / 'user-data')
        self.assertTrue((engine.ASSETS / 'bittle' / 'bittle.urdf').is_file())
        self.assertTrue((engine.ROOT / 'node_modules' / 'three').is_dir(), 'run setup.cmd')

    def test_fixed_urls_map_to_new_folders(self):
        self.assertEqual(engine.url_path('/assets/bittle'), engine.ASSETS / 'bittle')
        self.assertEqual(engine.asset_url(engine.ASSETS / 'bittle' / 'bittle.urdf'), '/assets/bittle/bittle.urdf')
        self.assertEqual(engine.asset_url(engine.DATA / 'x' / 'mesh.obj'), '/data/x/mesh.obj')
        self.assertEqual(engine.asset_path('/assets/bittle/bittle.urdf'), engine.ASSETS / 'bittle' / 'bittle.urdf')
        for bad in ('/web/index.html', '/assets/../app/server.py', '/data/../app/server.py', '/etc/passwd'):
            with self.assertRaises(ValueError, msg=bad):
                engine.url_path(bad)


class HeadUpgradeTest(unittest.TestCase):
    def test_old_headless_projects_get_the_head(self):
        """Projects store URDF text; an unmodified copy of the pre-head model is swapped for the bundled one."""
        bundled = engine.ASSETS / 'bittle'
        current = (bundled / 'bittle.urdf').read_text(encoding='utf-8')
        headless = (Path(__file__).parent / 'fixtures' / 'bittle-headless.urdf').read_bytes().decode('utf-8')
        uncorrected = (Path(__file__).parent / 'fixtures' / 'bittle-head-uncorrected.urdf').read_bytes().decode('utf-8')
        # Projects saved on Windows hold the text with either line ending.
        for old in (headless, uncorrected):
            for variant in (old, old.replace('\r\n', '\n')):
                self.assertEqual(engine.upgrade_bundled_robot(variant, bundled), current)
        self.assertNotIn('neck-joint', headless)
        self.assertIn('neck-joint', current)
        # An edited model, or one from another folder, is never replaced.
        edited = headless.replace('left-front', 'lf')
        self.assertEqual(engine.upgrade_bundled_robot(edited, bundled), edited)
        self.assertEqual(engine.upgrade_bundled_robot(headless, engine.DATA), headless)
        edited = current.replace('neck-joint', 'my-neck')
        self.assertEqual(engine.upgrade_bundled_robot(edited, bundled), edited)
        self.assertEqual(engine.upgrade_bundled_robot('<robot name="x"/>', engine.DATA), '<robot name="x"/>')

    def test_mapping_merge_adds_neck(self):
        sim = server.sim
        merged = sim.merge_mapping({'left-front-shoulder-joint': {'servo': 8, 'sign': -1, 'offset': 3, 'verified': True}, 'gone': {}})
        self.assertEqual(merged['left-front-shoulder-joint']['sign'], -1)
        self.assertEqual(merged['neck-joint']['servo'], 0)
        self.assertNotIn('gone', merged)


class ServoSetupTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = TestClient(server.app)
        cls.c = cls.context.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.context.__exit__(None, None, None)

    def test_mapping_saves_without_export_and_errors_name_joints(self):
        c = self.c
        mapping = c.get('/api/model').json()['mapping']
        original = json.loads(json.dumps(mapping))
        try:
            mapping['left-front-shoulder-joint'].update(sign=-1, offset=4, verified=True)
            saved = c.post('/api/mapping', json={'mapping': {**mapping, 'unknown-joint': {}}})
            self.assertEqual(saved.status_code, 200, saved.text)
            self.assertNotIn('unknown-joint', saved.json()['mapping'])
            project = c.get('/api/project').json()['mapping']['left-front-shoulder-joint']
            self.assertEqual((project['sign'], project['offset'], project['verified']), (-1, 4, True))
            self.assertEqual(c.post('/api/mapping', json={'mapping': {**mapping, 'neck-joint': {'servo': 99, 'sign': 1}}}).status_code, 400)
            # Hardware actions list exactly which joints still need Servo setup.
            c.post('/api/frames', json={'frames': [{'time': 0, 'pose': {}}, {'time': 1, 'pose': {}}]})
            error = c.post('/api/motion-skill', json={'motion_type': 'behavior'}).json()['detail']
            self.assertIn('Servo setup', error)
            self.assertIn('neck (not verified)', error)
            self.assertNotIn('left front shoulder', error)
        finally:
            c.post('/api/mapping', json={'mapping': original})
            c.post('/api/frames', json={'frames': []})


class PackFolderTest(unittest.TestCase):
    def test_save_list_and_reject(self):
        with tempfile.TemporaryDirectory() as folder:
            saved = packs.save_pack(folder, 'My moves!', PACK)
            self.assertEqual((saved['file'], saved['controls'], saved['skills']), ('My-moves.json', 1, 1))
            stored = json.loads((Path(folder) / 'My-moves.json').read_text(encoding='utf-8'))
            self.assertEqual(stored['name'], 'My moves!')
            self.assertEqual(stored['skills'][0]['skill'], SKILL['skill'])
            (Path(folder) / 'other.json').write_text('{"not": "a pack"}', encoding='utf-8')
            (Path(folder) / 'broken.json').write_text('{', encoding='utf-8')
            self.assertEqual([p['file'] for p in packs.list_packs(folder)], ['My-moves.json'])
            for name in ('', '!!!', '../../evil'):
                if name == '../../evil':
                    self.assertEqual(packs.pack_filename(name), 'evil.json')
                    continue
                with self.assertRaises(ValueError):
                    packs.save_pack(folder, name, PACK)
            for filename in ('../x.json', 'x.txt', '..\\x.json', 'sub/x.json'):
                with self.assertRaises(ValueError, msg=filename):
                    packs.pack_path(folder, filename)
            for bad in ({**PACK, 'format': 'other'}, {**PACK, 'skills': [{**SKILL, 'skill': [999]}]},
                        {**PACK, 'controls': [{**BUTTON, 'color': 'pink'}]}, None):
                with self.assertRaises(ValueError):
                    packs.validate_pack(bad)


class SavedMotionsRoutesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = TestClient(server.app)
        cls.c = cls.context.__enter__()
        cls.original = server.SAVED_MOTIONS
        cls.folder = tempfile.TemporaryDirectory()
        server.SAVED_MOTIONS = Path(cls.folder.name)

    @classmethod
    def tearDownClass(cls):
        server.SAVED_MOTIONS = cls.original
        cls.folder.cleanup()
        cls.context.__exit__(None, None, None)

    def test_routes(self):
        c = self.c
        self.assertEqual(c.get('/saved-motions/index.json').json(), {'packs': []})
        saved = c.post('/saved-motions/save', json={'name': 'Team demo', 'pack': PACK})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()['file'], 'Team-demo.json')
        self.assertEqual(c.get('/saved-motions/index.json').json()['packs'][0]['name'], 'Team demo')
        self.assertEqual(c.get('/saved-motions/Team-demo.json').json()['controls'][0]['name'], 'Greet')
        self.assertEqual(c.get('/saved-motions/missing.json').status_code, 404)
        self.assertEqual(c.post('/saved-motions/save', json={'name': 'x', 'pack': {'format': 'nope'}}).status_code, 400)
        self.assertIn(c.get('/saved-motions/..%2Fapp%2Fserver.py').status_code, (400, 404))
        # Static front end and bundled model are still served at their old URLs.
        self.assertEqual(c.get('/').status_code, 200)
        self.assertEqual(c.get('/web/bittle-link/index.html').status_code, 200)
        self.assertEqual(c.get('/assets/bittle/bittle.urdf').status_code, 200)
        self.assertEqual(c.get('/vendor/build/three.module.js').status_code, 200)


if __name__ == '__main__':
    unittest.main()
