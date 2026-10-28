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

## 3. Share the screen and arm the pointer

1. On the Windows PC, choose **Share this display**, then the entire screen. Leave that tab open. Write down the ID and PIN.
2. On the other computer, open https://delta-quartz-kite-jolly.grok.me. Enter that ID and PIN. Choose **Connect**. Do not choose **Use the desk on this page**.
3. On either side, choose **Windows pointer** or **Arm Windows pointer**. The host page should say the tray has the pointer.
4. On the other computer, click and drag on the picture. The Windows cursor should follow. A click lands where the cursor is. Letters, Enter, Backspace, Tab, Escape, and the arrow keys type into the focused Windows window.

If the host still says the tray is not answering, the tray is quit, the port is busy, or the browser blocked local access. Re-open Harbor from the Startup shortcut and allow access for the site.

The practice desk does not move the Windows cursor. Share the entire screen first, or the picture and the cursor will not match.

## Remove it

Quit Harbor from the tray icon. Then delete `%LOCALAPPDATA%\Harbor` and the Harbor shortcut in `shell:startup`.

## Why this is not an MSI

Microsoft's packaging note for an internal tool is an unpackaged app installed by a script. An MSI has to be signed or SmartScreen blocks it. This tray is the pointer agent you can install today. A signed MSIX is the later package, after the pointer path has been proven on your PC.
