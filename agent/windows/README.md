# Harbor on Windows

This installs a tray icon for the current user. At install, and again at sign-in, it opens the published Harbor desk in the browser.

It does not install a service, does not need an administrator, and does not move the Windows pointer. Remote clicks still land on the practice desk in the browser. A later signed native agent would be required to move the real pointer.

## Before you start

1. Publish Harbor and copy the `https://` address.
2. On the Windows PC, use that address. `localhost` only works on the machine that is running the app.

## Install

Open PowerShell. You do not need "Run as administrator".

```powershell
$dest = Join-Path $env:TEMP "Install-Harbor.ps1"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/supportletaba2-gif/harbor/main/agent/windows/install.ps1" -OutFile $dest -UseBasicParsing
Get-Content $dest
powershell -NoProfile -ExecutionPolicy Bypass -File $dest -DeskUrl "https://YOUR-PUBLISHED-ADDRESS"
```

`Get-Content` is there so you can read the script before it runs.

The files land in `%LOCALAPPDATA%\Harbor`. A shortcut named Harbor is added to the current user's Startup folder.

## Test from a second computer

1. On the Windows PC, the browser opens the desk. Choose **Start desk**. Keep the tab open. Write down the ID and PIN.
2. On the other computer, open the same published address. Enter that ID and PIN. Choose **Connect**. Do not choose "Use the desk on this page".
3. Click the picture and type. Notes and the terminal should change on the Windows PC's picture.
4. Send a file, open **Clip**, or wait until the practice CPU crosses 50%. Both sides should show the log line.

If the second computer cannot connect, both browsers must be able to reach the published site, and the host tab must stay open.

## Remove it

Quit Harbor from the tray icon. Then delete these two items:

- `%LOCALAPPDATA%\Harbor`
- the Harbor shortcut in the Startup folder (`shell:startup`)

## Why this is not an MSI

Microsoft's packaging guidance treats an internal tool as an unpackaged app and installs it with a script. An MSI also has to be signed or Windows SmartScreen blocks it. This environment cannot sign or build a Windows installer. When a native pointer agent exists, the next package is a signed MSIX, not an unsigned MSI.
