"""Child-process bridge for trusted local Python. This is NOT a security sandbox."""
import builtins
import json
import runpy
import sys
import threading
import time
import types
from pathlib import Path

PREFIX = '@@STUDIO_RPC@@'
rpc_lock = threading.Lock()


def rpc(method, **args):
    with rpc_lock:
        sys.__stdout__.write(PREFIX + json.dumps({'method': method, 'args': args}, allow_nan=False) + '\n')
        sys.__stdout__.flush()
        response = sys.__stdin__.readline()
        if not response:
            raise SystemExit('Simulation runner stopped')
        result = json.loads(response)
        if 'error' in result:
            raise RuntimeError(result['error'])
        return result.get('result')


class Context:
    def time(self):
        return rpc('time')

    def sleep(self, seconds):
        return rpc('sleep', seconds=seconds)

    def set_joints(self, pose):
        return rpc('pose', pose=pose)

    def get_state(self):
        return rpc('state')

    def set_position(self, position, rotation=None):
        return rpc('position', position=position, rotation=rotation)

    def apply_force(self, force):
        return rpc('force', force=force)

    def rate(self, hz):
        return Rate(hz)


class Rate:
    def __init__(self, hz):
        hz = float(hz)
        if not 1 <= hz <= 240:
            raise ValueError('Controller Hz must be 1–240')
        self.dt = 1 / hz
        self.next = rpc('time')

    def sleep(self):
        self.next += self.dt
        rpc('sleep_until', timestamp=self.next)


ctx = Context()
shim = types.ModuleType('bittle_sim')
shim.ctx = ctx
sys.modules['bittle_sim'] = shim
petoi = types.ModuleType('PetoiRobot')
petoi.__path__ = []


def rotate_joints(token, values, delayTime=0):
    if token not in ('I', 'i', 'M', 'm'):
        raise ValueError('Supported simulated joint commands: I/i, M/m')
    flat = []
    for value in values:
        if isinstance(value, (tuple, list)):
            if len(value) != 2:
                raise ValueError('Only absolute index/angle pairs are supported')
            flat.extend(value)
        else:
            flat.append(value)
    if token in ('M', 'm'):
        print('Note: legacy M command; sequential timing is not emulated. Re-export with I for simultaneous motion.')
    rpc('servos', values=flat)
    if delayTime:
        ctx.sleep(delayTime)


petoi.rotateJoints = rotate_joints
petoi.autoConnect = lambda: print('PetoiRobot → simulation target (no serial connection)')
petoi.openPort = lambda *args: petoi.autoConnect()
petoi.closePort = lambda: print('Simulation adapter closed')
petoi.absValList = lambda index, angle: [(index, angle)]
petoi.getAngleList = lambda: rpc('servo_angles')
petoi.getAngle = lambda index: rpc('servo_angles')[index]
sys.modules['PetoiRobot'] = petoi
sys.modules['PetoiRobot.robot'] = petoi


def main():
    filename = Path(sys.argv[1]).resolve()
    sys.path.insert(0, str(filename.parent))
    sys.argv = [str(filename), '--execute']
    # Simulation time prevents scheduling drift when the physics world runs slowly.
    time.sleep = ctx.sleep
    time.monotonic = ctx.time
    time.perf_counter = ctx.time
    builtins.input = lambda prompt='': (print('[simulation] ' + prompt), '')[1]
    print('Running', filename.name)
    runpy.run_path(str(filename), run_name='__main__')


if __name__ == '__main__':
    main()
