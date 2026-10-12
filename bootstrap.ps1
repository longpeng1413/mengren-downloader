function Test-ComponentHash([string]$Path, [string]$Expected) {
    if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        $actual = [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
        return ($actual -eq $Expected)
    } finally { $stream.Dispose(); $algorithm.Dispose() }
}
function Receive-OfficialComponent([string]$Url, [string]$Path, [long]$Size, [string]$Name) {
    $request = [Net.HttpWebRequest]::Create($Url)
    $request.Timeout = 30000
    $request.ReadWriteTimeout = 30000
    $request.UserAgent = 'MengrenDownloader/0.4.1'
    $response = $null; $inputStream = $null; $outputStream = $null
    try {
        $response = $request.GetResponse()
        if ($response.ContentLength -gt $Size) { throw '服务器返回的文件大小不符合组件清单。' }
        $inputStream = $response.GetResponseStream()
        $outputStream = [IO.File]::Open($Path, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $buffer = New-Object byte[] (262144)
        [long]$received = 0
        $nextProgress = [DateTime]::UtcNow
        while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $received += $count
            if ($received -gt $Size) { throw '组件下载超出预期大小，已停止。' }
            $outputStream.Write($buffer, 0, $count)
            if ([DateTime]::UtcNow -ge $nextProgress) {
                Write-Progress -Activity "首次准备组件：$Name" -Status ("{0:N1} / {1:N1} MiB" -f ($received / 1MB), ($Size / 1MB)) -PercentComplete ([Math]::Min(100, [int](100 * $received / $Size)))
                $nextProgress = [DateTime]::UtcNow.AddMilliseconds(500)
            }
        }
        if ($received -ne $Size) { throw '组件文件不完整，请重新打开软件重试。' }
    } finally {
        if ($outputStream) { $outputStream.Dispose() }
        if ($inputStream) { $inputStream.Dispose() }
        if ($response) { $response.Dispose() }
        Write-Progress -Activity "首次准备组件：$Name" -Completed
    }
}
function Initialize-MengrenComponents([string]$Root) {
    $manifest = Get-Content -LiteralPath (Join-Path $Root 'dependencies.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.schema -ne 1 -or $manifest.components.Count -ne 3) { throw '组件清单无效，请重新解压软件包。' }
    $missing = @($manifest.components | Where-Object { !(Test-ComponentHash (Join-Path $Root $_.name) $_.sha256) })
    if (!$missing.Count) { return }
    Write-Host '首次运行正在准备下载组件，约 194 MiB；完成后不会重复下载。'
    Write-Host '组件直接从官方来源获取并校验 SHA-256。请保持网络连接。'
    $lock = $null
    try {
        try { $lock = [IO.File]::Open((Join-Path $Root '.components.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
        catch { throw '其他窗口正在准备组件，或当前文件夹不可写。请稍后重试，或解压到自己的普通文件夹。' }
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        foreach ($component in $missing) {
            if ($component.name -notin @('yt-dlp.exe','ffmpeg.exe','node.exe') -or $component.sha256 -notmatch '^[0-9a-f]{64}$') { throw '组件清单无效。' }
            $url = [Uri]$component.url
            if ($url.Scheme -ne 'https' -or $url.Host -notin @('github.com','nodejs.org')) { throw '组件来源不符合官方域名清单。' }
            $target = Join-Path $Root $component.name
            if (Test-ComponentHash $target $component.sha256) { continue }
            $temporary = Join-Path $Root ($component.name + '.download')
            $unpacked = Join-Path $Root ($component.name + '.verified')
            Write-Host ("正在准备 {0}（{1}）" -f $component.name, $component.version)
            try {
                $completed = $false
                for ($attempt = 1; $attempt -le 3; $attempt++) {
                    try { Receive-OfficialComponent $component.url $temporary $component.size $component.name; $completed = $true; break }
                    catch { if ($attempt -eq 3) { throw }; Write-Host "连接中断，重试 $attempt/3" }
                }
                if (!$completed) { throw '组件下载失败。' }
                if ($component.archiveSha256) {
                    if (!(Test-ComponentHash $temporary $component.archiveSha256)) { throw '官方压缩包校验失败，请稍后重试。' }
                    Add-Type -AssemblyName System.IO.Compression
                    Add-Type -AssemblyName System.IO.Compression.FileSystem
                    $archive = [IO.Compression.ZipFile]::OpenRead($temporary)
                    try {
                        $entry = $archive.GetEntry($component.entry)
                        if (!$entry) { throw '官方组件压缩包缺少目标文件。' }
                        $entryStream = $entry.Open()
                        $fileStream = [IO.File]::Create($unpacked)
                        try { $entryStream.CopyTo($fileStream) }
                        finally { $fileStream.Dispose(); $entryStream.Dispose() }
                    } finally { $archive.Dispose() }
                } else { Move-Item -LiteralPath $temporary -Destination $unpacked -Force }
                if (!(Test-ComponentHash $unpacked $component.sha256)) { throw '下载组件校验失败，文件不会运行。' }
                Move-Item -LiteralPath $unpacked -Destination $target -Force
                Write-Host "$($component.name) 校验通过。" -ForegroundColor Green
            } finally {
                foreach ($path in @($temporary,$unpacked)) {
                    if (Test-Path -LiteralPath $path -PathType Leaf) { Remove-Item -LiteralPath $path -Force }
                }
            }
        }
    } finally { if ($lock) { $lock.Dispose() } }
}
