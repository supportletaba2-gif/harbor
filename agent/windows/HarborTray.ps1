# Harbor tray. Opens the published desk and, while this window is running,
# moves the Windows pointer when that desk asks it to.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $root "config.json"
if (-not (Test-Path -LiteralPath $configPath)) {
  throw "Harbor has no config.json. Run install.ps1"
}
$script:deskUrl = (Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json).deskUrl
if ($script:deskUrl -notmatch '^https://') {
  throw "The saved desk address is not an https URL."
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not ("HarborCursor" -as [type])) {
  Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public static class HarborCursor {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern short VkKeyScan(char ch);
  public static void Apply(double nx, double ny, string action, string button, string key) {
    if (action == "key") { TypeKey(key); return; }
    var bounds = Screen.PrimaryScreen.Bounds;
    int x = bounds.Left + (int)Math.Round(Clamp(nx) * Math.Max(0, bounds.Width - 1));
    int y = bounds.Top + (int)Math.Round(Clamp(ny) * Math.Max(0, bounds.Height - 1));
    SetCursorPos(x, y);
    bool right = button == "right";
    if (action == "down") mouse_event(right ? 0x0008u : 0x0002u, 0, 0, 0, UIntPtr.Zero);
    if (action == "up") mouse_event(right ? 0x0010u : 0x0004u, 0, 0, 0, UIntPtr.Zero);
  }
  static double Clamp(double n) { if (n < 0) return 0; if (n > 1) return 1; return n; }
  static void Tap(byte vk) {
    keybd_event(vk, 0, 0, UIntPtr.Zero);
    keybd_event(vk, 0, 2, UIntPtr.Zero);
  }
  static void TypeKey(string key) {
    if (string.IsNullOrEmpty(key)) return;
    if (key == "Enter") { Tap(0x0D); return; }
    if (key == "Backspace") { Tap(0x08); return; }
    if (key == "Tab") { Tap(0x09); return; }
    if (key == "Escape") { Tap(0x1B); return; }
    if (key == "ArrowLeft") { Tap(0x25); return; }
    if (key == "ArrowUp") { Tap(0x26); return; }
    if (key == "ArrowRight") { Tap(0x27); return; }
    if (key == "ArrowDown") { Tap(0x28); return; }
    if (key.Length != 1) return;
    short packed = VkKeyScan(key[0]);
    if (packed == -1) return;
    bool shift = (packed & 0x100) != 0;
    if (shift) keybd_event(0x10, 0, 0, UIntPtr.Zero);
    Tap((byte)(packed & 0xFF));
    if (shift) keybd_event(0x10, 0, 2, UIntPtr.Zero);
  }
}
"@
}

$script:listenError = ""
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:47391/")
try {
  $listener.Start()
} catch {
  $script:listenError = $_.Exception.Message
}

if ($listener.IsListening) {
  $allowed = ([Uri]$script:deskUrl).GetLeftPart([UriPartial]::Authority)
  $runspace = [runspacefactory]::CreateRunspace()
  $runspace.Open()
  $runspace.SessionStateProxy.SetVariable("listener", $listener)
  $runspace.SessionStateProxy.SetVariable("allowedOrigin", $allowed)
  $worker = [powershell]::Create()
  $worker.Runspace = $runspace
  [void]$worker.AddScript({
    while ($listener.IsListening) {
      try { $ctx = $listener.GetContext() } catch { break }
      $req = $ctx.Request
      $res = $ctx.Response
      $origin = $req.Headers["Origin"]
      $okOrigin = ($origin -eq $allowedOrigin) -or ($origin -eq "http://127.0.0.1:8080") -or ($origin -eq "http://localhost:8080")
      if ($okOrigin) {
        $res.AddHeader("Access-Control-Allow-Origin", $origin)
        $res.AddHeader("Access-Control-Allow-Private-Network", "true")
        $res.AddHeader("Vary", "Origin")
      }
      if ($req.HttpMethod -eq "OPTIONS") {
        $res.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $res.AddHeader("Access-Control-Allow-Headers", "content-type")
        $res.StatusCode = 204
        $res.Close()
        continue
      }
      if ($origin -and -not $okOrigin) {
        $res.StatusCode = 403
        $res.Close()
        continue
      }
      if ($req.HttpMethod -eq "GET" -and $req.Url.AbsolutePath -eq "/health") {
        $bytes = [Text.Encoding]::UTF8.GetBytes('{"ok":true}')
        $res.ContentType = "application/json"
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        $res.Close()
        continue
      }
      if ($req.HttpMethod -eq "POST" -and $req.Url.AbsolutePath -eq "/cursor") {
        $reader = New-Object IO.StreamReader($req.InputStream)
        $raw = $reader.ReadToEnd()
        $reader.Close()
        try { $msg = $raw | ConvertFrom-Json } catch { $msg = $null }
        if ($null -ne $msg) {
          $nx = 0.0
          $ny = 0.0
          if ($msg.PSObject.Properties.Name -contains "x") { $nx = [double]$msg.x }
          if ($msg.PSObject.Properties.Name -contains "y") { $ny = [double]$msg.y }
          [HarborCursor]::Apply($nx, $ny, [string]$msg.action, [string]$msg.button, [string]$msg.key)
        }
        $res.StatusCode = 204
        $res.Close()
        continue
      }
      $res.StatusCode = 404
      $res.Close()
    }
  })
  $script:cursorWorker = $worker.BeginInvoke()
}
$script:cursorListener = $listener

$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = [System.Drawing.SystemIcons]::Application
$icon.Visible = $true
$icon.Text = "Harbor"

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = $menu.Items.Add("Open desk")
$open.add_Click({ Start-Process $script:deskUrl })
$limit = $menu.Items.Add($(if ($script:listenError) { "Pointer port is busy" } else { "Windows pointer is listening" }))
$limit.Enabled = $false
$quit = $menu.Items.Add("Quit")
$quit.add_Click({
  try { $script:cursorListener.Stop() } catch {}
  $icon.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})
$icon.ContextMenuStrip = $menu
$icon.add_DoubleClick({ Start-Process $script:deskUrl })

Start-Process $script:deskUrl
$tip = if ($script:listenError) { "The desk is open. The pointer port is already in use." } else { "The desk is open. Arm Windows pointer there to move this cursor." }
$icon.ShowBalloonTip(4000, "Harbor", $tip, [System.Windows.Forms.ToolTipIcon]::Info) | Out-Null
[System.Windows.Forms.Application]::Run()
