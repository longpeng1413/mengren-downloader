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
| Microsoft Edge（小鹅通/视频号需要） | 使用已安装的 Edge，无需扩展；软件只启动自己的配置目录，不重启日常浏览器 |
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
| node.exe | 24.19.0 | nodejs.org 官方 Windows x64，YouTube JS 解析、浏览器连接、站点下载 |

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
| `source/*.mjs` | 两个站点的地址校验、Edge 会话、原网站 API 读取和受限本机中继 |
| `tests/sites.test.mjs` | 链接格式、登录范围、媒体地址/清单重写回归 |
| `dependencies.json` | 官方下载组件锁定清单 |
| `scripts/setup-dev.ps1` | 新电脑开发环境检查、构建和组件准备 |
| `scripts/build.ps1` | 编译 C#，生成公开 ZIP 和 SHA256SUMS |
| `create-shortcut.ps1` | 当前电脑桌面入口，不需要固定用户名/路径 |
| `assets/`、`licenses/` | 用户提供的图标、第三方原始许可 |
| `.github/workflows/windows.yml` | Windows 云端环境检查、构建、组件验证、站点单测及产物上传 |

`.ps1` 必须 UTF-8 带 BOM，换行 CRLF；内联含中文的 Windows Actions 命令用 `pwsh`。`source/Launcher.cs` 保持 Framework 自带编译器可支持的语法。`.editorconfig` / `.gitattributes` 约定编码与换行；不要格式化上游 `licenses` 文本。没有 Python 项目、npm 项目或 `.csproj`；不要因此补出多余的环境。

## 6. 构建与验证

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build.ps1 -Package
if ($LASTEXITCODE -ne 0) { throw '构建失败' }
.\猛人下载器.exe --check
if ($LASTEXITCODE -ne 0) { throw '启动/组件校验失败' }
```

输出：根目录 `猛人下载器.exe`、`CaptureHelper.exe`。`-Package` 为开发用小包；`-Package -FullPackage` 为 `dist/mengren-downloader-0.4.0-alpha.3-windows-x64-full.zip` 和 `SHA256SUMS-full.txt`，包含代码、文档、锁定组件及许可。构建可能因时间戳而得到不同 ZIP 哈希，应校验本次实际产物，不声称二进制可重复构建。

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
.\ffmpeg.exe -v error -xerror -i '实际输出文件完整路径' -fps_mode passthrough -enc_time_base demux -f null -
```

依次检查每条命令退出码。`Probe` 只打印视频 ID、标题、分辨率和格式，不输出媒体签名；测试视频与临时文件不要提交。错误报告保留必要错误类型，不包含登录信息或带签名的媒体地址。

## 浏览器与站点接入（v0.3.0）

- `source/browser.mjs` 使用随包 Node 的原生 WebSocket 连接 Edge CDP。只用自己的 `%LOCALAPPDATA%\MengrenDownloader\BrowserProfile`，调试端口绑定 `127.0.0.1`、由浏览器动态分配，读取自己的 DevToolsActivePort。不会开放远端端口或复制日常 Edge 配置。
- Microsoft Edge 安装在标准路径（Program Files / Program Files (x86) / LOCALAPPDATA）；找不到时给出明确错误，不自动安装、不下载浏览器。
- 登录由用户在原网站手动完成。程序仅从精确同店铺/元宝原网站执行相关 API 请求，Cookie 由浏览器按原站规则发送；不通过 CDP Cookie/密码接口读取账户信息。
- 小鹅通从原分享短链得到同店铺回放地址，再在同店铺已登录页面读取 `get_lookback_list` / `base_info`。店铺返回未登录时打开它自己的登录页并自动等待。未授权、无回放或未结束直播不作为下载成功。
- 元宝原网站仅调用 `/api/weixin/get_parse_result` 解析所选视频号分享链接。临时播放凭证只用于 `channels.weixin.qq.com` 官方页，媒体签名只发往 `finder.video.qq.com`；不转交元宝/微信 Cookie，也不发送聊天消息。
- `source/relay.mjs` 限定站点域名/路径、公网 DNS 地址、HTTPS 和重定向次数。小鹅通的清单、子清单、音画片段及普通 AES-128 密钥统一重写为短期本机地址；不支持的媒体保护格式直接拒绝。视频号、抖音和 B 站文件采用流式读取，避免把完整视频缓存到内存。
- 子进程只看到本机中继地址，不看到上游媒体签名；内部 yt-dlp 使用空代理以避免系统代理接管回环连接。不会修改全局代理。
- 下载先进入目标目录下的自有临时目录，检查视频轨道及原有音频后封装 MP4（无声视频保留为无声，不伪造音轨），再保存最终文件；失败不发布成完整结果。重复下载使用新文件名，不覆盖已完成视频。
- 当前小鹅通/视频号下载网站提供的原始源，不承诺清晰度档位。主要目标是已结束直播回放与腾讯官方可解析分享链接，不涵盖所有课程类型或视频号。

