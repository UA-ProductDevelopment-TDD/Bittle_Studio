# Bittle Studio

A local robotics workbench for your Bittle URDF, with a Three.js viewport and a real PyBullet simulation. Files and simulation stay on your computer. No account or cloud service is required.

## Start

Double-click **launch.cmd**, then keep its terminal window open. The app opens at **http://127.0.0.1:8765**. Close it with Ctrl+C in the terminal. Dependencies are already installed in this checkout.

For another computer, install Python 3.11 and Node.js, then run `setup.cmd` once. Python 3.11 has a prebuilt Bullet wheel; Python 3.12 may require Microsoft's C++ build tools. Copy the entire workspace, including the `assets` folder. The `.venv` environment is machine-specific and should be recreated.

## First experiment

1. Use **Pose** to adjust the eight joints. Choose time `0` and **Add keyframe**.
2. Change time to `2`, choose another pose, and add a second keyframe. **Play motion** previews the transition. Click a frame to select it; saving at the same time replaces it. Smooth and linear interpolation are available.
3. Add a box, ramp, sphere, or steps. Select it in the scene or viewport, then edit its position, rotation, dimensions, mass and friction. Drag the viewport transform arrows to move an object while physics is paused.
4. **Run physics** enables gravity, collision response and joint motors. Play the timeline while physics runs to test motor-driven motion. **Pin robot base** is useful for bench tests. **Reset** resets body velocities and obstacle transforms, and returns to the first keyframe when present.
5. **Save project** downloads JSON with the URDF, object definitions, animation, physics settings and servo mapping. **Open project** restores it. Imported mesh files remain under `data/`; project JSON is not a portable asset bundle. Keep `data/` and `assets/` alongside the application and back them up with your saved projects.

Keyboard: **F** focuses the robot; **Space** plays/pauses motion outside text fields. Orbit with left-drag, pan with right-drag, zoom with the wheel.

## Import and edit

- Environment geometry: **OBJ, STL, GLB**. Geometry is flattened to OBJ; source textures/materials are replaced by the inspector's surface colour. Use mesh scale `0.001` on all axes for files authored in millimetres. Default units are metres and Z is up; rotate Y-up imports in the inspector.
- Static mesh collision uses the triangle mesh. Dynamic meshes use Bullet's convex hull, so cavities/concavities will not collide exactly. Primitive boxes and spheres use exact primitive collision shapes.
- Robot: import a **ZIP containing exactly one URDF** and its mesh folders. Relative paths must resolve within the ZIP structure. `package://robot/meshes/...` resolves to `robot/meshes/...` relative to the URDF directory. Primitive-only URDFs can be uploaded without ZIP.
- URDF renderer supports mesh, box, sphere and cylinder visuals; mesh loaders cover OBJ, STL, DAE, GLB and GLTF. Bullet's own URDF mesh support is narrower; OBJ or STL is recommended for robot imports. Unsupported files produce an error instead of substituting a different model.
- The **Model** tab exposes the URDF source. Edit joint limits, axes, mass, origins and geometry, then validate/apply. This replaces the simulated robot and clears its timeline; save your project first if retaining that animation matters. Download URDF saves the editor contents and does not bundle meshes.
- Current pose controls support revolute joints. Other joint types are reported in diagnostics.

## Export to the real robot

**Export motion** produces a standalone Python script using the official `PetoiRobot` API and simultaneous `I` joint commands. It samples the same timeline interpolation at the selected Motion Hz (50 Hz by default). The original exporter incorrectly used sequential `M`; new exports correct that. Half-speed export is the default.

Suggested servo indices are LF/RF/RB/LB shoulders 8/9/10/11 and knees 12/13/14/15. **Direction and offset are not calibrated.** Verify each joint against your real robot, set its direction and offset, and tick Verified. Export rejects unverified/duplicate indices and angles outside ±125°. This numerical bound is not a physical safety guarantee.

