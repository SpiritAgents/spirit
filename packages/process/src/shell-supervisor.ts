// The supervisor outlives a host crash long enough to reap its owned process group.
// Deliberately daemonized processes that create a new session require an OS sandbox boundary.
export const POSIX_SHELL_SUPERVISOR = String.raw`
import { spawn } from "node:child_process";
let child;
let stopping = false;
function report(message) {
  if (process.connected) process.send(message);
}
function stopGroup() {
  stopping = true;
  if (!child?.pid) return;
  try { process.kill(-child.pid, "SIGKILL"); }
  catch (error) {
    if (error.code !== "ESRCH") {
      report({ kind: "error", error: "Failed to stop the shell process group: " + error.message });
      process.exitCode = 1;
    }
  }
}
process.on("disconnect", stopGroup);
process.on("SIGTERM", stopGroup);
process.stdout.on("error", stopGroup);
process.stderr.on("error", stopGroup);
process.on("message", (message) => {
  if (message?.kind === "stop") { stopGroup(); return; }
  if (message?.kind !== "start" || child) return;
  if (stopping) {
    report({ kind: "result", exitCode: null });
    process.disconnect();
    return;
  }
  child = spawn(message.file, message.args, {
    cwd: message.cwd,
    env: message.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(process.stdout, { end: false });
  child.stderr.pipe(process.stderr, { end: false });
  child.on("error", (error) => report({ kind: "error", error: error.message }));
  child.on("exit", stopGroup);
  child.on("close", (code) => {
    if (process.connected) {
      process.send({ kind: "result", exitCode: code }, () => {
        if (process.connected) process.disconnect();
      });
    }
  });
});
if (process.connected) report({ kind: "ready" });
else stopGroup();
`;

// Windows creates the command suspended, assigns a kill-on-close Job Object, then resumes it.
// The control pipe closes with the host; the job also closes if this supervisor terminates.
export const WINDOWS_SHELL_SUPERVISOR = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;

public static class SpiritShellSupervisor {
  [StructLayout(LayoutKind.Sequential)]
  struct Startup {
    public int cb; public string reserved; public string desktop; public string title;
    public uint x, y, xSize, ySize, xChars, yChars, fill, flags;
    public ushort show, reservedSize;
    public IntPtr reservedData, input, output, error;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ProcessInfo { public IntPtr process, thread; public uint pid, tid; }
  [StructLayout(LayoutKind.Sequential)]
  struct BasicLimits {
    public long processTime, jobTime; public uint flags;
    public UIntPtr minWorkingSet, maxWorkingSet; public uint activeProcesses;
    public UIntPtr affinity; public uint priority, scheduling;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct IoCounters { public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes; }
  [StructLayout(LayoutKind.Sequential)]
  struct ExtendedLimits {
    public BasicLimits basic; public IoCounters io;
    public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool SetInformationJobObject(IntPtr job, int type, ref ExtendedLimits info, uint size);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CreateProcess(string file, StringBuilder args, IntPtr processAttributes,
    IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string cwd,
    ref Startup startup, out ProcessInfo info);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int id);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess,
    out IntPtr target, uint access, bool inherit, uint options);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr attributes,
    uint creation, uint flags, IntPtr template);

  static IntPtr Inherit(IntPtr handle) {
    IntPtr copy;
    if (!DuplicateHandle(GetCurrentProcess(), handle, GetCurrentProcess(), out copy, 0, true, 2))
      throw new Win32Exception();
    return copy;
  }
  static string Quote(string value) {
    var result = new StringBuilder("\"");
    int slashes = 0;
    foreach (char c in value) {
      if (c == '\\') { slashes++; continue; }
      result.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
      result.Append(c); slashes = 0;
    }
    result.Append('\\', slashes * 2);
    return result.Append('"').ToString();
  }
  public static int Run(string file, string[] args, string cwd) {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Win32Exception();
    ProcessInfo child = new ProcessInfo();
    IntPtr nul = IntPtr.Zero, input = IntPtr.Zero, output = IntPtr.Zero, error = IntPtr.Zero;
    bool assigned = false;
    try {
      var limits = new ExtendedLimits();
      limits.basic.flags = 0x2000;
      if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))))
        throw new Win32Exception();
      nul = CreateFile("NUL", 0x80000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
      if (nul == new IntPtr(-1)) throw new Win32Exception();
      input = Inherit(nul); output = Inherit(GetStdHandle(-11)); error = Inherit(GetStdHandle(-12));
      var startup = new Startup { cb = Marshal.SizeOf(typeof(Startup)), flags = 0x100,
        input = input, output = output, error = error };
      var command = new StringBuilder(Quote(file));
      if (System.IO.Path.GetFileName(file).Equals("cmd.exe", StringComparison.OrdinalIgnoreCase)) {
        command.Append(" /d /s /c \"").Append(args[args.Length - 1]).Append('"');
      } else {
        foreach (string arg in args) command.Append(' ').Append(Quote(arg));
      }
      if (!CreateProcess(file, command, IntPtr.Zero, IntPtr.Zero, true, 0x08000004,
          IntPtr.Zero, cwd, ref startup, out child)) throw new Win32Exception();
      if (!AssignProcessToJobObject(job, child.process)) throw new Win32Exception();
      assigned = true;
      if (ResumeThread(child.thread) == 0xffffffff) throw new Win32Exception();
      var control = Task.Run(() => Console.In.ReadLine());
      for (;;) {
        uint waited = WaitForSingleObject(child.process, 50);
        if (waited == 0) break;
        if (waited != 258) throw new Win32Exception();
        if (control.IsCompleted) {
          if (!TerminateJobObject(job, 1)) throw new Win32Exception();
          WaitForSingleObject(child.process, 0xffffffff);
          break;
        }
      }
      uint code;
      if (!GetExitCodeProcess(child.process, out code)) throw new Win32Exception();
      return unchecked((int)code);
    } finally {
      if (child.process != IntPtr.Zero && !assigned) TerminateProcess(child.process, 1);
      CloseHandle(job);
      if (child.thread != IntPtr.Zero) CloseHandle(child.thread);
      if (child.process != IntPtr.Zero) CloseHandle(child.process);
      if (input != IntPtr.Zero) CloseHandle(input);
      if (output != IntPtr.Zero) CloseHandle(output);
      if (error != IntPtr.Zero) CloseHandle(error);
      if (nul != IntPtr.Zero && nul != new IntPtr(-1)) CloseHandle(nul);
    }
  }
}
'@
try {
  $spec = [Console]::In.ReadLine() | ConvertFrom-Json
  $code = [SpiritShellSupervisor]::Run($spec.file, [string[]]$spec.args, $spec.cwd)
  exit $code
} catch {
  [Console]::Error.WriteLine("Shell supervisor failed: " + $_.Exception.Message)
  exit 1
}
`;
