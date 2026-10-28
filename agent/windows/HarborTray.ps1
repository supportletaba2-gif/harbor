# Harbor tray for Windows. Opens the published desk in the browser.
# It does not move the Windows pointer. That needs a signed native agent, which this preview cannot build.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $root "config.json"
if (-not (Test-Path -LiteralPath $configPath)) {
  throw "Harbor has no config.json. Run install.ps1 -DeskUrl https://your-published-desk"
}
$script:deskUrl = (Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json).deskUrl
if ($script:deskUrl -notmatch '^https://') {
  throw "The saved desk address is not an https URL."
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = [System.Drawing.SystemIcons]::Application
$icon.Visible = $true
$icon.Text = "Harbor"

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = $menu.Items.Add("Open desk")
$open.add_Click({ Start-Process $script:deskUrl })
$limit = $menu.Items.Add("Does not move the Windows pointer")
$limit.Enabled = $false
$quit = $menu.Items.Add("Quit")
$quit.add_Click({
  $icon.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})
$icon.ContextMenuStrip = $menu
$icon.add_DoubleClick({ Start-Process $script:deskUrl })

Start-Process $script:deskUrl
$icon.ShowBalloonTip(4000, "Harbor", "The desk is open in the browser.", [System.Windows.Forms.ToolTipIcon]::Info) | Out-Null
[System.Windows.Forms.Application]::Run()