Install `PetoiRobot` in the Python environment used to run the downloaded file. Running `python bittle_motion.py` prints a dry run without connecting. `python bittle_motion.py --execute` connects, pauses before sending the initial pose, and asks for another check before playback. Ctrl+C stops sending targets and closes the port; the robot retains its last target. No commands are sent to hardware by this web application.

References: [Petoi Python API](https://docs.petoi.com/apis/python-api), [serial protocol](https://docs.petoi.com/apis/serial-protocol), [skill data format](https://docs.petoi.com/applications/skill-creation). Inspiration: [Petoi Bittle X simulator](https://bittlex-sim.petoi.com/).

## Physics assumptions and limits

- Configurable Physics Hz (60–1000, default 240); 80 solver iterations. Motion Hz (1–240, default 50) sets timeline target updates and the export sample rate independently. The browser polls transforms independently and shows the actual Bullet link transforms. Actual wall-clock performance depends on scene complexity.
- Position motors use each URDF joint's effort and velocity limits. In pose mode, joints are placed directly, which is an animation preview rather than a physical result.
- Supplied link masses are retained. Bullet computes inertia from collision geometry. The supplied Bittle file has multiple nonphysical inertia tensors; diagnostics report these. The original file under `C:/Nvidea_Omniverse/Robots/Bittle_URDF_scaled` is untouched; the bundled copy only corrects mesh paths.
- Self-collision is enabled except between parent and child links. Ground friction is editable, as is each environment object's friction. No spring compliance, servo backlash, motor electronics, battery limits, balance controller or sensor noise is modelled.
- The supplied mesh set has 13 visual links and no head model; this application renders those supplied assets. It does not invent missing geometry.
- The crouch example is a pose study, not a validated walking gait. Simulated motion does not guarantee balance or safe transfer to hardware. No real Bittle was connected or tested during development.
- This is an initial workbench, not Blender feature parity: no inverse-kinematics foot handles, curve editor, texture authoring, native OpenCat firmware skill export, or direct hardware streaming yet. Multiple Python controllers and multiple URDFs are supported.
- One local shared simulation per server. Multiple browser tabs operate on the same world. The server binds to loopback; do not expose it to a network as a multi-user service.

## Development

- `engine.py`: Bullet world, URDF loading/diagnostics, collision objects, motor control, interpolation and state.
- `server.py`: local API, import pipeline, project serialization and Python export.
- `web/`: viewport, scene editor, timeline and inspector; no build step.
- `tests/test_workbench.py`: end-to-end physics and API checks.

Run `.venv/Scripts/python.exe -m unittest discover -s tests -v` and `node --check web/app.js`.

The built-in Python panel supports controllers directly (see below). External controllers can also use the API: `GET /api/model`, `GET /api/state`, `POST /api/command` with `{"action":"pose","pose":{"left-front-shoulder-joint":20}}`. Start dynamics with `{"action":"run","value":true}`. Stop timeline playback before sending external controller targets. Angles are degrees at the API boundary; transforms use metres and xyzw quaternions.

## Asset attribution

The bundled robot was copied from the user's Bittle URDF directory. Its original README and GPL license are preserved as `assets/bittle/SOURCE.md` and `assets/bittle/LICENSE`. The upstream README attributes meshes to a third-party reverse-engineered GrabCAD design; inspect those terms before redistribution. Three.js and other dependencies retain their own licenses.


## Python workspace and motion timing

Open **Python code** in the header. The viewport remains above the editor.

- **Motion Hz** in the timeline changes target-update frequency. **Physics Hz** under World physics changes Bullet's step rate. **Order → First → last** is the default; reverse is explicit. **Start** begins at the correct endpoint, while Play resumes from the cursor.
- Export has its own Hz, speed and order controls, initialized from the timeline. New samples are chronological, include both endpoints, and use Petoi's simultaneous `I` command. Increasing Hz cannot force a serial connection or firmware to keep up: the generated script reports achieved throughput. Integer servo angles remain quantized to degrees.
- **Timeline → Python** creates the actual exported source in the editor. **Test this Python in simulation** in the export dialog does the same with that dialog's settings and mapping. The resulting source is an editable file, not a separate timeline approximation.
- Create files with **+ File**, or import one or several `.py` files. Rename them in the filename field. Import helper modules normally, e.g. `from helper import gait`. Uncheck helpers so they are not launched as entry points.
- Pick a **Target** for each entry point: the main Bittle, an additional URDF robot, or a scene object. **Run file** starts only the selected file. **Run checked** starts up to eight files together, on different targets. Only one process per target can run at once; compose same-target behaviours through imports. Each process has its own module globals.
- **Physics** chooses motor-driven dynamics versus direct pose preview. Normal `time.sleep`, `time.monotonic`, and `time.perf_counter` use the simulation clock in the runner, so a slow simulation does not cause wall-clock scheduling to skip ahead. Unsupported firmware APIs fail explicitly.
- The console shows output, tracebacks, completion and timeout status. **Stop all** kills the runner processes and pauses physics. Reset does the same before resetting the world. Run limit is adjustable from 1 to 3600 wall-clock seconds. Changing a model/world or timeline while scripts run is rejected until Stop.
- The installed app checkpoints the complete current project when Python files are saved (including automatic saves after editing), and restores that checkpoint on the next launch. No code auto-runs on startup. Continue using **Save project** to create named, portable JSON backups; mesh assets still require the accompanying `assets/` and `data/` folders. Saved checkpoints are in `data/studio-session.json`.

### Additional robots

Choose **URDF import → Add another robot** before importing a URDF/ZIP, or click **Add Bittle copy**. This adds another independently simulated body to the same world, including collisions with other bodies. Select it in Scene to edit its URDF, position, rotation or pinned-base setting. **Write code for this robot** makes a starter controller attached to it. Scene objects offer the same shortcut. The keyframe timeline still belongs to the main Bittle.

### Controller API

```python
from bittle_sim import ctx
import math

state = ctx.get_state()
print(state['joint_names'])
rate = ctx.rate(50)
for frame in range(150):
    angle = 15 * math.sin(2 * math.pi * frame / 150)
    ctx.set_joints({'left-front-shoulder-joint': angle})
    rate.sleep()
```

`ctx.get_state()` returns position, rotation, time, joint names, measured joint angles and target angles. `ctx.set_joints()` takes named angles in degrees. `ctx.set_position([x,y,z], [roll,pitch,yaw])` teleports the assigned target (metres and radians), useful for kinematic obstacle tests. `ctx.apply_force([fx,fy,fz])` applies a world-frame force at the base centre of mass for one physics step; use a dynamic body and enable physics. `ctx.sleep(seconds)`, `ctx.time()` and `ctx.rate(hz).sleep()` provide simulation timing.

### Petoi compatibility and execution boundary

Within the code panel, imports of `PetoiRobot` resolve to a simulation adapter supporting `autoConnect`, `openPort`, `closePort`, `rotateJoints`, `absValList`, `getAngle` and `getAngleList`. Exported files run as entry points with `--execute`, and their interactive prompts are acknowledged in the console. Their `STUDIO_MAPPING` is used to invert servo-space angles back to URDF angles. Old exports without embedded mapping use the target's saved mapping. Legacy `M` calls are accepted with a diagnostic, but their firmware-specific sequential timing is **not** emulated; regenerate them to use `I`.

The adapter makes no serial connection. This is ordinary trusted local Python in a child process, **not a security sandbox**: arbitrary user code can use filesystem/network APIs or import other installed packages. Only execute code you trust. Stop kills the runner process, not arbitrary subprocesses deliberately spawned by user code. Firmware behaviours, sensor APIs, motor electronics, serial throughput and hardware calibration are not emulated.

The command correction is grounded in [Petoi's command definitions](https://github.com/PetoiCamp/OpenCat-Quadruped-Robot/blob/main/src/OpenCat.h): `I` is indexed simultaneous binary, `M` is indexed sequential binary.
