# Bittle Studio

Design, simulate and send motions to a Petoi Bittle robot dog, all on your own computer. Bittle Studio pairs a 3D viewport and a real physics simulation (PyBullet) with a Bluetooth console for the physical robot. No account or cloud service is needed.

## What you can do

- **Design motions** on a timeline, pose by pose, and watch them in a 3D physics simulation before the robot ever moves.
- **Play Petoi's built-in skills** (sit, walk, high five, flips...) in the simulator, using the firmware's own skill data.
- **Drive the real Bittle** over Bluetooth: gaits, postures, skills, single joints and your own saved functions.
- **Learn the real commands**: the serial monitor shows every command with a plain-language explanation, even when no robot is connected.
- **Share your work** as motion packs, or export functions as Python scripts for Petoi's `PetoiRobot` library.
- **Program it in Python** in the built-in code panel, or talk to it through the optional voice companion.

**Just want to drive the robot?** The Bluetooth console runs online, with nothing to install: https://ua-productdevelopment-tdd.github.io/Bittle_Studio/

## Quick start

1. Install **Python 3.11 or 3.12** from https://www.python.org/downloads/ (on Windows, tick **"Add python.exe to PATH"**).
2. Open the **`launchers`** folder, then the folder for your computer:

| | Windows (`launchers/windows`) | Mac (`launchers/mac`) | Linux (`launchers/linux`) |
|---|---|---|---|
| **Install once** | double-click **Setup** | double-click **Setup** | run `./setup.sh` |
| **Start the full Studio** | double-click **Start Bittle Studio** | double-click **Start Bittle Studio** | run `./start-studio.sh` |
| **Start only the robot console** | double-click **Start Bittle Link** | double-click **Start Bittle Link** | run `./start-bittle-link.sh` |
| **Get the latest version** | double-click **Update** | double-click **Update** | run `./update.sh` |

The Studio opens in your browser at http://127.0.0.1:8765 and the robot console at http://127.0.0.1:8770. Keep the black terminal window open while you work, and press **Ctrl+C** in it to stop.

Use **Chrome or Edge**, because Bluetooth from a web page only works there.

<details><summary>Mac or Linux: the launcher won't open?</summary>

- **Mac, "cannot be opened because it is from an unidentified developer":** right-click the launcher, choose **Open**, then **Open** again. This is needed once per launcher.
- **Mac or Linux, "permission denied":** open a terminal in the launcher's folder and run `chmod +x *.command *.sh`.
- **Linux:** run the launchers from a terminal (`cd launchers/linux`, then `./setup.sh`). Some distributions also need `sudo apt install python3-venv` first.
- **Setup fails while installing pybullet:** that computer has to build the physics package itself. On a Mac run `xcode-select --install`, on Linux install `build-essential`, then run Setup again.
</details>

## From the simulator to the real robot in five steps

1. In the Studio, make a motion on the **timeline** (pose the joints, add keyframes, press play).
2. Press **★ Save as function** in the timeline and give it a name; it appears in the **Functions** list next to the timeline.
3. In **Robot control**, on the **Buttons** tab, press **+ New button** to combine your functions with built-in tricks, then press **Save pack**. The pack is written to `saved-motions/`.
4. Start **Start Bittle Link**, press **Import pack** and choose your pack.
5. **Connect Bittle** and press your buttons.

