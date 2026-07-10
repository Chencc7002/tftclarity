param(
  [string]$TitlePattern = "TFTAgent",
  [string]$Hotkey = "Ctrl+Shift+Space",
  [string]$MutexName = "Local\TFTAgentSmallWindowHotkey",
  [ValidateRange(0, 60)]
  [int]$ExitAfterSeconds = 0
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms

if (-not ("TFTAgentHotkeyWindow" -as [type])) {
  Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @"
using System;
using System.Windows.Forms;
using System.Runtime.InteropServices;

public sealed class TFTAgentHotkeyWindow : Form {
  private const int WM_HOTKEY = 0x0312;
  private const int HotkeyId = 0x544654;
  private bool registered;

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint modifiers, uint virtualKey);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

  public event EventHandler HotkeyPressed;

  public TFTAgentHotkeyWindow() {
    ShowInTaskbar = false;
    FormBorderStyle = FormBorderStyle.FixedToolWindow;
    Opacity = 0;
    Width = 1;
    Height = 1;
  }

  public bool Register(uint modifiers, uint virtualKey) {
    registered = RegisterHotKey(Handle, HotkeyId, modifiers, virtualKey);
    return registered;
  }

  protected override void WndProc(ref Message message) {
    if (message.Msg == WM_HOTKEY) {
      EventHandler handler = HotkeyPressed;
      if (handler != null) {
        handler(this, EventArgs.Empty);
      }
    }
    base.WndProc(ref message);
  }

  protected override void OnFormClosed(FormClosedEventArgs eventArgs) {
    if (registered) {
      UnregisterHotKey(Handle, HotkeyId);
      registered = false;
    }
    base.OnFormClosed(eventArgs);
  }
}

public static class TFTAgentWindowActivation {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int command);
}
"@
}

function Resolve-Hotkey {
  param([string]$Value)

  $parts = @($Value.Split("+", [System.StringSplitOptions]::RemoveEmptyEntries) |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ })
  if ($parts.Count -lt 2) {
    throw "Hotkey must include at least one modifier and one key, for example Ctrl+Shift+Space."
  }

  $modifiers = 0
  foreach ($modifier in $parts[0..($parts.Count - 2)]) {
    switch ($modifier.ToLowerInvariant()) {
      "alt" { $modifiers = $modifiers -bor 0x0001; break }
      "ctrl" { $modifiers = $modifiers -bor 0x0002; break }
      "control" { $modifiers = $modifiers -bor 0x0002; break }
      "shift" { $modifiers = $modifiers -bor 0x0004; break }
      "win" { $modifiers = $modifiers -bor 0x0008; break }
      "windows" { $modifiers = $modifiers -bor 0x0008; break }
      default { throw "Unsupported hotkey modifier: $modifier" }
    }
  }

  try {
    $key = [System.Enum]::Parse([System.Windows.Forms.Keys], $parts[-1], $true)
  } catch {
    throw "Unsupported hotkey key: $($parts[-1])"
  }
  if ([int]$key -eq 0) {
    throw "Unsupported hotkey key: $($parts[-1])"
  }

  return [ordered]@{
    modifiers = $modifiers -bor 0x4000
    key = [int]$key
  }
}

function Restore-TFTAgentWindow {
  param([string]$Pattern)

  $window = Get-Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.MainWindowHandle -ne 0 -and
      $_.MainWindowTitle -like "*$Pattern*" -and
      ($_.ProcessName -like "msedge*" -or $_.ProcessName -like "chrome*")
    } |
    Select-Object -First 1

  if (-not $window) { return }
  [void][TFTAgentWindowActivation]::ShowWindow($window.MainWindowHandle, 9)
  [void][TFTAgentWindowActivation]::SetForegroundWindow($window.MainWindowHandle)
}

$mutex = New-Object System.Threading.Mutex($false, $MutexName)
$ownsMutex = $false
try {
  try {
    $ownsMutex = $mutex.WaitOne(0)
  } catch [System.Threading.AbandonedMutexException] {
    $ownsMutex = $true
  }
  if (-not $ownsMutex) { exit 0 }

  $registration = Resolve-Hotkey $Hotkey
  $form = New-Object TFTAgentHotkeyWindow
  $form.add_Shown({ $form.Hide() })
  $form.add_HotkeyPressed({ Restore-TFTAgentWindow $TitlePattern })
  if (-not $form.Register([uint32]$registration.modifiers, [uint32]$registration.key)) {
    throw "Could not register global hotkey: $Hotkey"
  }
  if ($ExitAfterSeconds -gt 0) {
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = $ExitAfterSeconds * 1000
    $timer.add_Tick({
      $timer.Stop()
      $form.Close()
    })
    $timer.Start()
  }

  [System.Windows.Forms.Application]::Run($form)
} finally {
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
