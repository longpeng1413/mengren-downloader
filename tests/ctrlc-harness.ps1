# Test helper: runs the launcher in this hidden console and sends a real Ctrl+C.
param([string]$Launcher,[string]$Result)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class MengrenConsole {
    [DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
    [DllImport("kernel32.dll")] public static extern bool GenerateConsoleCtrlEvent(uint ctrlEvent, uint group);
}
'@
$start = New-Object Diagnostics.ProcessStartInfo $Launcher
$start.UseShellExecute = $false; $start.RedirectStandardInput = $true; $start.RedirectStandardOutput = $true
$start.StandardOutputEncoding = New-Object Text.UTF8Encoding $false
$start.WorkingDirectory = Split-Path -Parent $Launcher
# Parents such as test runners may start us with Ctrl+C disabled, and that flag is
# inherited; restore normal Ctrl+C processing before starting the launcher.
[void][MengrenConsole]::SetConsoleCtrlHandler([IntPtr]::Zero, $false)
$process = [Diagnostics.Process]::Start($start)
# Ignore Ctrl+C here only after the launcher started, so it does not inherit that.
[void][MengrenConsole]::SetConsoleCtrlHandler([IntPtr]::Zero, $true)
$text = New-Object Text.StringBuilder; $ready = 0; $sentCtrlC = $false; $deadline = [DateTime]::UtcNow.AddSeconds(40)
$reader = $process.StandardOutput
$pending = $reader.ReadLineAsync()
while ([DateTime]::UtcNow -lt $deadline) {
    if ($pending.Wait(200)) {
        $line = $pending.Result
        if ($null -eq $line) { break }
        [void]$text.AppendLine($line)
        if ($line -eq 'SESSION_READY') { $ready++; $process.StandardInput.WriteLine($(if ($ready -eq 1) { 'long' } else { '' })); $process.StandardInput.Flush() }
        if ($line -eq 'LONG_START' -and !$sentCtrlC) { Start-Sleep -Milliseconds 1500; $sentCtrlC = [MengrenConsole]::GenerateConsoleCtrlEvent(0, 0) }
        $pending = $reader.ReadLineAsync()
    }
}
if (!$process.WaitForExit(10000)) { $process.Kill(); $code = 'timeout' } else { $code = $process.ExitCode }
@{ code = $code; ready = $ready; sentCtrlC = $sentCtrlC; text = $text.ToString() } | ConvertTo-Json | Set-Content -LiteralPath $Result -Encoding UTF8
