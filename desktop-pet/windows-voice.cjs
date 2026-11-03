const { execFile } = require('node:child_process');
const path = require('node:path');

// The native bridge has a fixed shortcut and checks foreground ownership at dispatch.
const command = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PetVoiceShortcut {
  [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int x,y; public uint data,flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct Keyboard { public ushort key,scan; public uint flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct Payload { [FieldOffset(0)] public Mouse mouse; [FieldOffset(0)] public Keyboard keyboard; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint type; public Payload payload; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, Input[] inputs, int size);
  public static bool Open(long handle) {
    if (GetForegroundWindow().ToInt64() != handle) return false;
    var events = new Input[4];
    ushort[] keys = { 0x5B, 0x48, 0x48, 0x5B };
    for (int i=0; i<4; i++) { events[i].type=1; events[i].payload.keyboard.key=keys[i]; events[i].payload.keyboard.flags=i>=2 ? 2u : 0u; }
    if (SendInput(4, events, Marshal.SizeOf(typeof(Input))) == 4) return true;
    events[0].payload.keyboard.flags=2; events[1].payload.keyboard.flags=2;
    SendInput(2, events, Marshal.SizeOf(typeof(Input)));
    return false;
  }
}
'@
if (-not [PetVoiceShortcut]::Open([long]::Parse($env:TFT_PET_VOICE_HWND))) { exit 3 }
`;

function launchWindowsVoice(handle, { platform = process.platform, run = execFile } = {}) {
  if (platform !== 'win32' || typeof handle !== 'bigint' || handle <= 0n) return Promise.resolve({ ok: false, error: '请在 Windows 中使用语音输入。' });
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise(resolve => {
    run(executable, ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true, timeout: 10000, maxBuffer: 16384,
      env: { ...process.env, TFT_PET_VOICE_HWND: String(handle) },
    }, error => resolve(error
      ? { ok: false, error: '未能打开语音输入，请点回输入框后按 Win+H。' }
      : { ok: true }));
  });
}
module.exports = { launchWindowsVoice };
