"""Local, single-session Bullet simulation. SI units; Z is up."""
import math
import threading
import time
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
import pybullet as p

ROOT = Path(__file__).parent.resolve()
DATA = ROOT / 'data'
DATA.mkdir(exist_ok=True)


def vector(text, default=(0, 0, 0)):
    result = [float(x) for x in text.split()] if text else list(default)
    if len(result) != len(default) or not all(math.isfinite(x) for x in result):
        raise ValueError('Invalid vector in URDF')
    return result


def asset_url(path):
    path = Path(path).resolve()
    for folder in ('assets', 'data'):
        base = ROOT / folder
        if path.is_relative_to(base):
            return '/' + folder + '/' + path.relative_to(base).as_posix()
    raise ValueError('Mesh must be inside the project assets or data directory')


def asset_path(url):
    path = (ROOT / url.lstrip('/')).resolve()
    asset_url(path)
    if not path.is_file():
        raise ValueError('Asset not found: ' + url)
    return path


class Simulation:
    def __init__(self, client=None, xml=None, directory=None, fixed=False):
        self.lock = threading.RLock()
        self.client = p.connect(p.DIRECT) if client is None else client
        self.physics_hz = 240
        self.motion_hz = 50
        self.direction = 'forward'
        self.runtime_clock = 0.
        self.motion_elapsed = 0.
        self.actors = {}
        self.scripts = []
        self.running = False
        self.clock = 0.
        self.gravity = -9.81
        self.friction = .8
        self.fixed = fixed
        self.robot = None
        self.objects = []
        self.frames = []
        self.playing = False
        self.loop = True
        self.playhead = 0.
        self.speed = 1.
        self.mapping = {}
        self.closed = False
        if client is None:
            p.setGravity(0, 0, self.gravity, physicsClientId=self.client)
            p.setTimeStep(1 / self.physics_hz, physicsClientId=self.client)
            p.setPhysicsEngineParameter(numSolverIterations=80, physicsClientId=self.client)
            self.ground = p.createMultiBody(0, p.createCollisionShape(p.GEOM_PLANE, physicsClientId=self.client), physicsClientId=self.client)
            p.changeDynamics(self.ground, -1, lateralFriction=self.friction, physicsClientId=self.client)
        self.load_robot(xml or (ROOT / 'assets/bittle/bittle.urdf').read_text(), directory or ROOT / 'assets/bittle')

    def load_robot(self, xml, directory):
        tree = ET.fromstring(xml)
        if tree.tag != 'robot':
            raise ValueError('Expected a URDF <robot> element')
        warnings = []
        visuals = []
        for link in tree.findall('link'):
            inertia = link.find('inertial/inertia')
            if inertia is not None:
                a = inertia.attrib
                m = np.array([[float(a['ixx']), float(a.get('ixy', 0)), float(a.get('ixz', 0))],
                              [float(a.get('ixy', 0)), float(a['iyy']), float(a.get('iyz', 0))],
                              [float(a.get('ixz', 0)), float(a.get('iyz', 0)), float(a['izz'])]])
                eigen = np.linalg.eigvalsh(m)
                if min(eigen) <= 0 or max(eigen) > sum(eigen) - max(eigen) + 1e-10:
                    warnings.append(link.attrib['name'] + ': supplied inertia is not physically valid.')
            for visual in link.findall('visual'):
                geo = visual.find('geometry')
                origin = visual.find('origin')
                item = {'link': link.attrib['name'], 'position': vector(origin.get('xyz') if origin is not None else None),
                        'quaternion': p.getQuaternionFromEuler(vector(origin.get('rpy') if origin is not None else None))}
                material = visual.find('material/color')
                if material is not None:
                    item['color'] = vector(material.get('rgba'), (1, 1, 1, 1))
                if geo is None or len(geo) == 0:
                    continue
                shape = geo[0]
                item['type'] = shape.tag
                item.update(shape.attrib)
                visuals.append(item)
        # Resolve every mesh before loading; XML cannot escape local asset roots.
        for mesh in tree.iter('mesh'):
            raw = mesh.get('filename', '').replace('\\', '/')
            if raw.startswith('package://'):
                raw = raw[len('package://'):]
            path = (directory / raw).resolve()
            asset_url(path)
            if not path.is_file():
                raise ValueError('Missing mesh: ' + raw + '. Import a ZIP containing the URDF and its mesh folders.')
            mesh.set('filename', path.as_posix())
        for item in visuals:
            if item['type'] == 'mesh':
                raw = item['filename'].replace('package://', '')
                item['url'] = asset_url(directory / raw)
                item['scale'] = vector(item.get('scale'), (1, 1, 1))
        temp = DATA / ('runtime-' + uuid.uuid4().hex + '.urdf')
        temp.write_text(ET.tostring(tree, encoding='unicode'))
        try:
            new = p.loadURDF(str(temp), [0, 0, .20], useFixedBase=self.fixed,
                             flags=p.URDF_USE_SELF_COLLISION | p.URDF_USE_SELF_COLLISION_EXCLUDE_PARENT,
                             physicsClientId=self.client)
        finally:
            temp.unlink(missing_ok=True)
        if self.robot is not None:
            p.removeBody(self.robot, physicsClientId=self.client)
        self.robot = new
        self.xml = xml
        self.directory = directory
        self.visuals = visuals
        self.warnings = warnings + ['Bullet estimates inertia from collision geometry; supplied masses are retained. Spring compliance and servo electronics are not modelled.']
        self.joints = []
        self.links = {p.getBodyInfo(new, physicsClientId=self.client)[0].decode(): -1}
        for i in range(p.getNumJoints(new, physicsClientId=self.client)):
            info = p.getJointInfo(new, i, physicsClientId=self.client)
            self.links[info[12].decode()] = i
            if info[2] not in (p.JOINT_FIXED,):
                if info[2] != p.JOINT_REVOLUTE:
                    self.warnings.append(info[1].decode() + ': only revolute joints have pose controls.')
                    continue
                lo, hi = info[8:10]
                if lo > hi:
                    lo, hi = -math.pi, math.pi
                self.joints.append({'id': i, 'name': info[1].decode(), 'lower': math.degrees(lo), 'upper': math.degrees(hi),
                                    'effort': max(0, info[10]), 'velocity': max(0, info[11])})
            p.changeDynamics(new, i, lateralFriction=self.friction, physicsClientId=self.client)
        p.changeDynamics(new, -1, lateralFriction=self.friction, physicsClientId=self.client)
        self.targets = {j['name']: 0. for j in self.joints}
        self.running = self.playing = False
        self.frames = []
        self.playhead = self.clock = 0.
        self.mapping = {j['name']: {'servo': self.default_servo(j['name']), 'sign': 1, 'offset': 0, 'verified': False} for j in self.joints}
        self.pose(self.targets)

    @staticmethod
    def default_servo(name):
        for leg, index in [('left-front', 8), ('right-front', 9), ('right-back', 10), ('left-back', 11)]:
            if leg in name:
                return index + (4 if 'knee' in name else 0)
        return -1

    def pose(self, values):
        for j in self.joints:
            value = float(values.get(j['name'], self.targets[j['name']]))
            if not math.isfinite(value):
                raise ValueError('Joint angles must be finite')
            self.targets[j['name']] = max(j['lower'], min(j['upper'], value))
            if not self.running:
                p.resetJointState(self.robot, j['id'], math.radians(self.targets[j['name']]), physicsClientId=self.client)

    def sample(self, t):
        if not self.frames:
            return self.targets.copy()
        if t <= self.frames[0]['time']:
            return self.frames[0]['pose'].copy()
        for a, b in zip(self.frames, self.frames[1:]):
            if t <= b['time']:
                u = (t - a['time']) / (b['time'] - a['time'])
                if b.get('easing') == 'smooth':
                    u = u * u * (3 - 2 * u)
                return {k: a['pose'][k] + (b['pose'][k] - a['pose'][k]) * u for k in a['pose']}
        return self.frames[-1]['pose'].copy()

    def set_frames(self, frames):
        validated = []
        for frame in frames:
            t = float(frame['time'])
            if not math.isfinite(t) or t < 0 or t > 600:
                raise ValueError('Keyframe time must be between 0 and 600 seconds')
            pose = {}
            for j in self.joints:
                v = float(frame['pose'].get(j['name'], 0))
                if not math.isfinite(v) or not j['lower'] - .01 <= v <= j['upper'] + .01:
                    raise ValueError('Keyframe angle exceeds limits: ' + j['name'])
                pose[j['name']] = v
            validated.append({'time': t, 'pose': pose, 'easing': frame.get('easing', 'smooth')})
        validated.sort(key=lambda x: x['time'])
        if len({f['time'] for f in validated}) != len(validated):
            raise ValueError('Keyframes must have different times')
        self.frames = validated

    def configure_rates(self, physics_hz=240, motion_hz=50, direction='forward'):
        if not isinstance(physics_hz, (int, float)) or not math.isfinite(physics_hz) or not 60 <= physics_hz <= 1000:
            raise ValueError('Physics Hz must be between 60 and 1000')
        if not isinstance(motion_hz, (int, float)) or not math.isfinite(motion_hz) or not 1 <= motion_hz <= 240:
            raise ValueError('Motion Hz must be between 1 and 240')
        if direction not in ('forward', 'reverse'):
            raise ValueError('Direction must be forward or reverse')
        self.physics_hz, self.motion_hz, self.direction = physics_hz, motion_hz, direction
        p.setTimeStep(1 / physics_hz, physicsClientId=self.client)

    def drive_motors(self):
        for j in self.joints:
            p.setJointMotorControl2(self.robot, j['id'], p.POSITION_CONTROL,
                                   targetPosition=math.radians(self.targets[j['name']]), force=j['effort'],
                                   maxVelocity=j['velocity'], physicsClientId=self.client)

    def tick(self):
        dt = 1 / self.physics_hz
        self.runtime_clock += dt
        if self.playing and self.frames:
            self.playhead += dt * self.speed * (1 if self.direction == 'forward' else -1)
            end = self.frames[-1]['time']
            finished = self.playhead > end or self.playhead < 0
            if finished:
                self.playhead = (0 if self.direction == 'forward' else end) if self.loop else (end if self.direction == 'forward' else 0)
                self.playing = self.loop and end > 0
            self.motion_elapsed += dt
            if self.motion_elapsed >= 1 / self.motion_hz or finished:
                self.motion_elapsed %= 1 / self.motion_hz
                self.pose(self.sample(self.playhead))
        if self.running:
            self.drive_motors()
            for actor in self.actors.values():
                actor.drive_motors()
            p.stepSimulation(physicsClientId=self.client)
            self.clock += dt

    def worker(self):
        last = time.perf_counter()
        accumulator = 0.
        while not self.closed:
            now = time.perf_counter()
            accumulator += min(now - last, .1)
            last = now
            with self.lock:
                while accumulator >= 1 / self.physics_hz:
                    self.tick()
                    accumulator -= 1 / self.physics_hz
            time.sleep(.002)

    def reset(self):
        self.running = self.playing = False
        self.clock = self.playhead = 0.
        p.resetBasePositionAndOrientation(self.robot, [0, 0, .20], [0, 0, 0, 1], physicsClientId=self.client)
        p.resetBaseVelocity(self.robot, [0, 0, 0], [0, 0, 0], physicsClientId=self.client)
        self.pose(self.sample(0) if self.frames else self.targets)
        for obj in self.objects:
            p.resetBasePositionAndOrientation(obj['body'], obj['position'], p.getQuaternionFromEuler(obj['rotation']), physicsClientId=self.client)
            p.resetBaseVelocity(obj['body'], [0, 0, 0], [0, 0, 0], physicsClientId=self.client)
        for actor in self.actors.values():
            p.resetBasePositionAndOrientation(actor.robot, actor.home_position, p.getQuaternionFromEuler(actor.home_rotation), physicsClientId=self.client)
            p.resetBaseVelocity(actor.robot, [0, 0, 0], [0, 0, 0], physicsClientId=self.client)
            actor.running = False
            actor.pose({j['name']: 0 for j in actor.joints})

    def add_actor(self, definition):
        directory = (ROOT / definition['directory'].lstrip('/')).resolve()
        asset_url(directory / 'placeholder')
        position = vector(' '.join(map(str, definition.get('position', [.35, 0, .2]))))
        rotation = vector(' '.join(map(str, definition.get('rotation', [0, 0, 0]))))
        actor_id = definition.get('id', uuid.uuid4().hex)
        if actor_id == 'main' or actor_id in self.actors:
            raise ValueError('Duplicate robot ID')
        actor = Simulation(self.client, definition['xml'], directory, bool(definition.get('fixed', False)))
        try:
            actor.actor_id = actor_id
            actor.actor_name = str(definition.get('name', 'Robot'))[:100]
            actor.home_position, actor.home_rotation = position, rotation
            p.resetBasePositionAndOrientation(actor.robot, position, p.getQuaternionFromEuler(rotation), physicsClientId=self.client)
            actor.pose(definition.get('targets', {}))
            actor.mapping = definition.get('mapping', actor.mapping)
            self.actors[actor_id] = actor
            return actor
        except Exception:
            p.removeBody(actor.robot, physicsClientId=self.client)
            raise

    def actor_definition(self, visuals=False):
        result = {'id': self.actor_id, 'name': self.actor_name, 'xml': self.xml,
                  'directory': asset_url(self.directory / 'placeholder').rsplit('/', 1)[0],
                  'position': self.home_position, 'rotation': self.home_rotation, 'fixed': self.fixed,
                  'targets': self.targets.copy(), 'mapping': self.mapping}
        if visuals:
            result.update(visuals=self.visuals, joints=self.joints, warnings=self.warnings)
        return result

    def add_object(self, obj):
        obj = dict(obj)
        obj['id'] = obj.get('id', uuid.uuid4().hex)
        obj.setdefault('name', obj['type'].title())
        obj.setdefault('position', [.25, 0, .025])
        obj.setdefault('rotation', [0, 0, 0])
        obj.setdefault('size', [.10, .10, .05])
        obj.setdefault('mass', 0)
        obj.setdefault('friction', .8)
        obj.setdefault('color', '#74909d')
        numbers = obj['position'] + obj['rotation'] + obj['size'] + [obj['mass'], obj['friction']]
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in numbers) or min(obj['size']) <= 0 or obj['mass'] < 0 or obj['friction'] < 0:
            raise ValueError('Object dimensions must be positive; mass and friction must be nonnegative')
        if obj['type'] == 'box':
            shape = p.createCollisionShape(p.GEOM_BOX, halfExtents=[v / 2 for v in obj['size']], physicsClientId=self.client)
        elif obj['type'] == 'sphere':
            shape = p.createCollisionShape(p.GEOM_SPHERE, radius=obj['size'][0] / 2, physicsClientId=self.client)
        elif obj['type'] == 'mesh':
            path = asset_path(obj['url'])
            shape = p.createCollisionShape(p.GEOM_MESH, fileName=str(path), meshScale=obj['size'],
                                          flags=p.GEOM_FORCE_CONCAVE_TRIMESH if obj['mass'] == 0 else 0, physicsClientId=self.client)
        else:
            raise ValueError('Unsupported object type')
        if shape < 0:
            raise ValueError('Could not create collision mesh')
        obj['body'] = p.createMultiBody(obj['mass'], shape, basePosition=obj['position'], baseOrientation=p.getQuaternionFromEuler(obj['rotation']), physicsClientId=self.client)
        p.changeDynamics(obj['body'], -1, lateralFriction=obj['friction'], physicsClientId=self.client)
        self.objects.append(obj)
        return obj

    def state(self):
        transforms = {}
        for name, i in self.links.items():
            if i < 0:
                pos, quat = p.getBasePositionAndOrientation(self.robot, physicsClientId=self.client)
                dyn = p.getDynamicsInfo(self.robot, -1, physicsClientId=self.client)
                ip, iq = p.invertTransform(dyn[3], dyn[4])
                pos, quat = p.multiplyTransforms(pos, quat, ip, iq)
            else:
                s = p.getLinkState(self.robot, i, computeForwardKinematics=1, physicsClientId=self.client)
                pos, quat = s[4:6]
            transforms[name] = [pos, quat]
        objects = {o['id']: p.getBasePositionAndOrientation(o['body'], physicsClientId=self.client) for o in self.objects}
        p.performCollisionDetection(physicsClientId=self.client)
        contacts = p.getContactPoints(bodyA=self.robot, physicsClientId=self.client)
        pos, quat = p.getBasePositionAndOrientation(self.robot, physicsClientId=self.client)
        return {'transforms': transforms, 'objects': objects, 'actors': {k: a.state() for k, a in self.actors.items()},
                'physics_hz': self.physics_hz, 'motion_hz': self.motion_hz, 'runtime_clock': self.runtime_clock,
                'running': self.running, 'playing': self.playing,
                'time': self.clock, 'playhead': self.playhead, 'targets': self.targets,
                'angles': {j['name']: math.degrees(p.getJointState(self.robot, j['id'], physicsClientId=self.client)[0]) for j in self.joints},
                'height': pos[2], 'rpy': p.getEulerFromQuaternion(quat), 'contacts': len(contacts)}

    def model(self):
        return {'joints': self.joints, 'visuals': self.visuals, 'warnings': self.warnings, 'xml': self.xml,
                'objects': [{k: v for k, v in o.items() if k != 'body'} for o in self.objects],
                'frames': self.frames, 'mapping': self.mapping, 'fixed': self.fixed, 'gravity': self.gravity,
                'friction': self.friction, 'targets': self.targets, 'physics_hz': self.physics_hz,
                'motion_hz': self.motion_hz, 'direction': self.direction,
                'actors': [a.actor_definition(True) for a in self.actors.values()], 'scripts': self.scripts}
