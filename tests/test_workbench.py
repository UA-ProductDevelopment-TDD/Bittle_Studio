"""Integration checks for physical motion, file handling and export safeguards."""
import ast
import io
import math
import unittest
import zipfile

import pybullet as p
from fastapi.testclient import TestClient

import server


class WorkbenchTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = TestClient(server.app)
        cls.client = cls.context.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.context.__exit__(None, None, None)

    def test_complete_experiment(self):
        c = self.client
        model = c.get('/api/model').json()
        self.assertEqual(len(model['joints']), 8)
        self.assertGreater(len(model['visuals']), 8)
        self.assertTrue(any('not physically valid' in w for w in model['warnings']))
        initial = c.get('/api/project').json()
        s = server.sim
        with s.lock:
            s.running = True
            for _ in range(480):
                s.tick()
            s.running = False
            fallen = s.state()
        self.assertLess(fallen['height'], .18)
        self.assertGreater(fallen['height'], -.02)
        self.assertGreater(fallen['contacts'], 0)
        self.assertTrue(all(math.isfinite(v) for v in fallen['angles'].values()))
        c.post('/api/command', json={'action': 'reset'})
        first = model['joints'][0]
        c.post('/api/command', json={'action': 'pose', 'pose': {first['name']: 999}})
        self.assertAlmostEqual(c.get('/api/state').json()['targets'][first['name']], first['upper'])
        zero = {j['name']: 0 for j in model['joints']}
        pose = {**zero, first['name']: 30}
        frames = [{'time': 0, 'pose': zero}, {'time': 2, 'pose': pose, 'easing': 'smooth'}]
        self.assertEqual(c.post('/api/frames', json={'frames': frames}).status_code, 200)
        c.post('/api/command', json={'action': 'seek', 'time': 1})
        self.assertAlmostEqual(c.get('/api/state').json()['targets'][first['name']], 15)
        obj = c.post('/api/objects', json={'type': 'box', 'position': [.3, 0, .1], 'size': [.1, .1, .1], 'mass': .1}).json()
        self.assertIn('id', obj)
        project = c.get('/api/project').json()
        self.assertEqual(c.post('/api/project', json=project).status_code, 200)
        restored = c.get('/api/project').json()
        self.assertEqual(project['frames'], restored['frames'])
        self.assertEqual(project['objects'], restored['objects'])
        self.assertEqual(project['targets'], restored['targets'])
        bad_mapping = c.post('/api/export', json={'mapping': model['mapping']})
        self.assertEqual(bad_mapping.status_code, 400)
        mapping = model['mapping']
        for m in mapping.values():
            m['verified'] = True
        result = c.post('/api/export', json={'mapping': mapping, 'speed': .5})
        self.assertEqual(result.status_code, 200)
        ast.parse(result.text)
        self.assertIn('--execute', result.text)
        self.assertIn("rotateJoints('I'", result.text)
        export_file = server.ROOT / 'test-results/exported_motion.py'
        export_file.parent.mkdir(exist_ok=True)
        export_file.write_text(result.text)
        mapping[first['name']]['offset'] = 999
        self.assertEqual(c.post('/api/export', json={'mapping': mapping}).status_code, 400)
        self.assertEqual(c.post('/api/project', json=initial).status_code, 200)

    def test_import_and_rejection(self):
        c = self.client
        result = c.post('/api/import', files={'file': ('triangle.obj', b'v 0 0 0\nv .1 0 0\nv 0 .1 0\nf 1 2 3\n')})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['kind'], 'mesh')
        self.assertEqual(c.get(result.json()['url']).status_code, 200)
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as z:
            z.writestr('../escape.urdf', 'invalid')
        self.assertEqual(c.post('/api/import', files={'file': ('unsafe.zip', data.getvalue())}).status_code, 400)
        original = c.get('/api/model').json()['xml']
        self.assertEqual(c.post('/api/urdf', json={'xml': '<robot broken'}).status_code, 400)
        missing = original.replace('obj/base_frame.obj', '../../outside.obj')
        self.assertEqual(c.post('/api/urdf', json={'xml': missing}).status_code, 400)
        self.assertEqual(c.get('/api/model').json()['xml'], original)
        self.assertEqual(c.post('/api/command', json={'action': 'run', 'value': True}, headers={'Origin':'https://example.com'}).status_code, 403)


if __name__ == '__main__':
    unittest.main()
