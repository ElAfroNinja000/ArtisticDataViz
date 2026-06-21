<#
.SYNOPSIS
  Local Android emulator helper for testing the 3DPS mobile UI (3DPS-11).

.DESCRIPTION
  Boots a local Android Virtual Device (AVD), points its browser at the running
  Vite dev server, and captures screenshots - so the mobile config can be tested
  locally before deploying. Designed to be driven by a single command.

  Prerequisites (one-time, handled by the SDK install on D:):
    - Android SDK at $SdkRoot (emulator, platform-tools, system image)
    - Portable JDK 17 at $JdkHome (only avdmanager/sdkmanager need Java)
    - WHPX enabled (admin):  Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All

  The Vite dev server must already be running on $Port (e.g. `npm run dev` from
  artistic-data-viz/). The emulator reaches it via `adb reverse` (localhost:$Port).

.PARAMETER Action
  up      Create the AVD if missing, boot the emulator, wire up adb reverse, open the URL.
  down    Stop the running emulator.
  shot    Capture a screenshot. Optional: -Arg <output.png> (default: scripts/.artifacts/emu.png)
  url     Open a URL in the emulator browser. Optional: -Arg <url> (default: dev URL)
  status  Show emulator / adb / package state.

.EXAMPLE
  powershell scripts/android-emu.ps1 up
  powershell scripts/android-emu.ps1 shot scripts/.artifacts/mysongs.png
  powershell scripts/android-emu.ps1 down
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet('up', 'down', 'shot', 'url', 'status')]
  [string]$Action = 'up',

  [Parameter(Position = 1)]
  [string]$Arg
)

$ErrorActionPreference = 'Stop'

# --- Config -----------------------------------------------------------------
$SdkRoot   = 'D:\Dev\android-sdk'
$JdkHome   = 'D:\Dev\android-sdk\jdk17'
$AvdName   = '3dps_test'
$Image     = 'system-images;android-34;google_apis;x86_64'
$Device    = 'pixel_6'
$Port      = 5173
$DevUrl    = "http://localhost:$Port"

$Adb       = Join-Path $SdkRoot 'platform-tools\adb.exe'
$Emulator  = Join-Path $SdkRoot 'emulator\emulator.exe'
$AvdMgr    = Join-Path $SdkRoot 'cmdline-tools\latest\bin\avdmanager.bat'
$ArtDir    = Join-Path $PSScriptRoot '.artifacts'

$env:JAVA_HOME        = $JdkHome
$env:ANDROID_SDK_ROOT = $SdkRoot
$env:ANDROID_AVD_HOME = Join-Path $SdkRoot 'avd'

function Assert-Tooling {
  if (-not (Test-Path $Adb))      { throw "adb not found at $Adb - run the SDK install first." }
  if (-not (Test-Path $Emulator)) { throw "emulator not found at $Emulator - run: sdkmanager 'emulator'." }
}

function Ensure-Avd {
  $existing = & $Emulator -list-avds 2>$null
  if ($existing -contains $AvdName) { return }
  Write-Host "Creating AVD '$AvdName' ($Device, $Image)..."
  # avdmanager prompts to create a custom hardware profile; answer "no".
  'no' | & $AvdMgr create avd --name $AvdName --package $Image --device $Device --force
}

function Wait-Boot {
  Write-Host "Waiting for device..."
  & $Adb wait-for-device
  for ($i = 0; $i -lt 120; $i++) {
    $booted = (& $Adb shell getprop sys.boot_completed 2>$null).Trim()
    if ($booted -eq '1') { Write-Host "Boot complete."; return }
    Start-Sleep -Seconds 2
  }
  throw "Emulator did not finish booting within ~4 min."
}

function Open-Url([string]$TargetUrl) {
  # Map the emulator's localhost:$Port to the host dev server.
  & $Adb reverse "tcp:$Port" "tcp:$Port" | Out-Null
  # VIEW intent opens the default browser (Chrome on the Google APIs image).
  & $Adb shell am start -a android.intent.action.VIEW -d $TargetUrl | Out-Null
  Write-Host "Opened $TargetUrl in the emulator browser."
}

switch ($Action) {
  'up' {
    Assert-Tooling
    Ensure-Avd
    $running = & $Adb devices | Select-String 'emulator-\d+\s+device'
    if (-not $running) {
      Write-Host "Booting emulator '$AvdName'..."
      Start-Process -FilePath $Emulator `
        -ArgumentList @("-avd", $AvdName, "-no-snapshot-save", "-gpu", "auto", "-accel", "auto") `
        -WindowStyle Minimized
    } else {
      Write-Host "Emulator already running."
    }
    Wait-Boot
    Open-Url $DevUrl
    Write-Host "Ready. Capture with: pwsh scripts/android-emu.ps1 shot"
  }

  'down' {
    & $Adb emu kill 2>$null
    Write-Host "Emulator stopped."
  }

  'shot' {
    Assert-Tooling
    $out = if ($Arg) { $Arg } else { Join-Path $ArtDir 'emu.png' }
    $dir = Split-Path -Parent $out
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    # exec-out streams the PNG bytes directly. Redirect via cmd: PowerShell 5.1's
    # `>` re-encodes as UTF-16 and corrupts binary output, so the raw byte redirect
    # has to go through cmd.exe.
    cmd /c "`"$Adb`" exec-out screencap -p > `"$out`""
    Write-Host "Screenshot saved to $out"
  }

  'url' {
    Assert-Tooling
    Open-Url ($(if ($Arg) { $Arg } else { $DevUrl }))
  }

  'status' {
    Write-Host "SDK root : $SdkRoot"
    Write-Host "AVDs     : $((& $Emulator -list-avds 2>$null) -join ', ')"
    Write-Host "Devices  :"
    & $Adb devices
  }
}
