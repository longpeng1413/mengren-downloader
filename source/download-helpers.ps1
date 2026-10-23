# 猛人下载器：download.ps1 与测试共用的小功能。本文件只定义函数，不执行任何下载。

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

# A post can carry several videos (X does this); yt-dlp then leaves one file per
# video. Publish all of them in name order and return the saved paths.
function Publish-MengrenDownloads([string]$Job, [string]$Folder) {
    $results = @(Get-ChildItem -LiteralPath $Job -File -Force | Where-Object { $_.Extension -match '^\.(mp4|mkv|webm|mov|m4v|flv)$' } | Sort-Object Name)
    if ($results.Count -lt 1) { throw '下载结果不完整，没有保存。请重试。' }
    return @(foreach ($item in $results) { Save-MengrenUnique $item.FullName $Folder })
}

function Test-MengrenXHost([string]$SiteHost) {
    return $SiteHost -match '(^|\.)(x\.com|twitter\.com)$'
}

# Turns known English site errors into plain Chinese advice; $null when unknown.
function Get-MengrenFailureHint([string]$SiteHost, [string]$Text) {
    if ($SiteHost -match '(^|\.)(youtube\.com|youtu\.be)$' -and $Text -match 'confirm you.{1,3}re not a bot') {
        return @(
            'YouTube 把当前网络出口当成了“机器人”，暂时拒绝下载。这不是软件坏了，换画质或重试都没用。',
            '1. 在代理软件（如 Clash）里换一个节点，最好换不同地区或线路，然后重新粘贴链接。',
            '2. 换节点仍不行，就过几个小时再试；这类限制通常会自动解除，期间不要反复重试。',
            '本软件不读取浏览器登录信息，不会用你的 YouTube 账号绕过这个检查。'
        )
    }
    if (Test-MengrenXHost $SiteHost) {
        if ($Text -match 'NSFW|protected tweet|[Rr]equires authentication|not authorized|log ?in|logged') {
            return @(
                '这条 X 帖子需要登录才能看（敏感内容、年龄限制或私密账号）。',
                '本软件不读取你的 X 登录信息，所以这类帖子暂不支持下载。'
            )
        }
        if ($Text -match '[Nn]o video could be found|[Nn]o video formats') {
            return @('这条 X 帖子里没有视频（可能只有图片或文字）。')
        }
        if ($Text -match '429|[Rr]ate.?limit|[Tt]oo [Mm]any [Rr]equests') {
            return @('X 暂时限制了访问次数。请过一会儿再试，或在代理软件里换一个节点。')
        }
        if ($Text -match 'does not exist|deleted|unavailable|[Ss]uspended|not found|404') {
            return @('这条 X 帖子已删除、账号被封禁，或者当前网络看不到它。请先在浏览器里确认还能打开。')
        }
    }
    return $null
}
