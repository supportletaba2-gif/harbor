# Harbor

A desk you open with an ID and a PIN. The picture, controls, files, clipboard, practice shell, and practice-machine alerts travel on an encrypted peer link. The server only carries the connection setup.

## Branches

`main`, `developer`, and `test` currently hold the same build.

## Try it in a browser

Publish this app, then open the published address.

1. On the host computer, choose **Start desk**. Leave that tab open. Note the ID and PIN.
2. On the other computer, open the same address, enter that ID and PIN, and choose **Connect**.

Do not use "Use the desk on this page" when the two sides are different computers.

## Windows tray

The tray opens the published desk in the browser for the current user. It does not move the Windows pointer. An unsigned MSI is not included: for an internal tool, a per-user script is the install Microsoft recommends, and an unsigned MSI is blocked by SmartScreen.

On the Windows PC, paste this in PowerShell. Replace the address with the one from publishing.

```powershell
$dest = Join-Path $env:TEMP "Install-Harbor.ps1"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/supportletaba2-gif/harbor/main/agent/windows/install.ps1" -OutFile $dest -UseBasicParsing
powershell -NoProfile -ExecutionPolicy Bypass -File $dest -DeskUrl "https://YOUR-PUBLISHED-ADDRESS"
```

Read `Install-Harbor.ps1` before you run it. Details are in [agent/windows/README.md](agent/windows/README.md).
