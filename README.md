# Harbor

One computer shares its display. The other opens it with that ID and PIN.

Published desk: https://delta-quartz-kite-jolly.grok.me

`main`, `developer`, and `test` hold the same build.

## Update the Windows PC

Paste this in PowerShell whenever the agent should be updated. It does not need an administrator. It downloads the latest tray, opens the published desk, and checks the connection service.

```powershell
$dest = Join-Path $env:TEMP "Update-Harbor.ps1"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/supportletaba2-gif/harbor/main/agent/windows/update.ps1" -OutFile $dest -UseBasicParsing
powershell -NoProfile -ExecutionPolicy Bypass -File $dest
```

Then, on that PC, choose **Share this display**. Wait until the status says **Waiting**, not **Not live**. Copy the ID and PIN from that screen. On the other computer, paste the same ID and PIN and choose **Connect**. The PIN is checked on the encrypted link after the desk is found. A desk that is still Not live, or a different ID, cannot connect.

Publish this build from Grok before expecting the connection check to pass. The address stays the same. Until that publish, the live connection service answers with an error, which is what the last test hit.
