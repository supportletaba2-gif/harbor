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
using System.Threading;
using System.Windows.Forms;
public static class HarborCursor {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern short VkKeyScan(char ch);
  public static void Apply(double nx, double ny, string action, string button, string key, bool ctrl, bool alt, bool shift, int wheel) {
    if (action == "key") { TypeKey(key, ctrl, alt, shift); return; }
    if (action == "clip") { PasteClip(key); return; }
    if (action == "wheel") { Move(nx, ny); Wheel(wheel); return; }
    Move(nx, ny);
    bool right = button == "right";
    var screen = Screen.PrimaryScreen;
    if (screen == null) return;
    var bounds = screen.Bounds;
    var vs = SystemInformation.VirtualScreen;
    int x = bounds.Left + (int)Math.Round(Clamp(nx) * Math.Max(0, bounds.Width - 1));
    int y = bounds.Top + (int)Math.Round(Clamp(ny) * Math.Max(0, bounds.Height - 1));
    int ax = (int)Math.Round((x - vs.Left) * 65535.0 / Math.Max(1, vs.Width - 1));
    int ay = (int)Math.Round((y - vs.Top) * 65535.0 / Math.Max(1, vs.Height - 1));
    if (ax < 0) ax = 0;
    if (ay < 0) ay = 0;
    if (ax > 65535) ax = 65535;
    if (ay > 65535) ay = 65535;
    uint flags = 0x8000u | 0x0001u;
    if (action == "down") flags |= right ? 0x0008u : 0x0002u;
    if (action == "up") flags |= right ? 0x0010u : 0x0004u;
    mouse_event(flags, (uint)ax, (uint)ay, 0, UIntPtr.Zero);
    if (action == "down" || action == "up") SetCursorPos(x, y);
  }
  static void Move(double nx, double ny) {
    var screen = Screen.PrimaryScreen;
    if (screen == null) return;
    var bounds = screen.Bounds;
    int x = bounds.Left + (int)Math.Round(Clamp(nx) * Math.Max(0, bounds.Width - 1));
    int y = bounds.Top + (int)Math.Round(Clamp(ny) * Math.Max(0, bounds.Height - 1));
    SetCursorPos(x, y);
  }
  static void Wheel(int notches) {
    if (notches == 0) return;
    mouse_event(0x0800, 0, 0, unchecked((uint)(notches * 120)), UIntPtr.Zero);
  }
  static void PasteClip(string text) {
    if (string.IsNullOrEmpty(text)) return;
    if (text.Length > 2000) text = text.Substring(0, 2000);
    var thread = new Thread(() => { try { Clipboard.SetText(text); } catch { } });
    thread.SetApartmentState(ApartmentState.STA);
    thread.IsBackground = true;
    thread.Start();
    thread.Join(1000);
  }
  static double Clamp(double n) { if (n < 0) return 0; if (n > 1) return 1; return n; }
  static void Tap(byte vk) {
    keybd_event(vk, 0, 0, UIntPtr.Zero);
    keybd_event(vk, 0, 2, UIntPtr.Zero);
  }
  static byte Named(string key) {
    if (key == "Enter") return 0x0D;
    if (key == "Backspace") return 0x08;
    if (key == "Tab") return 0x09;
    if (key == "Escape") return 0x1B;
    if (key == "Delete") return 0x2E;
    if (key == "Home") return 0x24;
    if (key == "End") return 0x23;
    if (key == "PageUp") return 0x21;
    if (key == "PageDown") return 0x22;
    if (key == "ArrowLeft") return 0x25;
    if (key == "ArrowUp") return 0x26;
    if (key == "ArrowRight") return 0x27;
    if (key == "ArrowDown") return 0x28;
    return 0;
  }
  static void TypeKey(string key, bool ctrl, bool alt, bool shift) {
    if (string.IsNullOrEmpty(key)) return;
    byte vk = Named(key);
    bool vkShift = false;
    if (vk == 0) {
      if (key.Length != 1) return;
      short packed = VkKeyScan(key[0]);
      if (packed == -1) return;
      vkShift = (packed & 0x100) != 0;
      vk = (byte)(packed & 0xFF);
    }
    if (ctrl) keybd_event(0x11, 0, 0, UIntPtr.Zero);
    if (alt) keybd_event(0x12, 0, 0, UIntPtr.Zero);
    if (shift || vkShift) keybd_event(0x10, 0, 0, UIntPtr.Zero);
    Tap(vk);
    if (shift || vkShift) keybd_event(0x10, 0, 2, UIntPtr.Zero);
    if (alt) keybd_event(0x12, 0, 2, UIntPtr.Zero);
    if (ctrl) keybd_event(0x11, 0, 2, UIntPtr.Zero);
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
          $ctrl = $false
          $alt = $false
          $shift = $false
          $wheel = 0
          if ($msg.PSObject.Properties.Name -contains "ctrl" -and $msg.ctrl) { $ctrl = $true }
          if ($msg.PSObject.Properties.Name -contains "alt" -and $msg.alt) { $alt = $true }
          if ($msg.PSObject.Properties.Name -contains "shift" -and $msg.shift) { $shift = $true }
          if ($msg.PSObject.Properties.Name -contains "delta") { $wheel = [int]$msg.delta }
          [HarborCursor]::Apply($nx, $ny, [string]$msg.action, [string]$msg.button, [string]$msg.key, $ctrl, $alt, $shift, $wheel)
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
$tip = if ($script:listenError) { "The desk is open. The pointer port is already in use." } else { "The desk is open. Click Allow the pointer, then choose Allow." }
$icon.ShowBalloonTip(4000, "Harbor", $tip, [System.Windows.Forms.ToolTipIcon]::Info) | Out-Null
[System.Windows.Forms.Application]::Run()
