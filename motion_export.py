"""One chronological sampler shared by exports and code-panel previews."""
import math
import pprint


def build_motion(sim, body, hardware=True):
    motion_type = body.get('motion_type', 'behavior')
    if motion_type not in ('pose', 'behavior', 'gait'):
        raise ValueError('Motion type must be pose, behavior or gait')
    if motion_type != 'pose' and len(sim.frames) < 2:
        raise ValueError('Add at least two keyframes before exporting a behavior or gait')
    mapping = body.get('mapping', sim.mapping)
    used = set()
    for joint in sim.joints:
        m = mapping.get(joint['name'], {})
        servo = m.get('servo', -1)
        if (hardware and not m.get('verified')) or not isinstance(servo, int) or not 0 <= servo <= 15 or servo in used or m.get('sign') not in (-1, 1):
            raise ValueError('Verify a unique servo index (0–15) and direction for every joint')
        if not math.isfinite(float(m.get('offset', 0))):
            raise ValueError('Servo offsets must be finite')
        used.add(servo)
    hz = float(body.get('hz', sim.motion_hz))
    speed = float(body.get('speed', .5))
    direction = body.get('direction', sim.direction)
    if not math.isfinite(hz) or not 1 <= hz <= 240:
        raise ValueError('Motion Hz must be between 1 and 240')
    if not math.isfinite(speed) or not .1 <= speed <= 2:
        raise ValueError('Speed must be between 0.1 and 2')
    if direction not in ('forward', 'reverse'):
        raise ValueError('Choose forward or reverse order')
    duration = 0 if motion_type == 'pose' else sim.frames[-1]['time'] / speed
    if duration * hz > 150000:
        raise ValueError('Motion is too large; lower Hz or shorten the timeline')
    samples = []
    # A pose captures the currently displayed target. Behaviors and gaits include
    # the first and exact last timeline pose once; timestamps stay chronological.
    for i in range(math.ceil(duration * hz) + 1):
        timestamp = min(i / hz, duration)
        t = timestamp * speed
        if motion_type == 'pose':
            pose = sim.targets
        elif direction == 'reverse':
            t = sim.frames[-1]['time'] - t
            pose = sim.sample(t)
        else:
            pose = sim.sample(t)
        pairs = []
        for joint in sim.joints:
            m = mapping[joint['name']]
            angle = round(pose[joint['name']] * m['sign'] + float(m.get('offset', 0)))
            if not -125 <= angle <= 125:
                raise ValueError('Mapped servo angle exceeds ±125°: ' + joint['name'])
            pairs.append((m['servo'], angle))
        values = [v for pair in sorted(pairs) for v in pair]
        samples.append([round(timestamp, 8), values])
    metadata = {'type': motion_type, 'loop': motion_type == 'gait', 'hz': hz, 'speed': speed,
                'direction': direction, 'duration': duration, 'samples': len(samples)}
    return samples, mapping, metadata


def python_motion(sim, body, hardware=True):
    samples, mapping, metadata = build_motion(sim, body, hardware)
    return '''"""Bittle Studio motion. Hardware: --execute. Without flags: dry run.
In Studio's code panel PetoiRobot is replaced by the selected simulation target.
Uses I (simultaneous), not M (sequential). Requested Hz is not guaranteed by serial hardware.
Pose and behavior exports run once. A gait repeats until Ctrl+C.
"""
import argparse
import time

STUDIO_MAPPING = ''' + pprint.pformat(mapping, width=100, sort_dicts=False) + '''
MOTION = ''' + repr(metadata) + '''
SAMPLES = ''' + pprint.pformat(samples, width=110, compact=True) + '''

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    if not args.execute:
        print('Dry run:', MOTION)
        print('First pose:', SAMPLES[0])
        print('Last pose: ', SAMPLES[-1])
        print('Verify mapping and clearance before --execute.')
        return
    from PetoiRobot import autoConnect, rotateJoints, closePort
    autoConnect()
    try:
        input('Support the robot and press Enter to send the first pose.')
        rotateJoints('I', SAMPLES[0][1], 2)
        if MOTION['type'] == 'pose':
            print('Pose sent.')
            return
        input('Check the first pose, then Enter to play (Ctrl+C cancels).')
        rounds = 0
        include_first = False
        while True:
            start = time.monotonic()
            sequence = SAMPLES if include_first else SAMPLES[1:]
            round_sent = 0
            for timestamp, joints in sequence:
                time.sleep(max(0, start + timestamp - time.monotonic()))
                rotateJoints('I', joints, 0)
                round_sent += 1
            elapsed = time.monotonic() - start
            rounds += 1
            print('Round %d completed in %.3fs; effective rate %.1f Hz (requested %.1f)' %
                  (rounds, elapsed, round_sent / max(elapsed, 1e-9), MOTION['hz']))
            if not MOTION['loop']:
                break
            include_first = True
    except KeyboardInterrupt:
        print('Stopped sending targets.')
    finally:
        closePort()

if __name__ == '__main__':
    main()
''', mapping, metadata
