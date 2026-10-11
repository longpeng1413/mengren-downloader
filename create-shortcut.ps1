$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    $launcher = Join-Path $PSScriptRoot '猛人下载器.exe'
    if (!(Test-Path -LiteralPath $launcher -PathType Leaf)) { throw '请先完整解压软件包。' }
    $desktop = [Environment]::GetFolderPath('Desktop')
    $link = Join-Path $desktop '猛人下载器.lnk'
    $shell = New-Object -ComObject WScript.Shell
    if (Test-Path -LiteralPath $link) {
        $existing = $shell.CreateShortcut($link)
        if ($existing.TargetPath -ne $launcher) { throw '桌面已有指向其他目录的“猛人下载器”，请先确认是否需要删除旧快捷方式。' }
    }
    $shortcut = $shell.CreateShortcut($link)
    $shortcut.TargetPath = $launcher
    $shortcut.WorkingDirectory = $PSScriptRoot
    $shortcut.Description = '猛人下载器：粘贴链接、选择画质、下载到系统下载文件夹'
    $shortcut.IconLocation = $launcher + ',0'
    $shortcut.WindowStyle = 1
    $shortcut.Save()
    Write-Host "已创建：$link" -ForegroundColor Green
    Write-Host '请保留软件文件夹；移动它之后需重新创建快捷方式。'
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
