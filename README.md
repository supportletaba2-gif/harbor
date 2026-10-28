# Harbor

A desk you open with an ID and a PIN. The picture, controls, files, clipboard, practice shell, and practice-machine alerts travel on an encrypted peer link. The server only carries the connection setup.

Published desk: https://delta-quartz-kite-jolly.grok.me

`main`, `developer`, and `test` hold the same build.

## Windows

The tray opens that desk and listens on this PC for the Windows pointer. It does not need an administrator. An unsigned MSI is not used.

Publish the latest Harbor from Grok before you expect the **Windows pointer** button. An older published page does not have it.

```powershell
$dest = Join-Path $env:TEMP "Install-Harbor.ps1"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/supportletaba2-gif/harbor/main/agent/windows/install.ps1" -OutFile $dest -UseBasicParsing
Get-Content $dest
powershell -NoProfile -ExecutionPolicy Bypass -File $dest
```

The address is already https://delta-quartz-kite-jolly.grok.me. Read the script when `Get-Content` prints it, then run the last line.

The rest of the steps are in [agent/windows/README.md](agent/windows/README.md).
