# Reinstalls the Harbor tray from GitHub and checks the published connection service.
$ErrorActionPreference = "Stop"
$desk = "https://delta-quartz-kite-jolly.grok.me"
$dir = Join-Path $env:TEMP "harbor-update"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$base = "https://raw.githubusercontent.com/supportletaba2-gif/harbor/main/agent/windows"
Invoke-WebRequest -Uri "$base/install.ps1" -OutFile (Join-Path $dir "install.ps1") -UseBasicParsing
Invoke-WebRequest -Uri "$base/HarborTray.ps1" -OutFile (Join-Path $dir "HarborTray.ps1") -UseBasicParsing
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir "install.ps1") -DeskUrl $desk

try {
  $probe = Invoke-WebRequest -Uri "$desk/api/rtc?probe=1" -UseBasicParsing
  Write-Host "Connection service: $($probe.StatusCode) $($probe.Content)"
  if ($probe.Content -match '"ok"\s*:\s*true' -and $probe.Content -match '"db"\s*:\s*"neon"') {
    Write-Host "The connection service is working."
    Write-Host "Harbor does not use a Windows password. The PIN on the desk is checked when the other computer connects."
    Write-Host "On this PC choose Share this display. Wait until the status says Waiting, not Not live. Copy that ID and PIN. Paste them on the other computer and choose Connect."
  } else {
    Write-Host "The site answered, but two computers cannot meet yet. Publish Harbor from Grok again, then run this command once more."
  }
} catch {
  Write-Host "Connection service did not answer: $($_.Exception.Message)"
  Write-Host "Publish Harbor from Grok again, then run this command once more."
}
