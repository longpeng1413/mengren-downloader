param(
    [Parameter(Mandatory=$true)][string]$Zip,
    [Parameter(Mandatory=$true)][string]$Root,
    [Parameter(Mandatory=$true)][int]$WaitPid,
    [Parameter(Mandatory=$true)][string]$Result,
    [string]$Version,
    [switch]$Restart
)
# Installs a verified full package over the program folder after the window version
# exits. Files are only added or replaced, never deleted, so anything the user put in
# the folder stays. gui-server.mjs copies this script next to the package and runs it.
$ErrorActionPreference = 'Stop'
function Save-Result([bool]$Ok, [string]$Text) {
    $json = @{ ok = $Ok; version = $Version; message = $Text; time = (Get-Date -Format s) } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($Result, $json, [Text.UTF8Encoding]::new($false))
}
$staging = Join-Path (Split-Path -Parent $Zip) 'staging'
try {
    for ($i = 0; $i -lt 240 -and (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
    # Downloads, capture or browser helpers started from the program folder must finish first.
    $rootPrefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    for ($i = 0; $i -lt 120; $i++) {
        $busy = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $PID -and $_.Path -and $_.Path.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) })
        if (!$busy.Count) { break }
        Start-Sleep -Milliseconds 500
    }
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($Zip, $staging)
    $source = Join-Path $staging '猛人下载器'
    foreach ($required in @('猛人下载器.exe','download.ps1','node.exe','yt-dlp.exe','ffmpeg.exe','source\gui-server.mjs')) {
        if (!(Test-Path -LiteralPath (Join-Path $source $required) -PathType Leaf)) { throw "更新包缺少 $required" }
    }
    $sourcePrefix = [IO.Path]::GetFullPath($source).TrimEnd('\') + '\'
    foreach ($file in Get-ChildItem -LiteralPath $source -Recurse -File) {
        $relative = $file.FullName.Substring($sourcePrefix.Length)
        $target = Join-Path $Root $relative
        $folder = Split-Path -Parent $target
        if (!(Test-Path -LiteralPath $folder)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
        for ($attempt = 1; ; $attempt++) {
            try { Copy-Item -LiteralPath $file.FullName -Destination $target -Force; break }
            catch { if ($attempt -ge 40) { throw "无法替换 $relative（可能正被占用）" }; Start-Sleep -Milliseconds 500 }
        }
    }
    Save-Result $true '更新完成'
} catch {
    Save-Result $false $_.Exception.Message
} finally {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $Zip -Force -ErrorAction SilentlyContinue
}
if ($Restart) { Start-Process -FilePath (Join-Path $Root '猛人下载器.exe') -WorkingDirectory $Root }
