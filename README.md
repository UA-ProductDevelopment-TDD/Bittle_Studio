# Bittle Studio

Design, simulate and send motions to a Petoi Bittle robot dog, all on your own computer. Bittle Studio pairs a 3D viewport and a real physics simulation (PyBullet) with a Bluetooth console for the physical robot. No account or cloud service is needed.

## Quick start

| Step | What to do |
|---|---|
| 1. Install once | Install **Python 3.11** and **Node.js**, then double-click **`setup.cmd`**. |
| 2. Open the Studio | Double-click **`launch-studio.cmd`** and keep its black window open. The Studio opens at http://127.0.0.1:8765. |
| 3. Or open only the robot console | Double-click **`launch-bittle-link.cmd`** to get just the Bluetooth console (no simulator) at http://127.0.0.1:8770. |

Use **Chrome or Edge**, because Bluetooth from a web page only works there. To stop the Studio or the console, press **Ctrl+C** in its black window.

## What's in this folder

```
Bittle-studio/
├─ README.md                  ← you are here
├─ setup.cmd                  install everything (run once per computer)
├─ launch-studio.cmd          start the full Studio: simulator, timeline, robot connection
├─ launch-bittle-link.cmd     start only the robot console (Bittle Link)
│
├─ saved-motions/             your motion packs (buttons + skills) to share and load in Bittle Link
├─ robot-models/              the Bittle 3D model (URDF + meshes)
├─ docs/                      the full user guide and the developer guide
├─ scripts/                   helpers: run-tests.cmd, update.cmd
├─ app/                       the software's source code (you normally don't need to open this)
└─ user-data/                 created automatically: autosave and imported files (not shared on GitHub)
```

## From the simulator to the real robot in five steps

1. In the Studio, make a motion on the **timeline** (pose the joints, add keyframes, press play).
2. Open **Bluetooth → Functions** and **Save current timeline** as a Studio function.
3. On **Bluetooth → Console**, press **+ New button** to combine your functions with built-in tricks, then press **Save pack**. The pack is written to `saved-motions/`.
4. Start **`launch-bittle-link.cmd`**, press **Import pack** and choose your pack.
5. **Connect Bittle** and press your buttons.

Before the first real run, open **Export motion** in the Studio and tick **Verified** for every servo. Try new motions in **Test mode** first; it sends nothing to the robot.

## Helpers

- **`scripts/run-tests.cmd`** runs all automated checks. Use it after changing code or pulling updates.
- **`scripts/update.cmd`** downloads the latest version from GitHub and refreshes the installed packages.

## Learn more

- [User guide](docs/user-guide.md): every panel, importing robots, physics, Python controllers, voice, Bittle Link.
- [Developer guide](docs/developer-guide.md): how the code is organised, APIs, and how to test changes.
