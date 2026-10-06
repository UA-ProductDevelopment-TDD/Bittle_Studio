# Bittle Studio user guide

The complete reference for every panel. For a quick start, see the [README](../README.md).

## Install and start

Open the `launchers` folder, then the folder for your system, and start **Start Bittle Studio** (see the README for Windows, Mac and Linux). Keep its terminal window open. The app opens at **http://127.0.0.1:8765**. Close it with Ctrl+C in the terminal.

For another computer, install Python 3.11 or 3.12, then run the **Setup** launcher for that system once (Node.js is not needed). If the physics package (pybullet) has no ready-made download for that computer, Setup builds it, which needs Microsoft's C++ build tools on Windows, `xcode-select --install` on a Mac, or `build-essential` on Linux. Copy the entire workspace, including the `robot-models` and `saved-motions` folders. The `.venv` environment is machine-specific and should be recreated.

## First experiment

1. Use **Pose** to adjust the nine joints (four shoulders, four knees and the neck). Choose time `0` and **Add keyframe**.
2. Change time to `2`, choose another pose, and add a second keyframe. **Play motion** previews the transition. Click a frame to select it; saving at the same time replaces it. Smooth and linear interpolation are available.
3. Add a box, ramp, sphere, or steps. Select it in the scene or viewport, then edit its position, rotation, dimensions, mass and friction. Objects and the main Bittle can be moved with the viewport transform arrows while physics is paused. Select Bittle and choose **Move XYZ** or **Rotate XYZ**; its placement becomes the position used by Reset.
4. **Run physics** enables gravity, collision response and joint motors. Play the timeline while physics runs to test motor-driven motion. **Pin robot base** is useful for bench tests. **Reset** resets body velocities and obstacle transforms, and returns to the first keyframe when present.
5. **Save project** downloads JSON with the URDF, object definitions, animation, physics settings and servo mapping. **Open project** restores it. Imported mesh files remain under `user-data/`; project JSON is not a portable asset bundle. Keep `user-data/` and `robot-models/` alongside the application and back them up with your saved projects.

Keyboard: **F** focuses the robot; **Space** plays/pauses motion outside text fields. Orbit with left-drag, pan with right-drag, zoom with the wheel.

The workspace uses a compact Isaac Sim-inspired charcoal layout: the Stage on the left, the viewport and the Motion timeline (with your saved Functions beside it) in the middle, and Robot control at full height on the right. Stage search filters robots and objects; expand **Create & import** or **World physics** for their controls. Panels scroll independently on desktop and stack below the viewport on screens up to 700 px wide. Close Stage, Inspector, Timeline or Python with the **×** in its heading. Open it again from **Window** in the top bar; the chosen layout is remembered in this browser. **Window → Reset workspace** restores the standard layout. **Edit robot** opens one Robot Editor for the selected robot's complete structure, sensors and URDF source.

## Import and edit

- Environment geometry: **OBJ, STL, GLB**. Geometry is flattened to OBJ; source textures/materials are replaced by the inspector's surface colour. Use mesh scale `0.001` on all axes for files authored in millimetres. Default units are metres and Z is up; rotate Y-up imports in the inspector.
- Static mesh collision uses the triangle mesh. Dynamic meshes use Bullet's convex hull, so cavities/concavities will not collide exactly. Primitive boxes and spheres use exact primitive collision shapes.
- Robot: import a **ZIP containing one URDF or Xacro robot source** and its mesh folders. Xacro macros and expressions are expanded during import; Gazebo, transmission and `ros2_control` blocks are ignored because Bullet does not execute their plugins. ROS `package://name/...` paths resolve through the bundle's `package.xml`, including packages whose ZIP folder has a different name. Primitive-only URDF or Xacro files can be uploaded directly.
- URDF renderer supports mesh, box, sphere and cylinder visuals; mesh loaders cover OBJ, STL, DAE, GLB and GLTF. Bullet's own URDF mesh support is narrower; OBJ or STL is recommended for robot imports. Unsupported files produce an error instead of substituting a different model.
- **Edit robot → URDF source** exposes the selected robot's complete definition. Edit joint limits, axes, mass, origins and geometry, then validate/apply. Applying resets that robot's timeline, while sensors attached to links that still exist are retained. Download saves the editor contents and does not bundle meshes. The inspector's Model and Robot+ tabs remain as quick source editors.
- Current pose controls support revolute joints. Other joint types are reported in diagnostics.

