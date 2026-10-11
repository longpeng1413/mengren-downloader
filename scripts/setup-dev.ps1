param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot
try {
    if ($env:OS -ne 'Windows_NT') { throw '开发准备入口仅支持 Windows。' }
    $architecture = $env:PROCESSOR_ARCHITECTURE
    if ($env:PROCESSOR_ARCHITEW6432) { $architecture = $env:PROCESSOR_ARCHITEW6432 }
    if ($architecture -ne 'AMD64') { throw '当前版本仅支持 Intel/AMD x64 Windows，不支持 ARM64 或 32 位系统。' }
    if ($PSVersionTable.PSVersion -lt [Version]'5.1') { throw '需要 Windows PowerShell 5.1 或以上。' }
    $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (!(Test-Path -LiteralPath $windowsPowerShell -PathType Leaf)) { throw '缺少 Windows 自带 PowerShell；请按开发文档修复系统组件。' }
    if (!(Test-Path -LiteralPath $compiler -PathType Leaf)) { throw '缺少 .NET Framework csc.exe；请按开发文档准备，现代 .NET SDK 不替代此编译器。' }
    $git = Get-Command git.exe -ErrorAction SilentlyContinue
    if (!$git) { throw '缺少 Git for Windows。请执行 winget install --id Git.Git -e --source winget，安装后重开终端；详见 docs/DEVELOPMENT.md。' }
    & $git.Source --version
    if ($LASTEXITCODE -ne 0) { throw 'Git 无法启动。' }
    $cli = Get-Command gh.exe -ErrorAction SilentlyContinue
    if ($cli) {
        & $cli.Source --version
        if ($LASTEXITCODE -ne 0) { throw '已安装的 GitHub CLI 无法启动，请修复或调整 PATH。' }
    } else { Write-Host 'GitHub CLI 未安装；不影响本地开发，发布时按开发文档准备。' }
    foreach ($relative in @('assets\app.ico','source\Launcher.cs','scripts\build.ps1','download.ps1','bootstrap.ps1','dependencies.json')) {
        if (!(Test-Path -LiteralPath (Join-Path $root $relative) -PathType Leaf)) { throw "源码缺少 $relative，请获取完整仓库。" }
    }
    Write-Host '基础开发条件检查通过。' -ForegroundColor Green
    if ($CheckOnly) { exit 0 }
    Write-Host '编译入口并生成公开便携包。'
    & $windowsPowerShell -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\build.ps1') -Package
    if ($LASTEXITCODE -ne 0) { throw '构建失败；请查看上方错误。' }
    & (Join-Path $root '猛人下载器.exe') --check
    if ($LASTEXITCODE -ne 0) { throw '组件准备或启动验证失败；修复网络/权限后可重跑，已校验的组件会复用。' }
    Write-Host '开发环境已准备好，可以继续修改和测试。未下载视频，也未登录或推送 GitHub。' -ForegroundColor Green
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