Before the first real run, check each joint in **Servo setup** (see [Connect the robot](#connect-the-robot)), and try new motions in **Test mode** first: it sends nothing to the robot.

## Using Bittle Studio

### The workspace

- **Stage** (left): the robots and objects in the scene, **Create & import** and **World physics**.
- **Viewport** (middle): orbit with left-drag, pan with right-drag, zoom with the wheel. **F** focuses the robot.
- **Motion timeline** (below the viewport), with your saved **Functions** beside it.
- **Robot control** (right): everything that moves Bittle.
- **Window** in the top bar opens a closed panel again; **Window → Reset workspace** restores the standard layout.

### Make a motion

1. In **Robot control → Joints**, pose the nine joints (head, four shoulders, four knees). The head slider is mirrored: dragging it right turns the head right.
2. Set the time to `0` and press **◆ Add keyframe**. Set another time, change the pose and add another keyframe.
3. **▶ Play motion** previews it (**Space** plays and pauses). Click a keyframe to select it; adding one at the same time replaces it.
4. **★ Save as function** gives the motion a name and adds it to **Functions**, from where it can be played, exported to Python or sent to the robot.

**▶ Run physics** turns on gravity, collisions and the joint motors, to see whether the motion holds up; **Pin robot base** holds the body still for bench tests. **↺ Reset** puts everything back.

### The scene

- **＋ Box**, **◩ Ramp**, **＋ Sphere** and **▥ Steps** add obstacles. Select one to change its size, mass and friction.
- Select Bittle, then **↔ Move XYZ** or **⟳ Rotate XYZ**, to place it where Reset starts. Pause physics first. **Reset placement** puts it back in the middle.
- **Create & import** brings in your own robot (a ZIP with a URDF or Xacro file and its meshes) or environment meshes (OBJ, STL or GLB, in metres, Z up), or adds a copy of Bittle.
- **Edit robot** opens the Robot Editor: the robot's structure, its **Sensors** (add an IMU / gyro to a link) and its **URDF source**.
- **Save project** downloads the whole experiment as one file; **Open project** restores it. The Studio also saves your work by itself and restores it at the next start.

### Control the robot

Every control in Robot control moves the simulated Bittle; with a robot connected it moves the real one too. **■ Stop** in the top bar, or **Esc**, stops both.

- **Joints**: one slider per servo, laid out like Petoi's Skill Composer. **Zero pose** sets them all to 0.
- **Move**: pick a gait (Walk, Trot, Crawl…), then steer with the direction pad; **■** stops. Gaits loop until another command.
- **Postures**: poses, head directions, and setup and fall postures.
- **Skills**: Petoi's built-in tricks, in groups. Those marked ⚠ need free space and a soft floor. **▶ Play last skill** repeats the last one.
- **My skills**: your saved functions as one-click buttons.
- **Buttons**: your own buttons, each a sequence of commands and functions with a wait after each step. **+ New button** makes one; **Record presses** adds the buttons you press as steps. **Save pack** writes your buttons and functions to `saved-motions/`; **Open standalone ↗** opens Bittle Link.
- **Robot settings**: one row per setting: motors, gyro, voice module and random behaviours on and off; joint positions read once or live (on robots with feedback servos, such as Bittle X); beep and meow; battery voltage and firmware version. **Function playback** chooses how your functions reach the robot: **Stream** (starts at once, the default) or **Upload** (smoother over USB).

There are no faster or slower buttons: Petoi's firmware has those commands switched off, and each skill plays at its own speed.

### Connect the robot

1. Press **Bluetooth** in the top bar and choose:
   - **Bluetooth BLE** for Bittle's own Bluetooth (choose Bittle or Petoi in the browser's list);
   - **Bluetooth / USB serial** for a USB cable or a paired Bluetooth module (choose its COM port);
   - **Test mode** to try everything without a robot: nothing is sent.
2. **Developer mode** (on by default) turns off the robot's own balance and voice reactions while the Studio controls it.

**Before the first real run**, open **Servo setup** in the top bar. Press **Test** on each joint: the simulated and the real servo both move +10° and back. If they move differently, set that joint's direction (1 or −1) and offset, then tick **Verified**. Saving packs and exporting Python need every joint verified.

### Learn the robot's commands

The **Serial monitor** (top bar, or Window) lists every command sent to the robot, which control sent it, and what it means in plain words, for example `i 13 -20` → servo 13 to −20°. The robot's replies appear under the command that caused them. Without a robot it still shows what a real Bittle would receive, marked *simulator only · not sent*, and commands typed into it play in the simulator.

### Share your motions

- **Save pack** (Robot control → Buttons) writes `saved-motions/<name>.json` with your buttons and functions, ready for the robot. Send that file: the other person puts it in their own `saved-motions/` folder, or presses **Import pack** in Bittle Link.
- To share the whole program, send the GitHub link or the ZIP (**Code → Download ZIP** on GitHub). Leave out `.venv/` and `user-data/`: each computer makes its own.

### Bittle Link: the robot console on its own

**Start Bittle Link** opens just the robot console, without the simulator, at http://127.0.0.1:8770. It needs only Python. The same console runs online, with nothing to install, on the [project's website](https://ua-productdevelopment-tdd.github.io/Bittle_Studio/). Its buttons are kept in that browser; use **Save pack** and **Import pack** to move them.

### Export to Python

On a saved function, **Python** (or **Export selected ↗** for several) writes a script for Petoi's `PetoiRobot` library. Choose **Pose** (sends one pose), **Behavior** (plays once) or **Gait** (repeats until Ctrl+C). Run it with `python bittle_motion.py` for a dry run, then `python bittle_motion.py --execute` to drive the robot; it asks before moving.

### Program in Python

**Window → Python code** opens the code panel.

- **+ File** makes a file; **Run file** runs it, **Run checked** runs several at once. Each file controls the **Target** you choose: Bittle, another robot or an object.
- **Write code for this robot** (or object) starts a file for it.
- `from bittle_sim import ctx` gives the simulation: `ctx.set_joints({...})` in degrees, `ctx.get_state()`, `ctx.get_imu()`, `ctx.rate(50).sleep()`. The [developer guide](docs/developer-guide.md#controller-api) has the full list and an example.
- **Stop all** stops every script and pauses physics.

Code runs on your computer with your rights: only run code you trust.

### Voice companion

**Window → Voice companion** lets you talk to Bittle. It needs an OpenAI API key, which is kept only while the Studio runs, and internet access; it may cost OpenAI usage. It can talk without a robot; it moves the robot only when Developer mode is off.

### Good to know

- Simulated motion does not guarantee balance on the real robot: try new motions lifted, in Test mode first, then on the floor.
- One simulation per Studio: several browser tabs show the same world.

## What's in this folder

```
Bittle-studio/
├─ README.md            ← you are here
├─ launchers/           ← START HERE: Setup, Start Bittle Studio, Start Bittle Link, Update
│  ├─ windows/
│  ├─ mac/
│  └─ linux/
├─ saved-motions/       your motion packs (buttons + skills): share these with others
├─ docs/                the developer guide
├─ robot-models/        the Bittle 3D model (URDF + meshes)
├─ app/                 the software itself (you don't need to open this)
├─ dev-tools/           for developers: automated tests, website builder
└─ user-data/           created automatically: autosave and imported files (not shared)
```

## For developers

The [developer guide](docs/developer-guide.md) says how it works inside: the code, the robot protocol, the APIs, importing, the Python runner, the physics and its limits, the sources and licences, and how to test changes (`dev-tools/run-tests.cmd` or `dev-tools/run-tests.sh`).
