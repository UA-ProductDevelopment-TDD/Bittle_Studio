"""Managed, stoppable Python subprocesses with target-scoped simulation RPC."""
import ast
from collections import deque
import json
import math
import os
import re
import subprocess
import sys
import threading
import time
import uuid

import pybullet as p

from engine import DATA, ROOT, vector


def validate_scripts(files):
    if not isinstance(files, list) or len(files) > 64:
        raise ValueError('Use at most 64 Python files')
    result, names, ids = [], set(), set()
    for f in files:
        name = f.get('name', '')
        if not re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*\.py', name) or name in names or name in ('PetoiRobot.py', 'bittle_sim.py'):
            raise ValueError('Use unique Python filenames such as controller.py; adapter names are reserved')
        source = f.get('source', '')
        if not isinstance(source, str) or len(source.encode('utf-8')) > 2_000_000:
            raise ValueError('Each Python file must be smaller than 2 MB')
        file_id = str(f.get('id', uuid.uuid4().hex))
        if file_id in ids:
            raise ValueError('Duplicate script ID')
        names.add(name)
        ids.add(file_id)
        result.append({'id': file_id, 'name': name, 'source': source, 'target': str(f.get('target', 'main')),
                       'enabled': bool(f.get('enabled', True))})
    return result


class ScriptRunner:
    def __init__(self, simulation):
        self.sim = simulation
        self.lock = threading.RLock()
        self.jobs = {}
        self.logs = deque(maxlen=500)
        self.sequence = 0

    def log(self, job, message):
        with self.lock:
            self.sequence += 1
            self.logs.append({'seq': self.sequence, 'file': job, 'text': str(message)[:4000]})

    def active(self):
        return any(j['process'].poll() is None for j in self.jobs.values())

    def ensure_idle(self):
        if self.active():
            raise ValueError('Stop Python scripts before changing the world, timeline or robot model')

    def target(self, target_id):
        if target_id == 'main':
            return self.sim, self.sim.robot
        if target_id in self.sim.actors:
            actor = self.sim.actors[target_id]
            return actor, actor.robot
        obj = next((o for o in self.sim.objects if o['id'] == target_id), None)
        if obj is None:
            raise ValueError('Script target no longer exists; choose another target')
        return None, obj['body']

    def start(self, file_ids=None, physics=False, timeout=120):
        self.ensure_idle()
        files = validate_scripts(self.sim.scripts)
        entries = [f for f in files if (f['id'] in file_ids if file_ids is not None else f['enabled'])]
        if not entries or len(entries) > 8:
            raise ValueError('Select 1–8 runnable Python files')
        if len({f['target'] for f in entries}) != len(entries):
            raise ValueError('Only one running script per target; use imports for helper modules')
        timeout = float(timeout)
        if not math.isfinite(timeout) or not 1 <= timeout <= 3600:
            raise ValueError('Run limit must be 1–3600 seconds')
        for f in files:
            compile(f['source'], f['name'], 'exec')
        for f in entries:
            self.target(f['target'])
        directory = DATA / 'runs' / uuid.uuid4().hex
        directory.mkdir(parents=True)
        for f in files:
            (directory / f['name']).write_text(f['source'], encoding='utf-8')
        with self.sim.lock:
            self.sim.playing = False
            # Starting a kinematic script must not pause a world the user already
            # started. The checkbox can enable physics, but never disables it.
            self.sim.running = self.sim.running or bool(physics)
        with self.lock:
            self.jobs = {}
            self.logs.clear()
        try:
            for f in entries:
                actor, _ = self.target(f['target'])
                mapping = json.loads(json.dumps(actor.mapping)) if actor else {}
                for node in ast.parse(f['source']).body:
                    if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'STUDIO_MAPPING' for t in node.targets):
                        mapping = ast.literal_eval(node.value)
                process = subprocess.Popen([sys.executable, '-u', str(ROOT / 'script_worker.py'), str(directory / f['name'])],
                                           cwd=directory, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                           text=True, encoding='utf-8', errors='replace', bufsize=1,
                                           env={**os.environ, 'PYTHONIOENCODING': 'utf-8'},
                                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                job = {'id': f['id'], 'name': f['name'], 'target': f['target'], 'mapping': mapping,
                       'process': process, 'stop': threading.Event(), 'status': 'running',
                       'started': time.monotonic(), 'timeout': timeout, 'commands': 0}
                with self.lock:
                    self.jobs[f['id']] = job
                threading.Thread(target=self.read_output, args=(job,), daemon=True).start()
                threading.Thread(target=self.watchdog, args=(job,), daemon=True).start()
        except Exception:
            self.stop()
            raise
        return self.status()

    def watchdog(self, job):
        while job['process'].poll() is None:
            if time.monotonic() - job['started'] > job['timeout']:
                job['status'] = 'timed out'
                job['stop'].set()
                job['process'].kill()
                self.log(job['name'], 'Run time limit reached; process terminated.')
                return
            if job['stop'].wait(.1):
                return

    def read_output(self, job):
        process = job['process']
        try:
            while True:
                line = process.stdout.readline(65536)
                if not line:
                    break
                if line.startswith('@@STUDIO_RPC@@'):
                    try:
                        if job['stop'].is_set():
                            break
                        request = json.loads(line[len('@@STUDIO_RPC@@'):])
                        response = {'result': self.dispatch(job, request['method'], request.get('args', {}))}
                    except Exception as error:
                        response = {'error': str(error)}
                    try:
                        process.stdin.write(json.dumps(response, allow_nan=False) + '\n')
                        process.stdin.flush()
                    except (BrokenPipeError, OSError):
                        break
                else:
                    self.log(job['name'], line.rstrip())
            code = process.wait()
            if job['status'] == 'running':
                job['status'] = 'completed' if code == 0 else 'failed'
            self.log(job['name'], job['status'] + f' (exit {code})')
        finally:
            process.stdout.close()
            process.stdin.close()

    def dispatch(self, job, method, args):
        if method in ('sleep', 'sleep_until'):
            value = float(args['seconds'] if method == 'sleep' else args['timestamp'])
            if not math.isfinite(value) or value < 0:
                raise ValueError('Sleep time must be finite and nonnegative')
            deadline = self.sim.runtime_clock + value if method == 'sleep' else value
            while self.sim.runtime_clock + 1e-9 < deadline:
                if job['stop'].wait(.002):
                    raise RuntimeError('Script stopped')
            return None
        with self.sim.lock:
            if job['stop'].is_set():
                raise RuntimeError('Script stopped')
            actor, body = self.target(job['target'])
            if method == 'time':
                return self.sim.runtime_clock
            if method == 'state':
                pos, quat = p.getBasePositionAndOrientation(body, physicsClientId=self.sim.client)
                return {'position': pos, 'rotation': p.getEulerFromQuaternion(quat), 'time': self.sim.runtime_clock,
                        'joints': {j['name']: math.degrees(p.getJointState(body, j['id'], physicsClientId=self.sim.client)[0]) for j in actor.joints} if actor else {},
                        'targets': actor.targets.copy() if actor else {}, 'joint_names': [j['name'] for j in actor.joints] if actor else []}
            if method in ('pose', 'servos', 'servo_angles'):
                if actor is None:
                    raise ValueError('This target has no joints; use ctx.set_position or ctx.apply_force')
                if method == 'servo_angles':
                    angles = [0.] * 16
                    for j in actor.joints:
                        m = job['mapping'].get(j['name'], {})
                        if isinstance(m.get('servo'), int) and 0 <= m['servo'] < 16:
                            angle = math.degrees(p.getJointState(body, j['id'], physicsClientId=self.sim.client)[0])
                            angles[m['servo']] = angle * m['sign'] + m['offset']
                    return angles
                pose = args.get('pose')
                if method == 'servos':
                    values = args['values']
                    if len(values) % 2:
                        raise ValueError('Expected servo index/angle pairs')
                    reverse = {}
                    for name, m in job['mapping'].items():
                        index = m.get('servo')
                        if index in reverse or m.get('sign') not in (-1, 1):
                            raise ValueError('Invalid or duplicate servo mapping')
                        reverse[index] = (name, m)
                    pose = {}
                    for index, angle in zip(values[::2], values[1::2]):
                        if index not in reverse:
                            raise ValueError(f'Servo {index} has no mapping on the selected robot')
                        name, m = reverse[index]
                        pose[name] = (float(angle) - float(m['offset'])) / m['sign']
                if not isinstance(pose, dict) or not set(pose).issubset(actor.targets):
                    raise ValueError('Use joint names from ctx.get_state()["joint_names"]')
                actor.running = self.sim.running
                actor.pose(pose)
                job['commands'] += 1
                return actor.targets.copy()
            if method == 'position':
                pos = vector(' '.join(map(str, args['position'])))
                quat = p.getBasePositionAndOrientation(body, physicsClientId=self.sim.client)[1]
                if args.get('rotation') is not None:
                    quat = p.getQuaternionFromEuler(vector(' '.join(map(str, args['rotation']))))
                p.resetBasePositionAndOrientation(body, pos, quat, physicsClientId=self.sim.client)
                p.resetBaseVelocity(body, [0, 0, 0], [0, 0, 0], physicsClientId=self.sim.client)
                job['commands'] += 1
                return None
            if method == 'force':
                force = vector(' '.join(map(str, args['force'])))
                if not self.sim.running:
                    raise ValueError('Enable physics to apply forces')
                pos = p.getBasePositionAndOrientation(body, physicsClientId=self.sim.client)[0]
                p.applyExternalForce(body, -1, force, pos, p.WORLD_FRAME, physicsClientId=self.sim.client)
                job['commands'] += 1
                return None
            raise ValueError('Unsupported simulation API method: ' + method)

    def stop(self):
        for job in list(self.jobs.values()):
            if job['process'].poll() is None:
                job['status'] = 'stopped'
                job['stop'].set()
                job['process'].kill()
                job['process'].wait(timeout=3)
        with self.sim.lock:
            self.sim.playing = self.sim.running = False

    def status(self):
        with self.lock:
            return {'active': self.active(), 'jobs': [{k: j[k] for k in ('id', 'name', 'target', 'status', 'commands')} for j in self.jobs.values()],
                    'logs': list(self.logs)}
