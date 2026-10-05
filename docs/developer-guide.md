# Developer guide

How Bittle Studio is organised, and how to change it safely. For using the app, see the [user guide](user-guide.md).

## Big picture

```
browser (app/web)  ──HTTP──▶  app/server.py (FastAPI)  ──▶  app/engine.py (PyBullet world)
      │                              │
      │                              └──▶ motion_export.py, skills.py, scripting.py, packs.py
      │
      └── app/web/bittle-link  ──Web Bluetooth / Web Serial──▶  Petoi Bittle (OpenCat firmware)
```

- The **Studio** is a local web app. `app/launcher.py` starts `server.py` on http://127.0.0.1:8765 and opens the browser. The server owns the simulation and the project; the browser draws it with three.js and sends edits back.
- **Bittle Link** (`app/web/bittle-link/`) talks to the real robot straight from the browser. It has no dependency on the Studio, so it also runs on its own: through `app/bittle_link.py` (port 8770) or as static files on GitHub Pages.
- In the Studio every robot control drives the simulator, and also the robot when one is connected (`app/web/hardware.js`). With no robot, the same commands go through a test-mode link so the serial monitor can show them (marked "simulator only").

## Repository layout

| Folder | Contents | In git? |
|---|---|---|
| `launchers/` | Double-click launchers per system: `windows/` (`.cmd`), `mac/` (`.command`), `linux/` (`.sh`). They stay thin and call `app/install.py`, `app/launcher.py` or `app/bittle_link.py`. | yes |
| `app/` | All source code: the Python server and simulation, the web front end, tests and dependency lists. | yes |
| `app/web/` | Studio front end. Plain ES modules and CSS, no build step. | yes |
| `app/web/bittle-link/` | **Bittle Link**: robot connection, console, serial monitor and its standalone page. | yes |
| `app/tests/` | Automated tests (`unittest`) and their fixtures. | yes |
| `app/tools/` | One-off maintenance scripts (see [Petoi skill data](#petoi-skill-data)). | yes |
| `robot-models/` | Bundled robot models (URDF + meshes). Served as `/assets/...`. | yes |
| `saved-motions/` | Bittle Link packs (`*.json`). Served as `/saved-motions/...` by both servers. | yes |
| `dev-tools/` | For developers: `run-tests.cmd` / `run-tests.sh` and `build_pages.py` (the GitHub Pages site). | yes |
| `docs/` | User and developer documentation. | yes |
| `.github/workflows/` | `pages.yml`: builds and deploys the GitHub Pages site on every push to `master`. | yes |
| `user-data/` | Runtime data: imported meshes and robots, `studio-session.json` autosave, Python run folders. Served as `/data/...`. Created automatically, and an older `data/` folder is renamed to it on first start. | no |
| `.venv/`, `app/node_modules/` | Installed Python packages and the three.js library, created by the Setup launchers (`app/install.py`). | no |

The URL prefixes `/assets` and `/data` are stored inside saved projects, so they stay fixed even if the folders move on disk. `app/engine.py` defines the mapping in `URL_ROOTS`, and `url_path()` converts such a URL back to a disk path.

## Python modules (`app/`)

| File | Role |
|---|---|
| `server.py` | The FastAPI app: import pipeline, project serialisation, saved functions, console buttons, pack export, simulator skills, Python export, scripts, voice session. Started by `launcher.py`. |
| `engine.py` | Bullet world: URDF/Xacro loading and diagnostics, collision objects, motor control, interpolation, skill playback and state. Defines the folder constants `ROOT`, `PROJECT`, `ASSETS`, `DATA` and `SAVED_MOTIONS`. |
| `skills.py` | Turns console commands (`ksit`, `kwkF`, `m 0 30`, `i 8 20`, `d`) into simulator plans, from `petoi_skills.json` and the Servo setup mapping. Commands without a joint effect return `None`. |
| `motion_export.py` | Timeline sampling, `PetoiRobot` Python script export and firmware skill (`K`) compilation. |
| `scripting.py`, `script_worker.py` | The Python code panel runner (one child process per target). |
| `packs.py` | Bittle Link pack validation, listing and saving. **Standard library only**, so `bittle_link.py` can use it too. |
| `voice_tools.py` | Tool definitions for the optional voice companion. |
| `launcher.py` | Starts `server.py` (or reuses a running one) and opens the browser. |
| `bittle_link.py` | Stdlib-only server for the standalone console (port 8770) and the `saved-motions/` folder. |
| `install.py` | Stdlib-only installer behind every Setup/Update launcher: creates `.venv`, installs `requirements.txt`, and downloads three.js from the npm registry, verified against `package-lock.json`. Node.js is not needed. |
| `requirements.txt` | Pinned Python packages. |
| `package.json`, `package-lock.json` | Pin the three.js version. `install.py` reads only the lock file; developers with Node.js can still run `npm ci --prefix app`. |

## Front end (`app/web/`)

| File | Role |
|---|---|
| `index.html` | The Studio page: top bar, Stage, viewport, timeline, inspector and dialogs. |
| `app.js` | Studio core: three.js viewport, scene editing, timeline, inspector, panel layout and the server API helper. |
| `hardware.js` | Studio glue for Bittle Link: the unified `control` object (simulator + robot), the function library, sequence exports, Servo setup feedback and the serial monitor window. |
| `code-panel.js` | The Python code panel (loaded on demand). |
| `voice.js` | The optional voice companion (WebRTC session through `/api/voice/session`). |
| `style.css`, `studio.css`, `workspace.css`, `placement.css`, `code.css`, `hardware.css` | Styles: base theme, compact workspace, window/panel layout, robot placement, code panel and robot control. |

## Bittle Link module (`app/web/bittle-link/`)

It imports nothing from the rest of the Studio. The Studio's robot control (`hardware.js`) is built on it, and `index.html` with `app.js` host it standalone.

| File | Role |
|---|---|
| `link.js` | `createLink()` returns the transport and protocol object (no DOM code). `connect('ble' \| 'serial' \| 'test')`, `sendCommand`, `sendPose` (binary `I`), `uploadSkill` (binary `K`), `sendSkill`, `runSkill`, `runSequence`, `press` (with the `fp`/`fP`/`#on` macros), `stop`, `setDeveloperMode`, `cancelStream`, and the `playbackMode` property (`'stream'` or `'upload'`). Events: `log`, `state`, `tx`, `rx`, `joints`. |
| `console.js` | `initConsole(element, {link, store, library, tools, ...})` draws the controller (Move, Postures, Skills, My skills, Buttons, Robot settings) into any element. The host decides where buttons are stored (`store`) and how Studio functions become firmware skills (`library`). |
| `serial-monitor.js` | `initSerialMonitor(element, {link, offlineSend})`: every command sent, with its source and a plain-language meaning, plus the robot's replies. `attachPreview(link)` adds a simulator-only link whose rows are marked "not sent". |
| `joint-layout.js` | Joint sliders laid out like Petoi's Skill Composer, shared by the console (servo degrees) and the Studio's pose inspector (simulation degrees). |
| `pack.js` | The pack format, browser-side validation (the same rules as `packs.py`), local storage for the standalone page and the `saved-motions/` folder helpers (relative URLs, so it also works below a GitHub Pages sub-path). |
| `catalog.js` | The Petoi skill catalog (codes, Dutch labels, which ones loop). Used for suggestions in the button editor and names in the serial monitor. |
| `app.js`, `index.html`, `base.css` | The standalone page. |
| `console.css`, `serial-monitor.css` | Styles shared by both hosts. They use the host's `--line`, `--accent`, `--muted` and `--text` tokens. |

A pack is `{format: 'bittle-link-pack', version: 1, name, controls: [...], skills: [{id, name, type, signature, hz, skill}]}`. Buttons refer to skills by id through `{kind: 'motion', motion_id}` steps, exactly as they do inside the Studio.

### Talking to the robot

- Text commands (`ksit`, `m 0 30`, `d`, `j`...) end with a newline. Binary `I` (joint angles) and `K` (a whole skill) start with their letter and end with `~`. Over Bluetooth every write is split into 20-byte packets, so `I` with Bittle's 9 joints fits exactly one packet.
- Saved functions are **streamed** by default: each frame is one `I` packet on the function's own timing (`hz`). **Upload** mode sends one `K` packet instead, replayed later with `T`.
- The firmware prints servo feedback to USB only, so reading positions sends `f` and then `j`, whose reply reaches every port.
- **Test mode** runs the whole protocol without a robot: writes are logged, and `j` is answered with the last angles sent.

## HTTP API (`server.py`)

Angles are degrees at the API boundary; transforms use metres and xyzw quaternions. Request and response bodies are JSON.

| Area | Endpoints |
|---|---|
| Simulation | `GET /api/model`, `GET /api/state`, `POST /api/command` (e.g. `{"action":"pose","pose":{"left-front-shoulder-joint":20}}`; start dynamics with `{"action":"run","value":true}`), `POST /api/skill` (play a console command or saved function in the simulator; `T` replays the last one), `POST /api/robot-transform` |
| Scene | `POST /api/urdf`, `POST /api/import` (file upload), `POST /api/objects`, `DELETE /api/objects/{id}`, `POST /api/sensors`, `DELETE /api/sensors/{target}/{id}`, `POST /api/actors`, `POST /api/actors/{id}`, `POST /api/actors/{id}/ground`, `DELETE /api/actors/{id}` |
| Project | `GET /api/project`, `POST /api/project`, `POST /api/frames` (timeline), `POST /api/mapping` (Servo setup) |
| Saved functions | `GET /api/motions`, `POST /api/motions`, `DELETE /api/motions/{id}`, `POST /api/motions/{id}/load`, `/skill` (firmware skill with `hz`), `/samples`, `/export` (Python script) |
| Timeline exports | `POST /api/motion-code`, `POST /api/motion-samples`, `POST /api/motion-skill`, `POST /api/export`, `POST /api/motion-sequence/export` |
| Console buttons | `GET /api/controls`, `PUT /api/controls`, `POST /api/controls/pack` with `{mapping}` (buttons plus every saved function as a pack) |
| Packs (both servers) | `GET /saved-motions/index.json`, `GET /saved-motions/<file>.json`, `POST /saved-motions/save` with `{name, pack}` (local pages only) |
| Python scripts | `GET /api/scripts`, `PUT /api/scripts`, `POST /api/scripts/run`, `POST /api/scripts/stop` |
| Voice | `GET /api/voice/config`, `POST /api/voice/key`, `DELETE /api/voice/key`, `POST /api/voice/session` |

Stop timeline playback before sending external controller targets.

## Petoi skill data

`app/petoi_skills.json` holds Petoi's built-in skills, so the simulator can play them. It is generated from OpenCatEsp32's `src/InstinctBittleESP.h` (MIT, see `app/petoi_skills.LICENSE`) with:

```bash
python app/tools/import_petoi_skills.py path/to/InstinctBittleESP.h [commit]
```

## GitHub Pages site

`dev-tools/build_pages.py` writes `_site/`: a landing page, a copy of Bittle Link and a read-only copy of `saved-motions/`. `.github/workflows/pages.yml` runs it and deploys on every push to `master`. Build it locally with `python dev-tools/build_pages.py`.

## Testing changes

Double-click `dev-tools/run-tests.cmd` (Windows) or run `dev-tools/run-tests.sh` (Mac/Linux). Or run the Python tests directly:

```bash
.venv/Scripts/python.exe -m unittest discover -s app/tests -t app -v     # Windows
.venv/bin/python -m unittest discover -s app/tests -t app -v             # Mac/Linux
```

The scripts also run `node --check` on every file in `app/web` when Node.js is installed. For anything touching the robot connection, use **Test mode** in the Studio or in Bittle Link: it logs every command that would have been sent, without a robot.