## Export to the real robot

**Python** on a saved function (or **Export selected ↗** for several, in the Functions column next to the timeline) produces a standalone Python script using the official `PetoiRobot` API and simultaneous `I` joint commands. Choose a motion type before generating it: **Pose** sends the currently displayed pose once, **Behavior** plays the timeline once, and **Gait** repeats the timeline until Ctrl+C. Studio's direct hardware player has its own stop button. The visible repeat checkbox follows this choice. Export samples the same timeline interpolation at the selected Motion Hz (50 Hz by default). Half-speed export is the default.

Suggested servo indices are the neck (head pan) 0, LF/RF/RB/LB shoulders 8/9/10/11 and knees 12/13/14/15. A positive neck angle turns the head left, like OpenCat's `m 0 30`; if your head turns the other way, set the neck's direction to −1. **Direction and offset are not calibrated.** Verify each joint against your real robot, set its direction and offset, and tick Verified. Export rejects unverified/duplicate indices and angles outside ±125°. This numerical bound is not a physical safety guarantee.

Install `PetoiRobot` in the Python environment used to run the downloaded file. Running `python bittle_motion.py` prints a dry run without connecting. `python bittle_motion.py --execute` connects, pauses before sending the initial pose, and asks for another check before playback. Ctrl+C stops a gait and closes the port; the robot retains its last target.

## Bluetooth and direct robot testing

Click **Bluetooth** in the header. The panel supports the same Petoi connection choices used by the Bittle AI voice project:

- **Bluetooth BLE** connects directly to the Petoi Nordic UART service. Choose Bittle or Petoi in the browser device picker.
- **Bluetooth / USB serial** opens a browser-selected serial port at 115200 baud. Pair a classic Bluetooth module in Windows first, then choose its outgoing COM port.
- **Test mode** exercises the complete playback path and logs packets without sending anything to a robot.

Verify all servo indexes, directions and offsets in **Servo setup** (top bar) before using hardware playback. Each row has a **Test** button that moves the simulated joint and the real servo +10° and back, so you can compare them; changes are saved immediately. The top bar always shows the connection state, and a red **Stop** (or the **Esc** key) stops the robot whenever it is connected. The Bluetooth panel docks on the right so the 3D view stays visible. The hardware panel can upload the displayed pose, play a behavior once, or repeat a gait until **Stop** is pressed. Stop requests `kbalance`.

Studio converts the timeline to an OpenCat firmware skill and uploads it with the binary `K` command. The first run transfers and executes the complete skill; the firmware stores it in its last-skill slot. Repeating the unchanged motion sends only `T`, avoiding continuous Bluetooth frame traffic and its resulting jitter. OpenCat exposes this uploaded slot as `T`, so the friendly name remains in Studio rather than becoming a permanent firmware command. Firmware skills are limited to 120 interpolated frames and at most 20 Hz. Long timelines are resampled to fit; shorten the motion or increase its speed if it cannot fit. Uploading another custom motion replaces the robot's last-skill slot.

Web Bluetooth and Web Serial require a compatible Chromium browser such as Chrome or Edge and a local secure context (`http://127.0.0.1` is allowed). The connection picker always requires a user click. Bittle Studio does not reconnect or move the robot on startup.

### One place to control the robot: the Control tab

The inspector's **Control** tab (right) holds everything that moves Bittle, and it works the same with or without a robot:

- **Without a robot**, every control moves the simulated Bittle only.
- **With a robot connected** (Bluetooth panel), every control moves the simulation *and* sends the command to the robot.

