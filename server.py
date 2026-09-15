"""Bittle Studio: local HTTP interface. Run with launch.cmd."""
import io
import json
import math
import threading
import uuid
import zipfile
import xml.etree.ElementTree as ET
from contextlib import asynccontextmanager
from pathlib import Path

import pybullet as p
import trimesh
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from engine import DATA, ROOT, Simulation, asset_path, asset_url
from motion_export import build_motion, python_motion
from scripting import ScriptRunner, validate_scripts

sim = None
runner = None
AUTOSAVE = False  # Enabled by the desktop entry point; tests use isolated in-memory worlds.


def checkpoint():
    if AUTOSAVE:
        temporary = DATA / 'studio-session.tmp'
        temporary.write_text(json.dumps(get_project(), allow_nan=False), encoding='utf-8')
        temporary.replace(DATA / 'studio-session.json')


@asynccontextmanager
async def lifespan(app):
    global sim, runner
    sim = Simulation()
    runner = ScriptRunner(sim)
    if AUTOSAVE and (DATA / 'studio-session.json').is_file():
        try:
            load_project(json.loads((DATA / 'studio-session.json').read_text(encoding='utf-8')))
        except Exception as error:
            print('Could not restore the last session:', error)
    thread = threading.Thread(target=sim.worker, daemon=True)
    thread.start()
    yield
    runner.stop()
    checkpoint()
    sim.closed = True
    thread.join(2)
    p.disconnect(sim.client)


