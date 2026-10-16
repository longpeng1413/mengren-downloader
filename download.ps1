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
# Same rules as removeAbandonedJobs in source/site-download.mjs: only our own
# .mengren-XXXXXX folders whose owner process has exited (or, without an owner
# record, a day old) and that contain only files.
function Remove-MengrenAbandonedJobs([string]$Folder) {
    $removed = 0
    foreach ($dir in @(Get-ChildItem -LiteralPath $Folder -Directory -Force -ErrorAction SilentlyContinue)) {
        if ($dir.Name -cnotmatch '^\.mengren-[A-Za-z0-9]{6}$') { continue }
        try {
            $owner = 0
            try { $owner = [int](Get-Content -LiteralPath (Join-Path $dir.FullName '.owner') -Raw | ConvertFrom-Json).pid } catch { }
            if ($owner -gt 0) { if (Get-Process -Id $owner -ErrorAction SilentlyContinue) { continue } }
            elseif (((Get-Date) - $dir.LastWriteTime).TotalHours -lt 24) { continue }
            if (@(Get-ChildItem -LiteralPath $dir.FullName -Directory -Force).Count) { continue }
            Remove-Item -LiteralPath $dir.FullName -Recurse -Force -ErrorAction Stop
            $removed++
        } catch { }
    }
    return $removed
}
# Publishes a finished file without replacing an existing one: name.mp4, name (2).mp4 ...
function Save-MengrenUnique([string]$Source, [string]$Folder) {
    $name = [IO.Path]::GetFileName($Source)
    $stem = [IO.Path]::GetFileNameWithoutExtension($name); $ext = [IO.Path]::GetExtension($name)
    for ($index = 1; $index -le 10000; $index++) {
        $target = Join-Path $Folder $(if ($index -eq 1) { $name } else { "$stem ($index)$ext" })
        if (Test-Path -LiteralPath $target) { continue }
        try { [IO.File]::Move($Source, $target); return $target }
        catch [IO.IOException] { if (!(Test-Path -LiteralPath $target)) { throw } }
    }
    throw '同名视频过多，请换一个保存文件夹。'
}
$toolRoot = $PSScriptRoot
try {
    if ($Session -and !$Check -and !$Probe) {
        Write-Host '猛人下载器：连续下载模式'
        $Url = Read-MengrenInput '请粘贴下一条视频或 QQ 音乐歌曲链接，或输入 抓取；直接回车退出'
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
        Write-Host '猛人下载器 v0.5.2（便携版）'
        Write-Host "默认保存位置：$OutputDirectory"
        $Url = Read-MengrenInput '请粘贴视频或 QQ 音乐歌曲链接'
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
            if ([Uri]::TryCreate($candidate,[UriKind]::Absolute,[ref]$candidateUri) -and $candidateUri.DnsSafeHost -match '(^|\.)(douyin\.com|iesdouyin\.com|bilibili\.com|b23\.tv|youtube\.com|youtu\.be|weixin\.qq\.com|y\.qq\.com|xet\.tech|xetslk\.com|xetlk\.com)$') {
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
    if ($siteHost -eq 'y.qq.com' -or $siteHost.EndsWith('.y.qq.com')) {
        $musicQuality = 'standard'
        if ($Quality) { if ($Quality -eq 'best') { $musicQuality = 'best' } }
        elseif (!$Probe) {
            Write-Host ''
            Write-Host '1. 用会员账号读取（默认）：打开下载专用 Edge，用登录的 QQ 音乐账号读取，可选音质最多'
            Write-Host '2. 不登录快速读取：不打开浏览器，免费歌曲最高 128k；读取不到时自动改用专用 Edge'
            Write-Host '读取后会列出这首歌所有可下载的音质和大小，由你选择。'
            $musicQuality = $null
            while (!$musicQuality) {
                $choice = Read-MengrenInput '请选择 1 或 2，直接回车选 1'
                if ($null -eq $choice) { throw '没有读取到音质选择。' }
                $musicQuality = switch ($choice.Trim()) { '' { 'best' }; '1' { 'best' }; '2' { 'standard' }; default { $null } }
                if (!$musicQuality) { Write-Host '请输入 1 或 2；直接回车选 1。' -ForegroundColor Yellow }
            }
        }
        Write-Host '只下载账号有权完整播放的歌曲；不下载试听片段，不处理加密文件。'
        $musicArgs = @((Join-Path $toolRoot 'source\qqmusic.mjs'),'--url',$Url,'--output',$OutputDirectory,'--quality',$musicQuality)
        if ($Probe) { $musicArgs += '--probe' }
        & (Join-Path $toolRoot 'node.exe') @musicArgs
        exit $LASTEXITCODE
    }
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
            # Ask again on a typo instead of failing the task and losing the pasted link.
            # $Quality carries ValidateSet, so collect the answer separately first.
            $picked = $null
            while (!$picked) {
                $choice = Read-MengrenInput '请选择 1-4，直接回车选最高画质'
                if ($null -eq $choice) { throw '没有读取到画质选择。' }
                $picked = switch ($choice.Trim()) {
                    '' { 'best' }; '1' { 'best' }; '2' { '1080' }; '3' { '720' }; '4' { '480' }
                    default { $null }
                }
                if (!$picked) { Write-Host '请输入 1、2、3 或 4；直接回车选最高画质。' -ForegroundColor Yellow }
            }
            $Quality = $picked
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
    $job = $null
    if ($Probe) {
        $downloadArgs += @('--simulate','--print','%(id)s | %(title)s | %(resolution)s | %(format_id)s')
    } else {
        if (![IO.Path]::IsPathRooted($OutputDirectory)) { throw '保存文件夹必须填写完整路径。' }
        New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
        if (Remove-MengrenAbandonedJobs $OutputDirectory) { Write-Host '已清理上次中断留下的临时文件。' }
        Write-Host "保存位置：$OutputDirectory"
        Write-Host '正在解析和下载，进度会显示在此窗口。按 Ctrl+C 可中止。'
        # Download into our own temporary folder first, then publish under the plain
        # title; an existing file of the same name gets (2) instead of being skipped.
        $letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
        $job = Join-Path $OutputDirectory ('.mengren-' + -join (1..6 | ForEach-Object { $letters[(Get-Random -Maximum $letters.Length)] }))
        New-Item -ItemType Directory -Path $job | Out-Null
        [IO.File]::WriteAllText((Join-Path $job '.owner'), ('{"pid":' + $PID + '}'))
        $downloadArgs += @('--paths',$job,'--output','%(title)s.%(ext)s','--newline')
    }
    $downloadArgs += @('--',$Url)
    try {
        & (Join-Path $toolRoot 'yt-dlp.exe') @downloadArgs
        $downloadCode = $LASTEXITCODE
        $saved = $null
        if ($downloadCode -eq 0 -and $job) {
            $results = @(Get-ChildItem -LiteralPath $job -File -Force | Where-Object { $_.Extension -match '^\.(mp4|mkv|webm|mov|m4v|flv)$' })
            if ($results.Count -ne 1) { throw '下载结果不完整，没有保存。请重试。' }
            $saved = Save-MengrenUnique $results[0].FullName $OutputDirectory
        }
    } finally {
        if ($job -and (Test-Path -LiteralPath $job)) { Remove-Item -LiteralPath $job -Recurse -Force -ErrorAction SilentlyContinue }
    }
    if ($downloadCode -ne 0) {
        # YouTube's "confirm you're not a bot" blocks the network exit address, not a
        # client or version; explain it in plain words instead of the English error.
        $botBlocked = $false
        if (!$Probe -and $siteHost -match '(^|\.)(youtube\.com|youtu\.be)$') {
            $previousPreference = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            try {
                $checkArgs = @('--ignore-config','--no-plugin-dirs','--no-playlist','--simulate','--no-warnings','--js-runtimes',('node:' + (Join-Path $toolRoot 'node.exe')),'--',$Url)
                $checkText = (& (Join-Path $toolRoot 'yt-dlp.exe') @checkArgs 2>&1 | ForEach-Object { "$_" }) -join "`n"
                $botBlocked = $checkText -match 'confirm you.{1,3}re not a bot'
            } catch { } finally { $ErrorActionPreference = $previousPreference }
        }
        if ($botBlocked) {
            Write-Host ''
            Write-Host 'YouTube 把当前网络出口当成了“机器人”，暂时拒绝下载。这不是软件坏了，换画质或重试都没用。' -ForegroundColor Yellow
            Write-Host '1. 在代理软件（如 Clash）里换一个节点，最好换不同地区或线路，然后重新粘贴链接。' -ForegroundColor Yellow
            Write-Host '2. 换节点仍不行，就过几个小时再试；这类限制通常会自动解除，期间不要反复重试。' -ForegroundColor Yellow
            Write-Host '本软件不读取浏览器登录信息，不会用你的 YouTube 账号绕过这个检查。' -ForegroundColor Yellow
            exit 1
        }
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
    if ($saved) { Write-Host "下载完成：$saved" -ForegroundColor Green }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
