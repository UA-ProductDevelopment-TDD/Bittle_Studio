import ast
import json
import time
import unittest

from fastapi.testclient import TestClient

import server
from motion_export import build_motion, python_motion


class CodeWorkbenchTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = TestClient(server.app)
        cls.c = cls.context.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.context.__exit__(None, None, None)

    def tearDown(self):
        self.c.post('/api/scripts/stop')

    def wait_finished(self, seconds=8):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            status = self.c.get('/api/scripts').json()
            if status['jobs'] and all(j['status'] != 'running' for j in status['jobs']):
                return status
            time.sleep(.05)
        self.fail('Scripts did not finish: ' + str(status))

    def save(self, files):
        r = self.c.put('/api/scripts', json={'files': files})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()['files']

    def test_01_rates_and_order(self):
        sim = server.sim
        with sim.lock:
            zero = {j['name']: 0 for j in sim.joints}
            name = sim.joints[0]['name']
            frames = [{'time': 2, 'pose': {**zero, name: 30}}, {'time': 0, 'pose': {**zero, name: -20}}, {'time': 1, 'pose': {**zero, name: 5}}]
            sim.set_frames(frames)
            for hz in (10, 50, 100):
                samples, mapping, meta = build_motion(sim, {'hz': hz, 'speed': 1}, False)
                self.assertEqual(len(samples), 2 * hz + 1)
                index = samples[0][1][::2].index(mapping[name]['servo']) * 2 + 1
                self.assertEqual(samples[0][1][index], -20)
                self.assertEqual(samples[-1][1][index], 30)
                self.assertTrue(all(a[0] < b[0] for a, b in zip(samples, samples[1:])))
            reverse, _, _ = build_motion(sim, {'hz': 50, 'speed': 1, 'direction': 'reverse'}, False)
            self.assertEqual(reverse[0][1][index], 30)
            self.assertEqual(reverse[-1][1][index], -20)
        response = self.c.post('/api/command', json={'action':'settings', 'physics_hz':480, 'motion_hz':100})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['physics_hz'], 480)
        self.assertEqual(self.c.post('/api/command', json={'action':'settings','physics_hz':0}).status_code, 400)

    def test_02_multi_target_and_modules(self):
        actor = self.c.post('/api/actors', json={'duplicate_main': True}).json()
        obj = self.c.post('/api/objects', json={'type':'box','position':[.5,0,.1]}).json()
        name = server.sim.joints[0]['name']
        self.save([
            {'id':'helper','name':'helper.py','source':'ANGLE = 22\n','enabled':False},
            {'id':'one','name':'one.py','target':'main','source':f'from bittle_sim import ctx\nfrom helper import ANGLE\nctx.set_joints({{{name!r}: ANGLE}})\nctx.sleep(.15)\nprint("main done")'},
            {'id':'two','name':'two.py','target':actor['id'],'source':f'from bittle_sim import ctx\nctx.set_joints({{{name!r}: -13}})\nctx.sleep(.15)\nprint("other done")'},
            {'id':'box','name':'box.py','target':obj['id'],'source':'from bittle_sim import ctx\nctx.set_position([.6,.1,.2])\nctx.sleep(.15)\nprint("box done")'}])
        result = self.c.post('/api/scripts/run', json={})
        self.assertEqual(result.status_code, 200, result.text)
        status = self.wait_finished()
        self.assertTrue(all(j['status']=='completed' for j in status['jobs']), status)
        state = self.c.get('/api/state').json()
        self.assertAlmostEqual(state['targets'][name], 22)
        self.assertAlmostEqual(state['actors'][actor['id']]['targets'][name], -13)
        self.assertAlmostEqual(state['objects'][obj['id']][0][0], .6)
        project = self.c.get('/api/project').json()
        self.assertEqual(len(project['scripts']), 4)
        self.assertEqual(len(project['actors']), 1)
        restored = self.c.post('/api/project', json=project)
        self.assertEqual(restored.status_code, 200, restored.text)
        self.assertEqual(restored.json()['scripts'], project['scripts'])
        self.assertEqual(restored.json()['actors'][0]['id'], actor['id'])
        # Same files must run again after Bullet body IDs have been recreated.
        self.assertEqual(self.c.post('/api/scripts/run', json={}).status_code, 200)
        self.assertTrue(all(j['status']=='completed' for j in self.wait_finished()['jobs']))

    def test_03_exact_export_execution(self):
        sim = server.sim
        name = sim.joints[0]['name']
        zero = {j['name']:0 for j in sim.joints}
        self.c.post('/api/frames', json={'frames':[{'time':0,'pose':{**zero,name:-10}}, {'time':.3,'pose':{**zero,name:20}}]})
        mapping = json.loads(json.dumps(sim.mapping))
        mapping[name]['sign'] = -1
        mapping[name]['offset'] = 7
        result = self.c.post('/api/motion-code', json={'hz':50,'speed':1,'mapping':mapping})
        self.assertEqual(result.status_code, 200, result.text)
        source = result.json()['source']
        ast.parse(source)
        self.assertIn("rotateJoints('I'", source)
        self.save([{'id':'export','name':'motion.py','target':'main','source':source}])
        self.assertEqual(self.c.post('/api/scripts/run', json={}).status_code, 200)
        status = self.wait_finished()
        self.assertEqual(status['jobs'][0]['status'], 'completed', status)
        self.assertEqual(status['jobs'][0]['commands'], 16)
        self.assertAlmostEqual(self.c.get('/api/state').json()['targets'][name], 20)
        self.assertTrue(any('simulation target' in log['text'] for log in status['logs']))

    def test_04_stop_error_and_conflict(self):
        self.save([{'id':'loop','name':'loop.py','source':'while True:\n    pass\n'}])
        self.assertEqual(self.c.post('/api/scripts/run', json={}).status_code, 200)
        self.assertEqual(self.c.post('/api/urdf', json={'xml':server.sim.xml}).status_code, 400)
        started=time.monotonic()
        self.c.post('/api/scripts/stop')
        self.assertLess(time.monotonic()-started, 3)
        self.assertFalse(self.c.get('/api/scripts').json()['active'])
        self.save([{'id':'bad','name':'bad.py','source':'raise RuntimeError("intentional-test-error")'}])
        self.c.post('/api/scripts/run', json={})
        status=self.wait_finished()
        self.assertEqual(status['jobs'][0]['status'],'failed')
        self.assertTrue(any('intentional-test-error' in l['text'] for l in status['logs']))
        self.save([{'id':'timeout','name':'timeout.py','source':'while True:\n    pass'}])
        self.c.post('/api/scripts/run', json={'timeout':1})
        self.assertEqual(self.wait_finished()['jobs'][0]['status'],'timed out')
        self.assertEqual(self.c.put('/api/scripts',json={'files':[{'name':'../escape.py','source':''}]}).status_code,400)

    def test_05_pose_behavior_and_gait_exports(self):
        sim = server.sim
        with sim.lock:
            mapping = json.loads(json.dumps(sim.mapping))
            for item in mapping.values():
                item['verified'] = True
            first_name = sim.joints[0]['name']
            zero = {joint['name']: 0 for joint in sim.joints}
            sim.set_frames([
                {'time': 0, 'pose': zero, 'easing': 'linear'},
                {'time': .2, 'pose': {**zero, first_name: 17}, 'easing': 'linear'}
            ])
            sim.targets[first_name] = 17
            pose, _, pose_meta = build_motion(sim, {'mapping': mapping, 'motion_type': 'pose'}, True)
            self.assertEqual(len(pose), 1)
            self.assertEqual(pose_meta['type'], 'pose')
            self.assertFalse(pose_meta['loop'])
            behavior_source, _, behavior_meta = python_motion(
                sim, {'mapping': mapping, 'motion_type': 'behavior', 'hz': 10, 'speed': 1})
            gait_source, _, gait_meta = python_motion(
                sim, {'mapping': mapping, 'motion_type': 'gait', 'hz': 10, 'speed': 1})
        ast.parse(behavior_source)
        ast.parse(gait_source)
        self.assertFalse(behavior_meta['loop'])
        self.assertTrue(gait_meta['loop'])
        self.assertIn("while True:", gait_source)
        self.assertIn("if not MOTION['loop']", behavior_source)
        samples = self.c.post('/api/motion-samples', json={
            'mapping': mapping, 'motion_type': 'pose', 'hz': 50
        })
        self.assertEqual(samples.status_code, 200, samples.text)
        self.assertEqual(samples.json()['metadata']['samples'], 1)


if __name__=='__main__':
    unittest.main()
