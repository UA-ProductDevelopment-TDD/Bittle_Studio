# Developer guide

How Bittle Studio is organised, and how to change it safely. For using the app, see the [user guide](user-guide.md).

## Repository layout

| Folder | Contents | In git? |
|---|---|---|
| `app/` | All source code: the Python server and simulation, the web front end, tests and dependency lists. | yes |
| `app/web/` | Studio front end: viewport, scene editor, timeline, inspector, Bluetooth dialog. Plain ES modules; no build step. | yes |
| `app/web/bittle-link/` | **Bittle Link**: the robot connection and console module, plus its standalone page. | yes |
| `app/tests/` | Automated tests (`unittest`). | yes |
| `robot-models/` | Bundled robot models (URDF + meshes). Served as `/assets/...`. | yes |
| `saved-motions/` | Bittle Link packs (`*.json`). Served as `/saved-motions/...` by both servers. | yes |
| `scripts/` | Helper `.cmd` files for tests and updates. | yes |
| `docs/` | User and developer documentation. | yes |
| `user-data/` | Runtime data: imported meshes and robots, `studio-session.json` autosave, Python run folders. Served as `/data/...`. Created automatically, and an older `data/` folder is renamed to it on first start. | no |
| `.venv/`, `app/node_modules/` | Installed Python and npm packages, created by `setup.cmd`. | no |

The URL prefixes `/assets` and `/data` are stored inside saved projects, so they stay fixed even if the folders move on disk. `app/engine.py` defines the mapping in `URL_ROOTS`, and `url_path()` converts such a URL back to a disk path.

## Python modules (`app/`)

- `engine.py`: Bullet world, URDF/Xacro loading and diagnostics, collision objects, motor control, interpolation and state. It also defines the folder constants `ROOT`, `PROJECT`, `ASSETS`, `DATA` and `SAVED_MOTIONS`.
- `server.py`: the local FastAPI app. It covers the import pipeline, project serialisation, the saved function library, console buttons, pack export, the voice session endpoint and Python export. Start it with `app/launcher.py`.
- `motion_export.py`: timeline sampling, `PetoiRobot` script export and firmware skill (`K`) compilation.
- `scripting.py`, `script_worker.py`: the Python code panel runner (one child process per target).
- `packs.py`: Bittle Link pack validation, listing and saving. It uses the **standard library only**, so the lightweight console server can use it too.
- `bittle_link.py`: stdlib-only server for the standalone console (port 8770).
- `voice_tools.py`: tool definitions for the optional voice companion.

## Bittle Link module (`app/web/bittle-link/`)

It imports nothing from the rest of the Studio. Studio's Bluetooth dialog (`app/web/hardware.js`) is built on it, and `index.html`/`app.js` host it standalone.

- `link.js`: `createLink()` returns the transport and protocol object. It has `connect('ble' | 'serial' | 'test')`, `sendCommand`, `sendPose`, `sendSkill`, `runSkill`, `runSequence`, `press`, `stop` and `setDeveloperMode`. It emits `log` and `state` events and contains no DOM code.
- `console.js`: `initConsole(element, {link, store, library, tools})` draws the controller into any element. The host decides where buttons are stored (`store`) and how Studio functions become firmware skills (`library`).
- `pack.js`: the pack format, browser-side button validation (the same rules as `packs.py`), local storage for the standalone page, and the `saved-motions` folder helpers.
- `catalog.js`: the Petoi skill catalog. `app/web/petoi-skills.js` re-exports it for voice.

A pack is `{format: 'bittle-link-pack', version: 1, name, controls: [...], skills: [{id, name, type, signature, skill}]}`. Buttons refer to skills by id through `{kind: 'motion', motion_id}` steps, exactly as they do inside the Studio.

## HTTP API

- **Simulation:** `GET /api/model`, `GET /api/state`, `POST /api/command` with `{"action":"pose","pose":{"left-front-shoulder-joint":20}}`. Start dynamics with `{"action":"run","value":true}`. Stop timeline playback before sending external controller targets. Angles are degrees at the API boundary; transforms use metres and xyzw quaternions.
- **Console buttons:** `GET /api/controls` and `PUT /api/controls`. `POST /api/controls/pack` with `{mapping}` compiles the buttons plus every saved motion into a pack.
- **Packs** (on both servers): `GET /saved-motions/index.json`, `GET /saved-motions/<file>.json` and `POST /saved-motions/save` with `{name, pack}`.

## Testing changes

Double-click `scripts/run-tests.cmd`, or run:

```bash
.venv/Scripts/python.exe -m unittest discover -s app/tests -t app -v
```

The script also runs `node --check` on every file in `app/web`. For anything touching the robot connection, use **Test mode** in the Studio or in Bittle Link. It logs every command that would have been sent, without a robot.
