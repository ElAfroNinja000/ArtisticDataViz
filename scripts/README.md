# scripts/

Local dev tooling for 3DPS.

## android-emu.ps1 — local Android emulator (3DPS-11)

Boots a local Android Virtual Device, points its browser at the running Vite dev
server, and captures screenshots — so the **mobile config can be tested locally
before deploying** (the desktop browser preview misses Android-specific rendering
such as emoji glyphs and WebGL behaviour).

### One-time setup (already done, on `D:` to spare the `C:` drive)

The Android SDK lives at `D:\Dev\android-sdk` (outside the repo):

- `emulator`, `platform-tools` (adb), `platforms;android-34`
- `system-images;android-34;google_apis;x86_64`
- a portable **JDK 17** at `D:\Dev\android-sdk\jdk17` (only `sdkmanager`/`avdmanager`
  need Java; the SDK's bundled `java` 8 is too old for them)

**WHPX is required** for emulator acceleration (this machine has a hypervisor
present, so HAXM cannot be used). Enable it once, in an **admin** PowerShell, then
reboot if prompted:

```powershell
Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All
```

### Usage

The Vite dev server must be running first (from `artistic-data-viz/`):

```bash
npm run dev          # serves on http://localhost:5173
```

The `dev` script binds `vite --host` (all interfaces, IPv4 included). This matters:
`adb reverse` forwards the device's `localhost:5173` to the host's **IPv4** loopback,
but plain `vite` binds IPv6 (`[::1]`) only — which shows up as `ERR_EMPTY_RESPONSE`
in the emulator. `--host` makes `0.0.0.0:5173` reachable, so the reverse works.

Then drive the emulator (from the repo root):

```powershell
powershell scripts/android-emu.ps1 up      # create AVD if missing, boot, open the dev URL
powershell scripts/android-emu.ps1 shot    # screenshot -> scripts/.artifacts/emu.png
powershell scripts/android-emu.ps1 shot scripts/.artifacts/mysongs.png
powershell scripts/android-emu.ps1 url http://localhost:5173/#foo
powershell scripts/android-emu.ps1 status  # show AVDs / connected devices
powershell scripts/android-emu.ps1 down    # stop the emulator
```

`up` wires `adb reverse tcp:5173 tcp:5173`, so the emulator reaches the host dev
server at `localhost:5173`. Screenshots are written under `scripts/.artifacts/`
(gitignored) and can be opened/read directly.

### First-run gotchas

- **Chrome first-run** appears once on a fresh AVD ("Welcome to Chrome" → tap
  *Use without an account*, then dismiss the notifications prompt with *No thanks*).
  The AVD keeps user data between boots, so this is a one-time step; afterwards `up`
  lands straight on the app.
- **Emulator internet**: the local app loads fully over `adb reverse` (data JSON is
  served by Vite), so layout/rendering testing works even when the emulator shows
  "No internet connection". Click-to-play (YouTube) does need the emulator to have
  outbound internet, which a cold boot may lack — not required for UI/mobile-config
  testing, which is this tool's purpose.