app = FastAPI(lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost', 'testserver'])


@app.middleware('http')
async def local_only(request: Request, call_next):
    # Reject cross-origin browser mutations; bind to loopback in the launcher.
    origin = request.headers.get('origin')
    if request.method not in ('GET', 'HEAD') and origin and origin != str(request.base_url).rstrip('/'):
        return JSONResponse({'detail': 'Only this local workbench may change the simulation'}, 403)
    try:
        return await call_next(request)
    except (ValueError, KeyError, TypeError, SyntaxError, ET.ParseError, zipfile.BadZipFile, p.error) as error:
        return JSONResponse({'detail': str(error)}, 400)


@app.get('/')
def index():
    return FileResponse(ROOT / 'web/index.html')


@app.get('/api/model')
def model():
    with sim.lock:
        return sim.model()


@app.get('/api/state')
def state():
    with sim.lock:
        return sim.state()


@app.post('/api/command')
def command(body: dict):
    if body['action'] == 'reset':
        runner.stop()
    elif body['action'] in ('play', 'settings', 'seek', 'pose'):
        runner.ensure_idle()
    with sim.lock:
        action = body['action']
        if action == 'run':
            sim.running = bool(body['value'])
        elif action == 'reset':
            sim.reset()
        elif action == 'pose':
            sim.pose(body['pose'])
        elif action == 'seek':
            sim.playing = False
            sim.playhead = max(0, min(600, float(body['time'])))
            sim.pose(sim.sample(sim.playhead))
        elif action == 'play':
            sim.configure_rates(sim.physics_hz, body.get('hz', sim.motion_hz), body.get('direction', sim.direction))
            sim.playing = bool(body['value']) and len(sim.frames) > 1
            sim.loop = bool(body.get('loop', True))
            sim.speed = max(.1, min(2, float(body.get('speed', 1))))
            if body.get('from_start') or (sim.frames and (sim.playhead >= sim.frames[-1]['time'] or sim.playhead <= 0)):
                sim.playhead = 0 if sim.direction == 'forward' else sim.frames[-1]['time'] if sim.frames else 0
            sim.motion_elapsed = 0
            if sim.playing:
                sim.pose(sim.sample(sim.playhead))
        elif action == 'settings':
            gravity = float(body.get('gravity', sim.gravity))
            friction = float(body.get('friction', sim.friction))
            if not -30 <= gravity <= 0 or not 0 <= friction <= 3:
                raise ValueError('Gravity must be -30 to 0; friction must be 0 to 3')
            fixed = bool(body.get('fixed', sim.fixed))
            if fixed != sim.fixed:
                old = sim.fixed
                frames, targets, mapping = sim.frames, sim.targets.copy(), sim.mapping
                sim.fixed = fixed
                try:
                    sim.load_robot(sim.xml, sim.directory)
                except Exception:
                    sim.fixed = old
                    raise
                sim.frames, sim.mapping = frames, mapping
                sim.pose(targets)
            sim.gravity, sim.friction = gravity, friction
            p.setGravity(0, 0, gravity, physicsClientId=sim.client)
            for link in range(-1, p.getNumJoints(sim.robot, physicsClientId=sim.client)):
                p.changeDynamics(sim.robot, link, lateralFriction=friction, physicsClientId=sim.client)
            p.changeDynamics(sim.ground, -1, lateralFriction=friction, physicsClientId=sim.client)
            sim.configure_rates(body.get('physics_hz', sim.physics_hz), body.get('motion_hz', sim.motion_hz), body.get('direction', sim.direction))
        else:
            raise ValueError('Unknown action')
        return sim.state()


@app.post('/api/frames')
def frames(body: dict):
    runner.ensure_idle()
    with sim.lock:
        sim.set_frames(body['frames'])
        return {'frames': sim.frames}


@app.post('/api/urdf')
def urdf(body: dict):
    runner.ensure_idle()
    with sim.lock:
        sim.load_robot(body['xml'], sim.directory)
        return sim.model()


@app.post('/api/objects')
def add_object(body: dict):
    runner.ensure_idle()
    with sim.lock:
        old = next((o for o in sim.objects if o['id'] == body.get('id')), None)
        new = sim.add_object(body)
        if old:
            p.removeBody(old['body'], physicsClientId=sim.client)
            sim.objects.remove(old)
        return {k: v for k, v in new.items() if k != 'body'}


@app.delete('/api/objects/{object_id}')
def delete_object(object_id: str):
    runner.ensure_idle()
    with sim.lock:
        obj = next((o for o in sim.objects if o['id'] == object_id), None)
        if not obj:
            raise HTTPException(404, 'Object not found')
        p.removeBody(obj['body'], physicsClientId=sim.client)
        sim.objects.remove(obj)
        return {'ok': True}


@app.post('/api/import')
async def import_asset(file: UploadFile = File(...), mode: str = 'replace'):
    runner.ensure_idle()
    if mode not in ('replace', 'add'):
        raise ValueError('Robot import mode must be add or replace')
    content = await file.read(100 * 1024 * 1024 + 1)
    if len(content) > 100 * 1024 * 1024:
        raise HTTPException(413, 'Maximum upload size is 100 MB')
    directory = DATA / uuid.uuid4().hex
    directory.mkdir()
    name = Path(file.filename.replace('\\', '/')).name
    path = directory / name
    suffix = path.suffix.lower()
    if suffix == '.zip':
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            if sum(i.file_size for i in archive.infolist()) > 250 * 1024 * 1024 or len(archive.infolist()) > 1000:
                raise ValueError('ZIP is too large after extraction')
            for member in archive.infolist():
                target = (directory / member.filename.replace('\\', '/')).resolve()
                if not target.is_relative_to(directory):
                    raise ValueError('ZIP contains an unsafe path')
                if not member.is_dir():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(archive.read(member))
        files = list(directory.rglob('*.urdf'))
        if len(files) != 1:
            raise ValueError('Robot ZIP must contain exactly one .urdf file')
        path = files[0]
        with sim.lock:
            if mode == 'add':
                actor = sim.add_actor({'xml': path.read_text(), 'directory': asset_url(path.parent / 'placeholder').rsplit('/', 1)[0], 'name': path.stem})
                return {'kind': 'actor', 'id': actor.actor_id}
            sim.load_robot(path.read_text(), path.parent)
            return {'kind': 'robot'}
    path.write_bytes(content)
    if suffix == '.urdf':
        with sim.lock:
            if mode == 'add':
                actor = sim.add_actor({'xml': content.decode('utf-8-sig'), 'directory': asset_url(directory / 'placeholder').rsplit('/', 1)[0], 'name': path.stem})
                return {'kind': 'actor', 'id': actor.actor_id}
            sim.load_robot(content.decode('utf-8-sig'), directory)
        return {'kind': 'robot'}
    if suffix not in ('.obj', '.stl', '.glb'):
        raise ValueError('Use OBJ, STL, GLB, URDF, or a URDF ZIP')
    # Flatten the mesh into a self-contained OBJ for consistent Bullet collision and display.
    mesh = trimesh.load(str(path), force='mesh', process=False)
    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.vertices) == 0 or not bool(__import__('numpy').isfinite(mesh.vertices).all()):
        raise ValueError('File contains no valid triangle mesh')
    converted = directory / 'collision.obj'
    mesh.export(str(converted), include_texture=False)
    return {'kind': 'mesh', 'url': asset_url(converted), 'name': path.stem, 'bounds': mesh.bounds.tolist(),
            'note': 'Imported geometry; original textures are not retained. Choose metres or millimetres in the inspector.'}


@app.get('/api/project')
def get_project():
    with sim.lock:
        return {'format': 'bittle-studio', 'version': 1, 'xml': sim.xml, 'directory': asset_url(sim.directory / 'placeholder').rsplit('/', 1)[0],
                **{k: v for k, v in sim.model().items() if k in ('objects', 'frames', 'mapping', 'fixed', 'gravity', 'friction', 'targets', 'physics_hz', 'motion_hz', 'direction', 'scripts')},
                'actors': [a.actor_definition() for a in sim.actors.values()]}


