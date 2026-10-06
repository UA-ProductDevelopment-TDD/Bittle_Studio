# Bittle Studio user guide

What each part of the Studio does, by task. To install, start and update, and for the five steps from the simulator to the robot, see the [README](../README.md). How it works inside is in the [developer guide](developer-guide.md).

## The workspace

- **Stage** (left): the robots and objects in the scene, **Create & import** and **World physics**.
- **Viewport** (middle): orbit with left-drag, pan with right-drag, zoom with the wheel. **F** focuses the robot.
- **Motion timeline** (below the viewport), with your saved **Functions** beside it.
- **Robot control** (right): everything that moves Bittle.
- **Window** in the top bar opens a closed panel again; **Window → Reset workspace** restores the standard layout.

## Make a motion

1. In **Robot control → Joints**, pose the nine joints (head, four shoulders, four knees). The head slider is mirrored: dragging it right turns the head right.
2. Set the time to `0` and press **◆ Add keyframe**. Set another time, change the pose and add another keyframe.
3. **▶ Play motion** previews it (**Space** plays and pauses). Click a keyframe to select it; adding one at the same time replaces it.
4. **★ Save as function** gives the motion a name and adds it to **Functions**, from where it can be played, exported to Python or sent to the robot.

**▶ Run physics** turns on gravity, collisions and the joint motors, to see whether the motion holds up; **Pin robot base** holds the body still for bench tests. **↺ Reset** puts everything back.

## The scene

- **＋ Box**, **◩ Ramp**, **＋ Sphere** and **▥ Steps** add obstacles. Select one to change its size, mass and friction.
- Select Bittle, then **↔ Move XYZ** or **⟳ Rotate XYZ**, to place it where Reset starts. Pause physics first. **Reset placement** puts it back in the middle.
- **Create & import** brings in your own robot (a ZIP with a URDF or Xacro file and its meshes) or environment meshes (OBJ, STL or GLB, in metres, Z up), or adds a copy of Bittle.
- **Edit robot** opens the Robot Editor: the robot's structure, its **Sensors** (add an IMU / gyro to a link) and its **URDF source**.
- **Save project** downloads the whole experiment as one file; **Open project** restores it. The Studio also saves your work by itself and restores it at the next start.

## Control the robot

Every control in Robot control moves the simulated Bittle; with a robot connected it moves the real one too. **■ Stop** in the top bar, or **Esc**, stops both.

- **Joints**: one slider per servo, laid out like Petoi's Skill Composer. **Zero pose** sets them all to 0.
- **Move**: pick a gait (Walk, Trot, Crawl…), then steer with the direction pad; **■** stops. Gaits loop until another command.
- **Postures**: poses, head directions, and setup and fall postures.
- **Skills**: Petoi's built-in tricks, in groups. Those marked ⚠ need free space and a soft floor. **▶ Play last skill** repeats the last one.
- **My skills**: your saved functions as one-click buttons.
- **Buttons**: your own buttons, each a sequence of commands and functions with a wait after each step. **+ New button** makes one; **Record presses** adds the buttons you press as steps. **Save pack** writes your buttons and functions to `saved-motions/`; **Open standalone ↗** opens Bittle Link.
- **Robot settings**: one row per setting: motors, gyro, voice module and random behaviours on and off; joint positions read once or live (on robots with feedback servos, such as Bittle X); beep and meow; battery voltage and firmware version. **Function playback** chooses how your functions reach the robot: **Stream** (starts at once, the default) or **Upload** (smoother over USB).

There are no faster or slower buttons: Petoi's firmware has those commands switched off, and each skill plays at its own speed.

## Connect the robot

1. Press **Bluetooth** in the top bar and choose:
   - **Bluetooth BLE** for Bittle's own Bluetooth (choose Bittle or Petoi in the browser's list);
   - **Bluetooth / USB serial** for a USB cable or a paired Bluetooth module (choose its COM port);
   - **Test mode** to try everything without a robot: nothing is sent.
2. **Developer mode** (on by default) turns off the robot's own balance and voice reactions while the Studio controls it.
3. Use Chrome or Edge: Bluetooth from a web page works only there.

**Before the first real run**, open **Servo setup** in the top bar. Press **Test** on each joint: the simulated and the real servo both move +10° and back. If they move differently, set that joint's direction (1 or −1) and offset, then tick **Verified**. Saving packs and exporting Python need every joint verified.

## Learn the robot's commands

The **Serial monitor** (top bar, or Window) lists every command sent to the robot, which control sent it, and what it means in plain words, for example `i 13 -20` → servo 13 to −20°. The robot's replies appear under the command that caused them. Without a robot it still shows what a real Bittle would receive, marked *simulator only · not sent*, and commands typed into it play in the simulator.

## Share your motions

- **Save pack** (Robot control → Buttons) writes `saved-motions/<name>.json` with your buttons and functions, ready for the robot.
- Someone else puts the file in their own `saved-motions/` folder, or presses **Import pack** in Bittle Link.

## Bittle Link: the robot console on its own

**Start Bittle Link** opens just the robot console, without the simulator, at http://127.0.0.1:8770. It needs only Python. The same console runs online, with nothing to install, on the project's website. Its buttons are kept in that browser; use **Save pack** and **Import pack** to move them.

## Export to Python

On a saved function, **Python** (or **Export selected ↗** for several) writes a script for Petoi's `PetoiRobot` library. Choose **Pose** (sends one pose), **Behavior** (plays once) or **Gait** (repeats until Ctrl+C). Run it with `python bittle_motion.py` for a dry run, then `python bittle_motion.py --execute` to drive the robot; it asks before moving.

## Program in Python

**Window → Python code** opens the code panel.

- **+ File** makes a file; **Run file** runs it, **Run checked** runs several at once. Each file controls the **Target** you choose: Bittle, another robot or an object.
- **Write code for this robot** (or object) starts a file for it.
- `from bittle_sim import ctx` gives the simulation: `ctx.set_joints({...})` in degrees, `ctx.get_state()`, `ctx.get_imu()`, `ctx.rate(50).sleep()`. The [developer guide](developer-guide.md#controller-api) has the full list and an example.
- **Stop all** stops every script and pauses physics.

Code runs on your computer with your rights: only run code you trust.

## Voice companion

**Window → Voice companion** lets you talk to Bittle. It needs an OpenAI API key, which is kept only while the Studio runs, and internet access; it may cost OpenAI usage. It can talk without a robot; it moves the robot only when Developer mode is off.

## Good to know

- Simulated motion does not guarantee balance on the real robot: try new motions lifted, in Test mode first, then on the floor.
- One simulation per Studio: several browser tabs show the same world.
- Licences of the robot model, the head meshes and Petoi's skill data are listed in the [developer guide](developer-guide.md#sources-and-licences).
