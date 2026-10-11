# 开发环境与跨电脑接手

本文件供人和 AI 使用。只凭本仓库就能准备开发环境，无需原电脑、原聊天或剪藏项目。AI 应先读根目录 `AGENTS.md`。

## 1. 必需条件

| 条件 | 用途与准备方式 |
| --- | --- |
| Windows 10/11，Intel/AMD x64 | 当前程序及三个下载组件的目标平台；macOS、Linux、ARM64 未支持 |
| 可写的项目文件夹 | 例如 `D:\猛人下载器`；路径可包含中文和空格，不要求 D 盘存在 |
| Windows PowerShell 5.1 | Windows 自带；运行基线。PowerShell 7 可辅助编辑，但不能替代 5.1 验证 |
| Windows .NET Framework 4.x 编译器 | 必须存在 `%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`；现代 .NET SDK 不替代此文件 |
| Git for Windows | 获取源码、版本控制和远端同步。建议使用官方受维护版本 |
| 网络 | 能访问 GitHub、Node.js 官方分发站点，以及实际测试的视频网站/媒体域名 |
| 存储 | 官方组件初始化下载约 194 MiB；建议项目盘预留至少 1 GiB，视频下载盘另外预留视频和临时音画文件空间 |
| GitHub CLI（可选） | 仅发布 Release、查看云端检查、创建 PR 时需要；本地构建不需要登录 GitHub |
| AI 工具/编辑器（任选） | 能读取整个仓库并执行 PowerShell；不绑定 Codex 或 Claude，不要求特定模型或插件 |

无需安装 Python、系统 Node.js、Visual Studio、NuGet、npm 包、剪藏插件或剪藏助手。常规构建/下载不需管理员权限；安装 Git/GitHub CLI 或修复 Windows 自带组件可能出现系统授权提示。

