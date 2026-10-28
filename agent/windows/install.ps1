# Installs the Harbor tray for the current Windows user. No administrator, no MSI.
param(
  [Parameter(Mandatory = $true)]
  [string]$DeskUrl,
  [string]$Branch = "main"
)
$ErrorActionPreference = "Stop"
if ($DeskUrl -notmatch '^https://') {
  throw "DeskUrl must be the https address from publishing Harbor. Example: -DeskUrl https://your-app.example"
}

$dest = Join-Path $env:LOCALAPPDATA "Harbor"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

$trayName = "HarborTray.ps1"
$beside = Join-Path $PSScriptRoot $trayName
$trayDest = Join-Path $dest $trayName
if (Test-Path -LiteralPath $beside) {
  Copy-Item -LiteralPath $beside -Destination $trayDest -Force
} else {
  $raw = "https://raw.githubusercontent.com/supportletaba2-gif/harbor/$Branch/agent/windows/$trayName"
  Invoke-WebRequest -Uri $raw -OutFile $trayDest -UseBasicParsing
}

@{ deskUrl = $DeskUrl } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $dest "config.json") -Encoding utf8

$startup = [Environment]::GetFolderPath("Startup")
$lnkPath = Join-Path $startup "Harbor.lnk"
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($lnkPath)
$link.TargetPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$link.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$trayDest`""
$link.WorkingDirectory = $dest
$link.WindowStyle = 7
$link.Description = "Harbor desk"
$link.Save()

Start-Process -FilePath $link.TargetPath -ArgumentList $link.Arguments -WorkingDirectory $dest
Write-Host "Installed for this user: $dest"
Write-Host "Opens: $DeskUrl"
Write-Host "Starts again at sign-in. Quit it from the tray icon."
Write-Host "This tray does not move the Windows pointer."
