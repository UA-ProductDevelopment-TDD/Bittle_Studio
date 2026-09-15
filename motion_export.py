"""One chronological sampler shared by exports and code-panel previews."""
import math
import pprint


def build_motion(sim, body, hardware=True):
    if len(sim.frames) < 2:
        raise ValueError('Add at least two keyframes before exporting')
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
    duration = sim.frames[-1]['time'] / speed
    if duration * hz > 150000:
        raise ValueError('Motion is too large; lower Hz or shorten the timeline')
    samples = []
    # Include the first and exact last pose once; never reverse timestamps.
    for i in range(math.ceil(duration * hz) + 1):
        timestamp = min(i / hz, duration)
        t = timestamp * speed
        if direction == 'reverse':
            t = sim.frames[-1]['time'] - t
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
    metadata = {'hz': hz, 'speed': speed, 'direction': direction, 'duration': duration, 'samples': len(samples)}
    return samples, mapping, metadata


def python_motion(sim, body, hardware=True):
    samples, mapping, metadata = build_motion(sim, body, hardware)
    return '''"""Bittle Studio motion. Hardware: --execute. Without flags: dry run.
In Studio's code panel PetoiRobot is replaced by the selected simulation target.
Uses I (simultaneous), not M (sequential). Requested Hz is not guaranteed by serial hardware.
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
        input('Check the first pose, then Enter to play (Ctrl+C cancels).')
        start = time.monotonic()
        sent = 0
        for timestamp, joints in SAMPLES[1:]:
            time.sleep(max(0, start + timestamp - time.monotonic()))
            rotateJoints('I', joints, 0)
            sent += 1
        elapsed = time.monotonic() - start
        print('Completed in %.3fs; effective rate %.1f Hz (requested %.1f)' %
              (elapsed, sent / max(elapsed, 1e-9), MOTION['hz']))
    except KeyboardInterrupt:
        print('Stopped sending targets.')
    finally:
        closePort()

if __name__ == '__main__':
    main()
''', mapping, metadata