The status line and **Stop** stay at the top; below them the controls are split into tabs that each fit on screen without scrolling (down to 1280×720): **Joints**, **Move** (gait pad), **Postures** (in groups: poses, head, setup and falls), **Skills** (Petoi's built-in tricks in groups: greetings, dog life, tricks, floor and acrobatics; with **▶ Play last skill** for the last one pressed), **My skills** (your saved functions as one-click buttons, with **▶ Play last skill** sending Petoi's `T`, which replays the last custom skill), **Buttons** (My buttons) and **Robot settings** (one row per setting, its buttons side by side: motors on and off, gyro on and off, voice module on and off, random behaviours on and off, joint positions read once or live, beep and meow, battery voltage and firmware version). There is no faster or slower: Petoi's firmware has those commands switched off, and each built-in skill plays at the speed its own data sets. The last tab used is remembered. In detail:

- **Joint sliders** in the Petoi Skill Composer layout (head pan, body diagram, one box per leg). The head pan slider is mirrored, its largest angle on the left, since a growing angle turns the head left: dragging it right turns the head right, here and in the Studio's pose inspector. When connected they also drive the real servos through **Servo setup** (servo = direction × angle + offset). **Zero pose** is mirrored the same way.
- **Commands**: the gait selector and direction pad (■ = `kbalance`), postures, head, skills, robot settings and **My buttons**. In the Studio these are on the **Robot settings** tab of Robot control; Bittle Link shows them in its Robot settings section. They are: **Motors off** (`d`: rest pose, then every servo off), **Motors on** (`:` restores full servo stiffness, then the servos hold the last read positions, or `kbalance` if nothing was read), **Read positions** / **Live positions** (the servos go soft so the legs can be moved by hand, and their real angles are read once or about every 0.6 s until another command; needs Petoi's feedback servos, as on Bittle X), gyro and voice module, and **Random behaviours** on and off. The firmware only toggles random behaviours (`z`), answering `Z` when they are now on and `z` when off, so each button sends `z` and sends it once more if the answer is the other way; a firmware built without random behaviours (`RANDOM_MIND`) does not answer, which the log says. The firmware prints servo feedback to USB only, so reading sends `f` (measure) followed by `j`, which reports the joint list on every port and makes the firmware re-attach the servos that measuring detached. In the Studio the read angles pose the simulated Bittle through Servo setup, so the 3D model follows the real legs. Test mode answers `j` with the angles it was sent, so the flow can be tried without a robot. Built-in skills play in the simulator from Petoi's own skill data (`app/petoi_skills.json`, converted from OpenCatEsp32 under the MIT license, see `app/petoi_skills.LICENSE`); right-turn gaits are mirrored from the left ones as the firmware does. Gaits keep looping until another command or **Stop**. Bound and Jump forward only go forward, and Halloween is sent without a direction (`khlw`), so the other arrows are greyed out for them. Commands without a joint effect (gyro, voice module) only go to the robot. **Learning the real commands:** the serial monitor also works with no robot connected. Every action in the Studio (buttons, skills, functions, joint sliders) then shows the exact command a real Bittle would receive, marked **simulator only · not sent**, and commands typed in the monitor play in the simulator. Replies such as the `j` joint list are simulated and marked as such. **Function playback** (Robot settings) chooses how saved functions reach the robot: **Stream** (default) sends every frame as one binary `I` joint command on the function's own timing, so movement starts at once and gaits loop until another command; **Upload** sends the whole skill as one `K` packet that the robot then plays itself (smoother timing on USB, but slow over Bluetooth). The choice is remembered.
- **My buttons** are composed sequences of commands and saved functions with a wait after each step; they run on the simulator and, when connected, on the robot. **Record presses** adds steps from the pad, grids and buttons.

The main Bittle's **placement** (start position used by Reset, in metres and degrees) is shown under the Stage when Bittle is selected, together with **Edit robot structure & sensors…**. Boxes, ramps and extra robots show their properties in the same place when selected.

Moving a slider, scrubbing or playing the timeline, or Reset takes over from a running simulated skill. The top-bar **Stop** and the **Esc** key stop both the simulation and the robot.

The simulated skills follow your Servo setup. The defaults (right-side joints −1, as checked against Petoi's walking, sitting and standing data) make them look right out of the box; if a skill looks mirrored or inverted in the simulator, the same joint is set up wrong for the real robot too.

**Serial monitor.** When a robot connects, a floating serial monitor opens over the 3D view (drag it by its title, resize from the corner, close with ×, reopen from the **Serial monitor** button next to **Bluetooth** or **Window → Serial monitor**; Bittle Link shows it below the console). Every command sent to the robot is listed with the control that sent it (for example *Postures · Sit*, *Joint sliders*, *Servo setup · Test*, *My button · step 2*) and a plain-language meaning (for example `i 13 -20` → move joints together: servo 13 → −20°). The robot's replies appear indented under the command that caused them, with a short explanation where known. It can filter sent/received lines, auto-scroll, copy the log, and send typed commands (↑/↓ for history).

The **Bluetooth** panel docks at the top right and only holds the connection: Bluetooth BLE, Bluetooth / USB serial or test mode, Connect / Disconnect and **Developer mode** (selected by default: `gb` turns off the firmware's balance/gyro assistance and blocks voice actions; turning it off sends `gB`). Commands and replies are in the **Serial monitor**; robot controls are in **Robot control**.

**Voice companion** (Window → Voice companion) adds the optional Bobby Realtime voice companion from the merged workflow. Enter an OpenAI API key once per server run. The key is kept only in server memory and the browser audio connection uses WebRTC. Voice can talk without a robot, but physical actions require the shared hardware connection and are blocked whenever developer mode is active. Starting voice requires internet access and may incur OpenAI API usage charges.

Use **Test mode** to verify the developer-state commands, built-in skills, saved functions and voice tool routing before connecting a physical Bittle. The activity log should show `gb` when developer mode starts, `gB` when it ends, and `TEST` for every command that would have been sent.

### Bittle Link: the robot console on its own

The connection, protocol and console are a separate module in `app/web/bittle-link/`. It imports nothing from the rest of Studio, and Studio's Bluetooth dialog is built on it. The same module also runs without the simulator:

- Start the **Start Bittle Link** launcher for your system, or run `python app/bittle_link.py`. This needs only Python's standard library (no PyBullet or `.venv` packages). It serves the console at **http://127.0.0.1:8770** and opens the browser. Use `--port` to pick another port and `--no-browser` to skip opening one.
- From a running Studio, **Control → Commands → Open standalone ↗** opens the same page.

The standalone console has the connection bar, gait pad, posture and skill grids, **My buttons**, a terminal and the log. Its buttons are kept in that browser's storage; share them through the `saved-motions` folder with **Save pack** and **Import pack**.

Buttons that use Studio functions travel as a **pack**. In Studio, **Save pack** (Control tab, under Commands) asks for a name and writes `saved-motions/<name>.json`. The pack contains the buttons plus every saved Studio function, compiled to the firmware skill that Studio itself would upload. Every servo in **Servo setup** must be verified first. In Bittle Link, **Import pack** lists the files in `saved-motions` (or opens any other file) and merges the chosen one in, and you can then compose new buttons from those functions as well.

Developers: the module files and their API are described in the [developer guide](developer-guide.md).

References: [Petoi Python API](https://docs.petoi.com/apis/python-api), [serial protocol](https://docs.petoi.com/apis/serial-protocol), [skill data format](https://docs.petoi.com/applications/skill-creation). Inspiration: [Petoi Bittle X simulator](https://bittlex-sim.petoi.com/) and [Bittle AI voice](https://github.com/UA-ProductDevelopment-TDD/Bittle_AI_voice).

## Python workspace and motion timing

Open **Window → Python code**. The viewport remains above the editor.

- **Motion Hz** in the timeline changes target-update frequency. **Physics Hz** under World physics changes Bullet's step rate. **Order → First → last** is the default; reverse is explicit. **Start** begins at the correct endpoint, while Play resumes from the cursor.
- Export has its own Hz, speed and order controls, initialized from the timeline. New samples are chronological, include both endpoints, and use Petoi's simultaneous `I` command. Increasing Hz cannot force a serial connection or firmware to keep up: the generated script reports achieved throughput. Integer servo angles remain quantized to degrees.
- **Timeline → Python** creates the actual exported source in the editor. The resulting source is an editable file, not a separate timeline approximation.
- Create files with **+ File**, or import one or several `.py` files. Rename them in the filename field. Import helper modules normally, e.g. `from helper import gait`. Uncheck helpers so they are not launched as entry points.
- Pick a **Target** for each entry point: the main Bittle, an additional URDF robot, or a scene object. **Run file** starts only the selected file. **Run checked** starts up to eight files together, on different targets. Only one process per target can run at once; compose same-target behaviours through imports. Each process has its own module globals.
- **Enable physics** starts motor-driven dynamics if it is currently paused. Starting Python without the checkbox no longer pauses an already-running world. Normal `time.sleep`, `time.monotonic`, and `time.perf_counter` use the simulation clock in the runner, so a slow simulation does not cause wall-clock scheduling to skip ahead. Unsupported firmware APIs fail explicitly.
- The console shows output, tracebacks, completion and timeout status. **Stop all** kills the runner processes and pauses physics. Reset does the same before resetting the world. Run limit is adjustable from 1 to 3600 wall-clock seconds. Changing a model/world or timeline while scripts run is rejected until Stop.
- The installed app checkpoints the complete current project when Python files are saved (including automatic saves after editing), and restores that checkpoint on the next launch. No code auto-runs on startup. Continue using **Save project** to create named, portable JSON backups; mesh assets still require the accompanying `robot-models/` and `user-data/` folders. Saved checkpoints are in `user-data/studio-session.json`.

### Additional robots

In **URDF / Xacro import**, choose **Add another robot** before importing a URDF/ZIP, or click **Add Bittle copy**. This adds another independently simulated body to the same world, including collisions with other bodies. Select it in Scene to edit its URDF, position, rotation or pinned-base setting. Use the **Robot** selector above the timeline to switch the joint panel, keyframes, playhead, Motion Hz and playback direction to that robot. Each robot keeps its own timeline in project files. **Write code for this robot** makes a starter controller attached to it. Scene objects offer the same shortcut.

### Simulated IMU / gyro

Open **Edit robot**, select the robot inside that window, then open **Sensors**. Give the sensor a name, choose the exact link and click **Add IMU / gyro**. The editor always suggests a unique name, shows live roll/pitch/yaw and angular velocity, and allows removal from the same card. Sensors are stored with that robot in autosave and project JSON. Python reads the data with `ctx.get_imu()`, `ctx.get_sensor(name)`, `ctx.get_sensors()`, or `ctx.get_state()["sensors"]`. Orientation uses Euler radians, angular velocity uses rad/s, and body-frame acceleration uses m/s². A stationary simulated accelerometer reports support against gravity; sensor bias and noise are intentionally absent.

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

`ctx.get_state()` returns position, rotation, time, joint names, measured joint angles, target angles and configured sensors. `ctx.get_imu()` returns the first IMU, while `ctx.get_sensor(name)` selects one by name or ID. `ctx.set_joints()` takes named angles in degrees. `ctx.set_position([x,y,z], [roll,pitch,yaw])` teleports the assigned target (metres and radians), useful for kinematic obstacle tests. `ctx.apply_force([fx,fy,fz])` applies a world-frame force at the base centre of mass for one physics step; use a dynamic body and enable physics. `ctx.sleep(seconds)`, `ctx.time()` and `ctx.rate(hz).sleep()` provide simulation timing.

### Petoi compatibility and execution boundary

Within the code panel, imports of `PetoiRobot` resolve to a simulation adapter supporting `autoConnect`, `openPort`, `closePort`, `rotateJoints`, `absValList`, `getAngle` and `getAngleList`. Exported files run as entry points with `--execute`, and their interactive prompts are acknowledged in the console. Their `STUDIO_MAPPING` is used to invert servo-space angles back to URDF angles. Old exports without embedded mapping use the target's saved mapping. Legacy `M` calls are accepted with a diagnostic, but their firmware-specific sequential timing is **not** emulated; regenerate them to use `I`.

The adapter makes no serial connection. This is ordinary trusted local Python in a child process, **not a security sandbox**: arbitrary user code can use filesystem/network APIs or import other installed packages. Only execute code you trust. Stop kills the runner process, not arbitrary subprocesses deliberately spawned by user code. Firmware behaviours, physical sensor imperfections, motor electronics, serial throughput and hardware calibration are not emulated.

The command correction is grounded in [Petoi's command definitions](https://github.com/PetoiCamp/OpenCat-Quadruped-Robot/blob/main/src/OpenCat.h): `I` is indexed simultaneous binary, `M` is indexed sequential binary.

## Physics assumptions and limits

- Configurable Physics Hz (60–1000, default 240); 80 solver iterations. Motion Hz (1–240, default 50) sets timeline target updates and the export sample rate independently. The browser polls transforms independently and shows the actual Bullet link transforms. Actual wall-clock performance depends on scene complexity.
- Position motors use each URDF joint's effort and velocity limits. In pose mode, joints are placed directly, which is an animation preview rather than a physical result.
- Supplied link masses are retained. If a link omits inertial data, Studio uses the median declared mass and inertia as a runtime fallback and reports it in diagnostics. Bullet computes inertia from collision geometry. The supplied Bittle file has multiple nonphysical inertia tensors; diagnostics report these. The original file under `C:/Nvidea_Omniverse/Robots/Bittle_URDF_scaled` is untouched; the bundled copy only corrects mesh paths.
- New additional robots are placed with their lowest collision shape 2 mm above the floor. **Place lowest collision on ground** applies the same correction after manual edits. Collision pairs that already penetrate in the authored zero pose are disabled and reported, preventing Bullet from launching overlapping CAD shells apart when physics starts.
- Self-collision is enabled except between parent and child links. Ground friction is editable, as is each environment object's friction. No spring compliance, servo backlash, motor electronics, battery limits, automatic balance controller or sensor noise is modelled.
- The body and legs come from the community Bittle model. The head, jaw, neck mount and neck servo come from Petoi's official model and are fitted to it through the four shoulder hinges (within 4 mm). The neck turns ±90° about the real robot's tilted head axis. Projects saved before the head was added are upgraded automatically if their robot model was never edited.
- The crouch example is a pose study, not a validated walking gait. Simulated motion does not guarantee balance or safe transfer to hardware. No real Bittle was connected or tested during development.
- This is an initial workbench, not Blender feature parity: no inverse-kinematics foot handles, curve editor, texture authoring or native OpenCat firmware skill export yet. Multiple Python controllers, multiple URDFs and direct Petoi BLE/serial timeline testing are supported.
- One local shared simulation per server. Multiple browser tabs operate on the same world. The server binds to loopback; do not expose it to a network as a multi-user service.

## Asset attribution

The bundled robot was copied from the user's Bittle URDF directory. Its original README and GPL license are preserved as `robot-models/bittle/SOURCE.md` and `robot-models/bittle/LICENSE`. The upstream README attributes meshes to a third-party reverse-engineered GrabCAD design; inspect those terms before redistribution. The head and neck meshes are from Petoi's [ros_opencat](https://github.com/PetoiCamp/ros_opencat) Bittle model under the MIT license, kept as `robot-models/bittle/head/LICENSE`. Three.js and other dependencies retain their own licenses.

The Petoi function catalog and connection protocol integration are adapted from the linked [UA Product Development Bittle AI Voice project](https://github.com/UA-ProductDevelopment-TDD/Bittle_AI_voice). Review that repository's license and the upstream Petoi firmware terms before redistribution.