```powershell
.\node.exe --test tests/sites.test.mjs tests/session.test.mjs tests/capture.test.mjs tests/capture-menu.test.mjs
# 只验证指定平台来源：仍会打开原网站并等待用户正常登录
powershell.exe -NoProfile -ExecutionPolicy Bypass -File download.ps1 -Probe -Url '用户选择的平台分享链接'
```

源文件均为标准 ES 模块，不需要 `npm install`。原生 WebSocket 使用随包 Node 24；别改为系统 Node 或新增隐含运行依赖。参考：[Node 原生 WebSocket](https://nodejs.org/docs/latest-v24.x/api/globals.html#class-websocket)、[Chromium 自定义配置目录调试说明](https://developer.chrome.com/blog/remote-debugging-port)。站点 API 行为可能变化，回归测试只检查边界与流程，真实登录/下载要在本机单独验证，不能把 CI 成功当作所有网站可用。

### 抖音、B 站与连续会话

- 抖音通过普通 Edge 原网页读取可见播放器的 currentSrc；遇到 MSE 播放器时仅接受所选视频匹配的资源，检查视频时长，分离音画时验证请求组与时长一致。支持短链跳转、完整链接和分享文案提取，不调用第三方解析服务或导出 Cookie。未能明确绑定到所选视频时等待或失败，不猜选其他视频。
- B 站优先使用原 yt-dlp 流程和画质上限；失败才读取专用 Edge 当前 BV/AV、选定分 P 的 INITIAL_STATE/playinfo 或同站官方 player/playurl。独立音轨在受限媒体中继中下载后合并。网页读取同样受用户正常账号权限限制；不会自动下载全集或破解 DRM。
- 正常入口是 C# 连续会话：子任务 `-Session` 的退出码 20 仅代表空输入退出；错误返回 1 后继续，取消返回 130 结束。每个子任务独立读取画质，避免上个任务的选择泄漏到下个任务。`download.ps1 -Url` 保持一次性调用，`--check` 不等待输入。
- 输入使用 Console.ReadLine 与显式提示刷新，避免 Read-Host 在重定向输入下隐藏提示或阻塞。会话测试包含正式入口空输入退出及模拟成功/失败重试；真实网站连续下载仍需本机验证。
- 公开回归样例：B 站 `BV1vL411G7N7`，抖音 `6961737553342991651`。来自上游 yt-dlp 官方测试样例，可能随时间失效；测试内容不提交、不随软件打包。

## 7. Git 同步与发布

新电脑应在同一个仓库中开发，不另建 Fork。开始前 `git status` / `git remote -v`；工作区干净且分支明确时可 `git pull --ff-only`。有未提交修改或分叉时先保留并解决，不强制覆盖。

默认忽略本机第三方 EXE、编译入口、dist、临时文件和下载视频。提交前运行 `git diff --check`、检查暂存差异及 `git status --short`；上游许可的原始空白按原样保留，不为通过格式检查改写许可证。

发布新版本前：

1. 核实授权范围，完成构建和验证；维护 `docs/PROJECT_STATUS.md`。
2. 同步 `Launcher.cs` 的 AssemblyVersion/FileVersion/标题，`download.ps1` 的显示版本，`bootstrap.ps1` 的 UserAgent，`scripts/build.ps1` 的产物名、README/使用说明版本。依赖版本只在确需升级时调整。
3. 提交源码，推送已授权的分支，等待 Windows Actions 成功；若需 PR，明确最终范围。
4. 以新 tag 发布新 Release；使用 notes 文件，上传公开 ZIP 和对应 SHA256SUMS。不覆盖旧 tag/文件；完整测试包可包含已校验的官方组件，不得上传本机私人配置/登录状态。
5. 核对 GitHub Release 是否公开、是否正确标为稳定/预发布、资产名/大小/摘要和源码提交关系。

用户已要求完整测试版作为下载入口，使用标准 FullPackage 构建，保留许可及官方来源。不要把个人目录直接压缩发布；本机私钥、浏览器配置和网络恢复记录必须排除。源码/文档的小改动可只同步仓库，无需重发已验证版本。

## 8. 常见问题

- `git`/`gh` 找不到：完成官方安装后重开终端，或使用实际 EXE 路径；不要复制旧机的认证缓存。
- 下载慢或超时：分别检查组件站点、视频站点和代理可达性，查看真实错误；不要先关闭安全设置。
- 哈希不符：不运行该文件；确认官方发布物是否改变，按依赖升级流程核对。不要删除校验逻辑。
- 文件不可写：核实目标权限、占用、Windows 错误码及空闲空间，不把所有失败都叫“空间不足”。
- 中文入口在 CI 找不到：确认内联脚本的 shell 为 `pwsh`，本地 `.ps1` 有 UTF-8 BOM。
- 缺少组件/仅有源码：运行开发准备入口；仅双击源码 ZIP 或复制一个 EXE 都不足以运行。

## 播放抓取模块（0.4.0-alpha.1）

运行/构建需要 .NET Framework 4.8（Release >=528040）；新版 setup-dev 检查条件。构建第二个自有 CaptureHelper.exe，公开 ZIP 包含它，无新增第三方运行组件。
source/capture.mjs 是交互入口；capture-proxy.mjs 使用 Node 内置 HTTP/TLS，CaptureHelper.cs 用系统 Framework 生成本机独立 2048 位 RSA CA/7 天叶证书、维护 CurrentUser Root 信任、代理恢复日志及异常退出守护。私钥只在当前用户私有 ACL 的 LOCALAPPDATA 下，不读取浏览器 Cookie 存储。证书有一年期限；过期需在恢复网络后重新准备，不能忽略服务器证书错误。
所有证书和恢复数据都在 LOCALAPPDATA/MengrenDownloader/Capture，不得提交/打包。启动默认关闭；用户在软件输入“开启”才安装信任和切换系统代理。原手动 HTTP 代理可作为上游；PAC 暂时移除并备份，复杂/认证/SOCKS 代理不保证。不开启时不修改网络设置。仅媒体域名范围做 TLS 解读，其他域名原样 CONNECT 隧道。生产拒绝私有/回环上游，测试才显式允许本地 fixture。
代理只转发原请求，不记录正文、Cookie、Authorization；候选只保留本次内存的 URL、类型、大小、来源 origin。完整下载只重用媒体 URL 和 origin，不复制登录头。m3u8 使用既有受限中继重写片段/密钥，受保护格式拒绝；捕获结果要求视频+音轨，不把独立片段发布成完整视频。
Windows代理变更先保存日志，退出时只在设置仍属于本软件时恢复；其他应用改过代理时拒绝覆盖并保留备份。正常退出及后台守护都会尝试移除本程序证书信任。恢复网络.cmd 仅恢复本程序记录，不删除其他软件证书或改第三方配置。
CI 测试使用临时独立证书、进程内部指定 CA、隔离注册表测试路径；不安装 CurrentUser Root 证书，不修改真实系统代理。测试涵盖 HTTP/HTTPS 抓取、其他域名隧道、Cookie 不复制、完整 MP4/HLS 下载解码、无效上游 CA 拒绝、恢复及外部改动冲突。实际微信/Cami权限、某些程序的证书固定/QUIC代理行为、强制关闭窗口守护必须在有权限的用户环境另测，不用本地 fixture 代替。

## 完整测试包（0.4.0-alpha.3）

用户明确要求下载解压即可测试，不再让用户首次另下下载组件。准备环境后运行 scripts/build.ps1 -Package -FullPackage，构建前校验三个现有 EXE 的锁定哈希；缺失或错误时拒绝打包。完整包名 mengren-downloader-0.4.0-alpha.3-windows-x64-full.zip，摘要 SHA256SUMS-full.txt，原始许可/官方来源说明随包提供。
开发用 -Package 小包继续保留，便于初次源码环境准备；正式测试 Release 优先上传 full 包并在 README 给出准确文件名。不得上传个人浏览器会话、CA/私钥或网络恢复备份。跨电脑解压启动检查必须验证不触发组件下载；不把“组件齐全”当作真实咖米课程已验证。

## 课程命名与抓取批量队列（0.4.0-alpha.3）

source/capture-course.mjs 只从限定课程域名和课程路径的 JSON 响应提取与媒体 URL 明确关联的标题；不按时间/响应顺序猜测名称，不解析登录/账户接口。最多缓存 512 KiB 压缩响应，解压上限 1 MiB；客户端继续收到未修改的原响应。只保留媒体关联和标题，不保留完整 JSON、个人字段或登录头。Content-Disposition 原文件名也可提供标题。课程名未知时必须由用户填写；“命名 编号 名称”覆盖自动名。
source/capture-menu.mjs 实现数字、范围、多编号和“全部”顺序队列。输入时固定课程集合，允许同一媒体更新的签名用于后续下载；新候选不会悄悄加入活动队列。某项失败继续下一项，已成功项不会再被“全部”选择。课程 JSON 同时提供名称和明确的 MP4/HLS 地址时可生成待验证候选；下载后才算成功。没有盲目目录爬取，不得宣称所有专栏只打开首页即能下载全集。
抓取文件使用课程标题，不加地址哈希；小鹅通也使用课程标题（保留其中原有日期）；其他平台原命名保持。相同目录的临时 MP4 验证后以排他硬链接发布，不重复复制大视频；不支持硬链接的文件系统采用排他复制。已有同名文件使用 (2)、(3)，不得覆盖用户文件。回归包含并发保存冲突、压缩课程 JSON 原样转发、标题绑定、手动名优先、未知名取消、范围验证和批量失败继续。
用户已报告笔记本小程序抓取单视频成功；新标题字段兼容和 8 节真实队列仍待用户验证，不能用 fixture 代替。
