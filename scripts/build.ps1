param([switch]$Package)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw '缺少 Windows .NET Framework 编译器。' }
$compilerArgs = @('/nologo','/target:exe','/platform:x64','/optimize+',('/win32icon:' + (Join-Path $root 'assets\app.ico')),('/out:' + (Join-Path $root '猛人下载器.exe')),(Join-Path $root 'source\Launcher.cs'))
& $compiler @compilerArgs
if ($LASTEXITCODE -ne 0) { throw '入口构建失败。' }
if (!$Package) { exit 0 }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$zipPath = Join-Path $dist 'mengren-downloader-0.2.0-windows-x64.zip'
$files = @('猛人下载器.exe','download.ps1','bootstrap.ps1','dependencies.json','create-shortcut.ps1','创建桌面快捷方式.cmd','检查软件.cmd','使用说明.txt','组件说明.txt','README.md','LICENSE','AGENTS.md','准备开发环境.cmd')
foreach ($folder in @('assets','source','scripts','licenses','docs','tests')) {
    Get-ChildItem -LiteralPath (Join-Path $root $folder) -Recurse -File | ForEach-Object { $files += $_.FullName.Substring($root.Length + 1) }
}
if (Test-Path -LiteralPath $zipPath -PathType Leaf) { Remove-Item -LiteralPath $zipPath -Force }
$archive = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($relative in $files) {
        $entryName = '猛人下载器/' + $relative.Replace('\','/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $root $relative), $entryName, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose() }
$hashStream = [IO.File]::OpenRead($zipPath)
$hashAlgorithm = [Security.Cryptography.SHA256]::Create()
try { $hash = [BitConverter]::ToString($hashAlgorithm.ComputeHash($hashStream)).Replace('-', '').ToLowerInvariant() }
finally { $hashStream.Dispose(); $hashAlgorithm.Dispose() }
[IO.File]::WriteAllText((Join-Path $dist 'SHA256SUMS.txt'), ($hash + '  ' + [IO.Path]::GetFileName($zipPath) + "`n"), [Text.UTF8Encoding]::new($false))
Write-Host "已生成：$zipPath"
Write-Host "SHA-256：$hash"
