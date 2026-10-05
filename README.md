# Bittle Studio

Design, simulate and send motions to a Petoi Bittle robot dog, all on your own computer. Bittle Studio pairs a 3D viewport and a real physics simulation (PyBullet) with a Bluetooth console for the physical robot. No account or cloud service is needed.

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

## What's in this folder

```
Bittle-studio/
├─ README.md            ← you are here
├─ launchers/           ← START HERE: Setup, Start Bittle Studio, Start Bittle Link, Update
│  ├─ windows/
│  ├─ mac/
│  └─ linux/
├─ saved-motions/       your motion packs (buttons + skills): share these with others
├─ docs/                the user guide and the developer guide
├─ robot-models/        the Bittle 3D model (URDF + meshes)
├─ app/                 the software itself (you don't need to open this)
├─ dev-tools/           for developers: automated tests, website builder
└─ user-data/           created automatically: autosave and imported files (not shared)
```

**Sharing your work:** to give someone your motions, send them the pack file from `saved-motions/`. They put it in their own `saved-motions/` folder, or press **Import pack** in Bittle Link. To share the whole program, send the GitHub link or the ZIP (Code → Download ZIP on GitHub). Leave out `.venv/` and `user-data/`, because each computer makes its own.

## From the simulator to the real robot in five steps

1. In the Studio, make a motion on the **timeline** (pose the joints, add keyframes, press play).
2. Press **★ Save as function** in the timeline and give it a name; it appears in the **Functions** list next to the timeline.
3. In the inspector's **Control** tab, under **Commands**, press **+ New button** to combine your functions with built-in tricks, then press **Save pack**. The pack is written to `saved-motions/`.
4. Start **Start Bittle Link**, press **Import pack** and choose your pack.
5. **Connect Bittle** and press your buttons.

Before the first real run, open **Servo setup** in the top bar: connect, press **Test** on each joint to check it moves the right way, and tick **Verified**. Try new motions in **Test mode** first; it sends nothing to the robot.

## Learn more

- [User guide](docs/user-guide.md): every panel, importing robots, physics, Python controllers, voice, Bittle Link.
- [Developer guide](docs/developer-guide.md): how the code is organised, APIs, and how to test changes (`dev-tools/run-tests.cmd` or `dev-tools/run-tests.sh`).
