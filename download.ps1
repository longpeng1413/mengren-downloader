param(
    [string]$Url,
    [ValidateSet('best','1080','720','480')][string]$Quality,
    [string]$OutputDirectory,
    [switch]$Check,
    [switch]$Probe,
    [switch]$Session
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
$env:PYTHONIOENCODING = 'utf-8'
function Read-MengrenInput([string]$Prompt) {
    [Console]::Write($Prompt + ': ')
    [Console]::Out.Flush()
    return [Console]::ReadLine()
}
$toolRoot = $PSScriptRoot
try {
    if ($Session -and !$Check -and !$Probe) {
        Write-Host '猛人下载器：连续下载模式'
        $Url = Read-MengrenInput '请粘贴下一条视频链接，或输入 抓取；直接回车退出'
        if ([string]::IsNullOrWhiteSpace($Url)) { exit 20 }
    }
    if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
        try {
            $downloadFolderShell = New-Object -ComObject Shell.Application
            $downloadFolder = $downloadFolderShell.Namespace('shell:Downloads')
            if ($downloadFolder) { $OutputDirectory = $downloadFolder.Self.Path }
        } catch { }
        if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
            $configuredDownloads = Get-ItemPropertyValue -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders' -Name '{374DE290-123F-4565-9164-39C4925E467B}'
            $OutputDirectory = [Environment]::ExpandEnvironmentVariables($configuredDownloads)
        }
    }
    if ([string]::IsNullOrWhiteSpace($OutputDirectory) -or ![IO.Path]::IsPathRooted($OutputDirectory)) {
        throw '无法读取系统下载文件夹，请用 -OutputDirectory 指定完整保存路径。'
    }
    . (Join-Path $toolRoot 'bootstrap.ps1')
    Initialize-MengrenComponents $toolRoot
    foreach ($name in @('yt-dlp.exe','ffmpeg.exe','node.exe')) {
        if (!(Test-Path -LiteralPath (Join-Path $toolRoot $name) -PathType Leaf)) {
            throw "缺少 $name，请恢复完整的猛人下载器文件夹。"
        }
    }
    if (!(Test-Path -LiteralPath (Join-Path $toolRoot 'CaptureHelper.exe') -PathType Leaf)) { throw '缺少 CaptureHelper.exe，请完整解压新版软件包。' }
    if ($Check) {
        & (Join-Path $toolRoot 'CaptureHelper.exe') check $env:TEMP
        if ($LASTEXITCODE -ne 0) { throw '抓取辅助模块启动失败，需要 .NET Framework 4.8。' }
        & (Join-Path $toolRoot 'yt-dlp.exe') --version
        if ($LASTEXITCODE -ne 0) { throw '下载程序启动失败' }
        $version = & (Join-Path $toolRoot 'ffmpeg.exe') -version
        if ($LASTEXITCODE -ne 0) { throw '音画合并程序启动失败' }
        Write-Host $version[0]
        & (Join-Path $toolRoot 'node.exe') --version
        if ($LASTEXITCODE -ne 0) { throw 'YouTube 解析组件启动失败' }
        Write-Host "猛人下载器检查通过。默认保存位置：$OutputDirectory"
        exit 0
    }
    if (!$Url) {
        Write-Host '猛人下载器 v0.4.0-alpha.3（便携版）'
        Write-Host "默认保存位置：$OutputDirectory"
        $Url = Read-MengrenInput '请粘贴视频网页链接'
    }
    if ($Url -and $Url.Trim() -eq '抓取') {
        & (Join-Path $toolRoot 'node.exe') (Join-Path $toolRoot 'source\capture.mjs') --output $OutputDirectory
        exit $LASTEXITCODE
    }
    $Url = $Url.Trim()
    $inputAddress = $null
    if (![Uri]::TryCreate($Url,[UriKind]::Absolute,[ref]$inputAddress) -or $inputAddress.Scheme -notin @('http','https')) {
        foreach ($match in [regex]::Matches($Url,'https?://[^\s<>"“”]+')) {
            $candidate = $match.Value.TrimEnd([char[]]'。，、；;！!)]}）】')
            $candidateUri = $null
            if ([Uri]::TryCreate($candidate,[UriKind]::Absolute,[ref]$candidateUri) -and $candidateUri.DnsSafeHost -match '(^|\.)(douyin\.com|iesdouyin\.com|bilibili\.com|b23\.tv|youtube\.com|youtu\.be|weixin\.qq\.com|xet\.tech|xetslk\.com|xetlk\.com)$') {
                $Url = $candidate
                break
            }
        }
    }
    $parsed = $null
    if (![Uri]::TryCreate($Url,[UriKind]::Absolute,[ref]$parsed) -or $parsed.Scheme -notin @('https','http') -or !$parsed.Host) {
        throw '请输入完整的 http 或 https 视频网页链接。'
    }
    $siteHost = $parsed.DnsSafeHost.ToLowerInvariant()
    $browserSite = $siteHost -in @('weixin.qq.com','channels.weixin.qq.com','douyin.com','www.douyin.com','v.douyin.com','www.iesdouyin.com') -or $siteHost -match '(^|\.)(xet\.tech|xetslk\.com|xetlk\.com|xiaoeknow\.com|xiaoe-tech\.com|xet\.citv\.cn|xet\.pomoho\.com)$'
    if ($browserSite) {
        Write-Host '将打开下载专用 Edge。首次使用请在原网站正常登录，之后会复用登录直到过期。'
        if ($siteHost -in @('weixin.qq.com','channels.weixin.qq.com')) {
            Write-Host '视频号分享链接将发给腾讯元宝解析；只发送这条链接，不发送聊天消息或转交登录信息。'
        }
        Write-Host '小鹅通、视频号和抖音当前下载网站提供的原始画质，不保证可以指定分辨率。'
        $siteArgs = @((Join-Path $toolRoot 'source\site-download.mjs'),'--url',$Url,'--output',$OutputDirectory)
        if ($Probe) { $siteArgs += '--probe' }
        & (Join-Path $toolRoot 'node.exe') @siteArgs
        exit $LASTEXITCODE
    }
    if (!$Quality) {
        if ($Probe) { $Quality = 'best' }
        else {
            Write-Host ''
            Write-Host '1. 最高画质（默认，不限制清晰度）'
            Write-Host '2. 1080P 及以下'
            Write-Host '3. 720P 及以下'
            Write-Host '4. 480P 及以下'
            $choice = Read-MengrenInput '请选择 1-4，直接回车选最高画质'
            $Quality = switch ($choice.Trim()) {
                '' { 'best' }; '1' { 'best' }; '2' { '1080' }; '3' { '720' }; '4' { '480' }
                default { throw '请选择 1、2、3 或 4。' }
            }
        }
    }
    $format = 'bv*+ba/b'
    if ($Quality -ne 'best') { $format = "bv*[height<=$Quality]+ba/b[height<=$Quality]" }
    $downloadArgs = @(
        '--ignore-config', '--no-plugin-dirs', '--no-playlist', '--encoding', 'utf-8',
        '--match-filter', '!is_live', '--format', $format,
        '--format-sort', 'res', '--ffmpeg-location', (Join-Path $toolRoot 'ffmpeg.exe'),
        '--js-runtimes', ('node:' + (Join-Path $toolRoot 'node.exe')),
        '--concurrent-fragments', '6', '--retries', '3', '--fragment-retries', '3',
        '--socket-timeout', '30', '--windows-filenames', '--trim-filenames', '160',
        '--merge-output-format', 'mp4/mkv'
    )
    if ($Probe) {
        $downloadArgs += @('--simulate','--print','%(id)s | %(title)s | %(resolution)s | %(format_id)s')
    } else {
        if (![IO.Path]::IsPathRooted($OutputDirectory)) { throw '保存文件夹必须填写完整路径。' }
        New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
        Write-Host "保存位置：$OutputDirectory"
        Write-Host '正在解析和下载，进度会显示在此窗口。按 Ctrl+C 可中止。'
        $downloadArgs += @('--paths',$OutputDirectory,'--output','%(title)s [%(id)s].%(ext)s','--newline')
    }
    $downloadArgs += @('--',$Url)
    & (Join-Path $toolRoot 'yt-dlp.exe') @downloadArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Host '未下载成功。请查看上方网站提示；若无匹配画质，可改选最高画质。' -ForegroundColor Yellow
        Write-Host '此工具不自动读取浏览器登录信息。' -ForegroundColor Yellow
        if ($siteHost -in @('bilibili.com','www.bilibili.com','m.bilibili.com','b23.tv')) {
            Write-Host '正在改用 B 站原网页读取当前可播放的音画；如需登录，请在专用 Edge 完成。'
            $biliArgs = @((Join-Path $toolRoot 'source\site-download.mjs'),'--url',$Url,'--output',$OutputDirectory,'--quality',$Quality)
            if ($Probe) { $biliArgs += '--probe' }
            & (Join-Path $toolRoot 'node.exe') @biliArgs
            exit $LASTEXITCODE
        }
        exit 1
    }
    if (!$Probe) { Write-Host "下载完成，请到 $OutputDirectory 查看视频。" -ForegroundColor Green }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