若 `csc.exe` 或 PowerShell 5.1 不存在，停止构建并按 [微软 .NET Framework 安装说明](https://learn.microsoft.com/en-us/dotnet/framework/install/guide-for-developers) / Windows 系统维护方式修复。不要把第三方同名 EXE 复制到系统目录。

## 2. 新电脑获取源码

先安装 Git（[Git 官方 Windows 安装页](https://git-scm.com/install/windows)）：

```powershell
winget install --id Git.Git -e --source winget
```

没有 WinGet 时从官方页选择 x64 安装版或便携版；便携版也可以通过其完整路径运行。安装后重新打开终端/AI 会话，使 PATH 生效。

推荐使用 Git 克隆，而非仅下载 GitHub 的源码 ZIP：源码 ZIP 没有 `.git`，不会自动成为同步目录。

```powershell
git clone https://github.com/longpeng1413/mengren-downloader.git 'D:\猛人下载器'
Set-Location -LiteralPath 'D:\猛人下载器'
git status --short
git remote -v
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/setup-dev.ps1
```

若电脑没有 D 盘，换成自己的可写路径。若目录已存在，不重复克隆覆盖；先检查内容、Git 状态和远端。公开仓库的克隆无需登录。AI 也可以先读取 GitHub 上的 `AGENTS.md`，按这里的流程安装 Git，再克隆。

双击 **准备开发环境.cmd** 是同一准备流程。准备脚本默认：检查系统/Git/编译器 → 编译入口并生成公开 ZIP → 根据清单下载缺失组件并验证哈希 → 检查程序启动和系统下载目录。不会安装 Git/CLI、登录账号、下载测试视频或推送代码。

```powershell
# 只检查本机基础条件，不下载组件，不构建，不改变 Git 配置
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/setup-dev.ps1 -CheckOnly
```

## 3. 版本固定与组件初始化

| 组件 | 锁定版本 | 来源 / 用途 |
| --- | --- | --- |
| yt-dlp.exe | 2026.08.19 | yt-dlp 官方 GitHub Release，视频解析下载 |
| ffmpeg.exe | 7.1 essentials | GyanD/codexffmpeg 官方构建 Release，音画合并 |
| node.exe | 24.19.0 | nodejs.org 官方 Windows x64，YouTube JS 解析 |

实际版本、下载 URL、字节数、EXE SHA-256、FFmpeg ZIP SHA-256 和目标成员名以根目录 `dependencies.json` 为唯一依据。现有文件哈希匹配即复用；缺少或哈希不同才重新从官方下载。FFmpeg ZIP 只提取指定成员，校验后才使用。

版本已固定，Git/CLI 不要求固定到某个补丁版本。本机接手记录（2026-10-12）：Git `2.56.0.windows.2`、GitHub CLI `2.98.0`、编译器文件版本 `4.8.9232.0`；这些是验证记录，不是硬性版本限制。

升级依赖须同时更新清单、官方许可和版本说明；校验上游摘要或官方包来源，并重跑首次初始化与真实下载。不要用“下载最新”绕过哈希，也不要执行 `yt-dlp -U` 导致清单失配。当前下载脚本调用项目内 EXE，不依赖 PATH 中的同名程序。

## 4. 网络与登录配置

- 首次组件下载访问 `github.com`、GitHub 的 Release 分发/重定向域名和 `nodejs.org`。视频下载还需要访问 YouTube/媒体域名；网络失败不等于代码失败。
- `bootstrap.ps1` 使用 .NET 默认系统代理；Git 和 yt-dlp 的访问方式可能不同，应分别核对。项目不保存代理地址，不能把旧电脑的代理端口直接搬来。
- 若确认新电脑存在有效代理，可仅对本次 Git 命令使用 `git -c http.proxy=http://127.0.0.1:实际端口 ...`；不要在公共仓库硬编码端口，也不要擅自修改全局代理。
- 下载器目前不自动读取浏览器 Cookie、不支持通过聊天交接登录状态。公开可下载视频无需账号；登录受限视频仍属于未保证范围。

向 GitHub 上传才需要登录。[GitHub CLI 官方安装说明](https://github.com/cli/cli#installation)：

```powershell
winget install --id GitHub.cli -e --source winget
# 安装后重新打开终端
 gh auth login --hostname github.com --git-protocol https --web
 gh auth setup-git
 gh auth status
```

登录在浏览器中由用户完成，新的电脑需要自己的授权；不能从仓库继承密码、Token 或旧电脑的凭证。不要把验证码/令牌发给 AI。`gh auth setup-git` 用于这台电脑的 Git 身份验证，需要在已授权的账号配置范围内执行；与项目构建无关。公开仓库写权限不随源码传播。

提交前检查 `git config user.name` / `git config user.email`。缺少时使用本人信息或 GitHub 设置中实际显示的 noreply 邮箱，以 `git config --local ...` 配置当前仓库，不替用户猜邮箱或改全局身份。

## 5. 代码结构与编码

| 文件 | 职责 |
| --- | --- |
| `source/Launcher.cs` | 带图标的 C# 控制台入口，启动项目内下载脚本 |
| `download.ps1` | 链接输入、画质上限、系统下载目录、yt-dlp 参数与错误处理 |
| `bootstrap.ps1` | 固定依赖下载、哈希校验、组件准备锁 |
| `dependencies.json` | 官方下载组件锁定清单 |
| `scripts/setup-dev.ps1` | 新电脑开发环境检查、构建和组件准备 |
| `scripts/build.ps1` | 编译 C#，生成公开 ZIP 和 SHA256SUMS |
| `create-shortcut.ps1` | 当前电脑桌面入口，不需要固定用户名/路径 |
| `assets/`、`licenses/` | 用户提供的图标、第三方原始许可 |
| `.github/workflows/windows.yml` | Windows 云端环境检查、构建、组件验证及产物上传 |

`.ps1` 必须 UTF-8 带 BOM，换行 CRLF；内联含中文的 Windows Actions 命令用 `pwsh`。`source/Launcher.cs` 保持 Framework 自带编译器可支持的语法。`.editorconfig` / `.gitattributes` 约定编码与换行；不要格式化上游 `licenses` 文本。没有 Python 项目、npm 项目或 `.csproj`；不要因此补出多余的环境。

## 6. 构建与验证

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build.ps1 -Package
if ($LASTEXITCODE -ne 0) { throw '构建失败' }
.\猛人下载器.exe --check
if ($LASTEXITCODE -ne 0) { throw '启动/组件校验失败' }
```

输出：根目录 `猛人下载器.exe`；`dist/mengren-downloader-0.1.0-windows-x64.zip`；`dist/SHA256SUMS.txt`。ZIP 内包含项目代码和交接文档，公共包排除三个第三方 EXE。构建可能因时间戳而得到不同 ZIP 哈希，应校验本次实际产物，不声称二进制可重复构建。

按修改范围验证，避免反复下载大型视频：

- 环境/文档/构建修改：运行准备入口、构建、`--check`，检查 ZIP 内容/CRC、编码、Git 差异。
- 下载流程/组件修改：再做一次画质解析及公开短视频的真实下载/合并；网站随时变化，应记录实际结果。
- 路径/启动修改：在含中文和空格的新解压目录运行；只复制 EXE 不算完整迁移。
- 登录受限、长视频、其他网站和另一台实体电脑：未实际测试则写清楚，不能用 CI 成功代替。

可选测试样例（网络可用时；公开视频也可能未来失效）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File download.ps1 -Probe -Quality 720 -Url 'https://www.youtube.com/watch?v=azFsmVcFsSw'
# 下面会实际下载一个短视频；选择自己的可写临时目录
powershell.exe -NoProfile -ExecutionPolicy Bypass -File download.ps1 -Quality 480 -Url 'https://www.youtube.com/watch?v=jNQXAC9IVRw' -OutputDirectory "$env:TEMP\mengren-smoke"
# 对上一步输出的实际文件，使用完整路径检查整段音视频解码
.\ffmpeg.exe -v error -i '实际输出文件完整路径' -f null -
```

依次检查每条命令退出码。`Probe` 只打印视频 ID、标题、分辨率和格式，不输出媒体签名；测试视频与临时文件不要提交。错误报告保留必要错误类型，不包含登录信息或带签名的媒体地址。

## 7. Git 同步与发布

新电脑应在同一个仓库中开发，不另建 Fork。开始前 `git status` / `git remote -v`；工作区干净且分支明确时可 `git pull --ff-only`。有未提交修改或分叉时先保留并解决，不强制覆盖。

默认忽略本机第三方 EXE、编译入口、dist、临时文件和下载视频。提交前运行 `git diff --check`、检查暂存差异及 `git status --short`；上游许可的原始空白按原样保留，不为通过格式检查改写许可证。

发布新版本前：

1. 核实授权范围，完成构建和验证；维护 `docs/PROJECT_STATUS.md`。
2. 同步 `Launcher.cs` 的 AssemblyVersion/FileVersion/标题，`download.ps1` 的显示版本，`bootstrap.ps1` 的 UserAgent，`scripts/build.ps1` 的产物名、README/使用说明版本。依赖版本只在确需升级时调整。
3. 提交源码，推送已授权的分支，等待 Windows Actions 成功；若需 PR，明确最终范围。
4. 以新 tag 发布新 Release；使用 notes 文件，上传公开 ZIP 和对应 SHA256SUMS。不覆盖旧 tag/文件，不上传个人完整包。
5. 核对 GitHub Release 是否公开、是否正确标为稳定/预发布、资产名/大小/摘要和源码提交关系。

个人迁移完整包可包含项目内已有且通过哈希验证的三个 EXE；仍需保留相应许可。它不是目前默认公共发布物。源码/文档的小改动可只同步仓库，无需重发已验证的 v0.1.0。

## 8. 常见问题

- `git`/`gh` 找不到：完成官方安装后重开终端，或使用实际 EXE 路径；不要复制旧机的认证缓存。
- 下载慢或超时：分别检查组件站点、视频站点和代理可达性，查看真实错误；不要先关闭安全设置。
- 哈希不符：不运行该文件；确认官方发布物是否改变，按依赖升级流程核对。不要删除校验逻辑。
- 文件不可写：核实目标权限、占用、Windows 错误码及空闲空间，不把所有失败都叫“空间不足”。
- 中文入口在 CI 找不到：确认内联脚本的 shell 为 `pwsh`，本地 `.ps1` 有 UTF-8 BOM。
- 缺少组件/仅有源码：运行开发准备入口；仅双击源码 ZIP 或复制一个 EXE 都不足以运行。