@app.post('/api/project')
def load_project(body: dict):
    runner.ensure_idle()
    if body.get('format') != 'bittle-studio' or body.get('version') != 1:
        raise ValueError('Not a Bittle Studio project')
    # Validate the complete project in a separate Bullet world before changing the active one.
    candidate = Simulation()
    try:
        candidate.fixed = bool(body.get('fixed', False))
        directory = (ROOT / body['directory'].lstrip('/')).resolve()
        asset_url(directory / 'placeholder')
        candidate.load_robot(body['xml'], directory)
        candidate.set_frames(body.get('frames', []))
        candidate.pose(body.get('targets', {}))
        candidate.mapping = body.get('mapping', candidate.mapping)
        candidate.scripts = validate_scripts(body.get('scripts', []))
        candidate.configure_rates(body.get('physics_hz', 240), body.get('motion_hz', 50), body.get('direction', 'forward'))
        for definition in body.get('actors', []):
            candidate.add_actor(definition)
        for obj in body.get('objects', []):
            candidate.add_object(obj)
        candidate.gravity = float(body.get('gravity', -9.81))
        candidate.friction = float(body.get('friction', .8))
        if not -30 <= candidate.gravity <= 0 or not 0 <= candidate.friction <= 3:
            raise ValueError('Invalid physics settings')
        p.setGravity(0, 0, candidate.gravity, physicsClientId=candidate.client)
        p.changeDynamics(candidate.ground, -1, lateralFriction=candidate.friction, physicsClientId=candidate.client)
        for i in range(-1, p.getNumJoints(candidate.robot, physicsClientId=candidate.client)):
            p.changeDynamics(candidate.robot, i, lateralFriction=candidate.friction, physicsClientId=candidate.client)
        with sim.lock:
            old_client = sim.client
            for key, value in candidate.__dict__.items():
                if key not in ('lock', 'closed'):
                    setattr(sim, key, value)
            p.disconnect(old_client)
        return sim.model()
    except Exception:
        p.disconnect(candidate.client)
        raise


@app.post('/api/export')
def export_motion(body: dict):
    with sim.lock:
        script, mapping, metadata = python_motion(sim, body)
        sim.mapping = mapping
        return PlainTextResponse(script)


@app.post('/api/motion-code')
def motion_code(body: dict):
    with sim.lock:
        script, mapping, metadata = python_motion(sim, body, hardware=False)
        return {'source': script, 'metadata': metadata}


@app.post('/api/motion-samples')
def motion_samples(body: dict):
    """Return verified servo-space samples for an explicit browser hardware action."""
    with sim.lock:
        samples, mapping, metadata = build_motion(sim, body, hardware=True)
        sim.mapping = mapping
        checkpoint()
        return {'samples': samples, 'metadata': metadata}


@app.get('/api/scripts')
def scripts():
    return {'files': sim.scripts, **runner.status()}


@app.put('/api/scripts')
def save_scripts(body: dict):
    files = validate_scripts(body['files'])
    with sim.lock:
        sim.scripts = files
        checkpoint()
    return {'files': files}


@app.post('/api/scripts/run')
def run_scripts(body: dict):
    return runner.start(body.get('ids'), body.get('physics', False), body.get('timeout', 120))


@app.post('/api/scripts/stop')
def stop_scripts():
    runner.stop()
    return runner.status()


@app.post('/api/actors')
def add_actor(body: dict):
    runner.ensure_idle()
    with sim.lock:
        if body.get('duplicate_main'):
            body = {'xml': sim.xml, 'directory': asset_url(sim.directory / 'placeholder').rsplit('/', 1)[0],
                    'name': 'Bittle copy', 'position': [.35, 0, .2]}
        return sim.add_actor(body).actor_definition(True)


@app.post('/api/actors/{actor_id}')
def edit_actor(actor_id: str, body: dict):
    runner.ensure_idle()
    with sim.lock:
        old = sim.actors[actor_id]
        definition = {**old.actor_definition(), **body}
        definition.pop('id', None)
        new = sim.add_actor(definition)
        sim.actors.pop(new.actor_id)
        new.actor_id = actor_id
        sim.actors[actor_id] = new
        p.removeBody(old.robot, physicsClientId=sim.client)
        return new.actor_definition(True)


@app.delete('/api/actors/{actor_id}')
def delete_actor(actor_id: str):
    runner.ensure_idle()
    with sim.lock:
        actor = sim.actors.pop(actor_id)
        p.removeBody(actor.robot, physicsClientId=sim.client)
    return {'ok': True}


app.mount('/web', StaticFiles(directory=ROOT / 'web'), name='web')
app.mount('/assets', StaticFiles(directory=ROOT / 'assets'), name='assets')
app.mount('/data', StaticFiles(directory=DATA), name='data')
app.mount('/vendor', StaticFiles(directory=ROOT / 'node_modules/three'), name='vendor')

if __name__ == '__main__':
    AUTOSAVE = True
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=8765)
