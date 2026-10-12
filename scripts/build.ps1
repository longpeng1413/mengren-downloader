param([switch]$Package,[switch]$FullPackage)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw '缺少 Windows .NET Framework 编译器。' }
$compilerArgs = @('/nologo','/target:exe','/platform:x64','/optimize+',('/win32icon:' + (Join-Path $root 'assets\app.ico')),('/out:' + (Join-Path $root '猛人下载器.exe')),(Join-Path $root 'source\Launcher.cs'))
& $compiler @compilerArgs
if ($LASTEXITCODE -ne 0) { throw '入口构建失败。' }
$helperArgs = @('/nologo','/target:exe','/platform:x64','/optimize+','/r:System.Web.Extensions.dll',('/out:' + (Join-Path $root 'CaptureHelper.exe')),(Join-Path $root 'source\CaptureHelper.cs'))
& $compiler @helperArgs
if ($LASTEXITCODE -ne 0) { throw '抓取辅助模块构建失败，需要 .NET Framework 4.8。' }
if (!$Package) { exit 0 }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$zipName = 'mengren-downloader-0.4.1-windows-x64.zip'
if ($FullPackage) { $zipName = 'mengren-downloader-0.4.1-windows-x64-full.zip' }
$zipPath = Join-Path $dist $zipName
$files = @('猛人下载器.exe','CaptureHelper.exe','恢复网络.cmd','抓取使用说明.txt','download.ps1','bootstrap.ps1','dependencies.json','create-shortcut.ps1','创建桌面快捷方式.cmd','检查软件.cmd','使用说明.txt','组件说明.txt','README.md','LICENSE','AGENTS.md','准备开发环境.cmd')
if ($FullPackage) {
    . (Join-Path $root 'bootstrap.ps1')
    $bundleManifest = Get-Content -LiteralPath (Join-Path $root 'dependencies.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($component in $bundleManifest.components) {
        if (!(Test-ComponentHash (Join-Path $root $component.name) $component.sha256)) { throw ('完整包缺少或无法校验 ' + $component.name + '；请先运行开发准备入口。') }
        $files += $component.name
    }
}
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
[IO.File]::WriteAllText((Join-Path $dist $(if ($FullPackage) { 'SHA256SUMS-full.txt' } else { 'SHA256SUMS.txt' })), ($hash + '  ' + [IO.Path]::GetFileName($zipPath) + "`n"), [Text.UTF8Encoding]::new($false))
Write-Host "已生成：$zipPath"
Write-Host "SHA-256：$hash"
