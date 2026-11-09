# Harbor on Windows

The tray opens https://delta-quartz-kite-jolly.grok.me and listens at `http://127.0.0.1:47391/` for pointer moves, clicks, and a basic set of keys. It uses the primary screen.

It does not need an administrator. It does not install a service. Quit it from the tray icon and the pointer stops listening.

## 1. Publish the current Harbor

The Windows pointer button is in this repository. It is on the live site only after you publish this build from Grok. The address stays https://delta-quartz-kite-jolly.grok.me.

## 2. Install the tray

On the Windows PC, open PowerShell. Do not use "Run as administrator".

```powershell
$dest = Join-Path $env:TEMP "Install-Harbor.ps1"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/supportletaba2-gif/harbor/main/agent/windows/install.ps1" -OutFile $dest -UseBasicParsing
Get-Content $dest
powershell -NoProfile -ExecutionPolicy Bypass -File $dest
```

Read the file `Get-Content` prints before the last line. The desk address is already set.

Files go to `%LOCALAPPDATA%\Harbor`. A Harbor shortcut is added to this user's Startup folder. The browser opens the desk.

If Windows asks about local network access for the site, allow it. That is the browser reaching the tray on this same PC.

## 3. Share the screen and allow the pointer

1. On the Windows PC, the tray opens the desk. Click **Allow the pointer** and choose **Allow** when Chrome asks to connect to a device on the local network. The page should then say the tray has the pointer. If it says the tray is not running, start Harbor from the Startup shortcut and click Allow the pointer again.
2. Choose **Share this display**, then the entire screen (not a window). Leave that tab open. Wait until it says Waiting. Copy that ID and PIN.
3. On the other computer, open https://delta-quartz-kite-jolly.grok.me. Enter that ID and PIN. Choose **Connect**. Do not choose **Control this page**.
4. On the other computer, click and drag on the picture. The Windows cursor should follow. Left click, right click, and the scroll wheel land on that PC. Letters, Enter, Backspace, Tab, Escape, Delete, and the arrow keys type into the focused window, including Ctrl and Alt shortcuts. Clipboard text sent from that computer is placed on this PC's clipboard.

If the other computer says the mouse is waiting, the Allow prompt was missed. On the shared PC, click **Allow the pointer** again and choose Allow. A probe that runs by itself never shows that prompt, so the cursor does nothing until this click.

Share the entire screen. A window or a browser tab will not line up with the Windows cursor.

After a tray update, run the update command again so this PC is running the new script. The site itself changes only after you publish from Grok.

## Remove it

Quit Harbor from the tray icon. Then delete `%LOCALAPPDATA%\Harbor` and the Harbor shortcut in `shell:startup`.

## Why this is not an MSI

Microsoft's packaging note for an internal tool is an unpackaged app installed by a script. An MSI has to be signed or SmartScreen blocks it. This tray is the pointer agent you can install today. A signed MSIX is the later package, after the pointer path has been proven on your PC.
