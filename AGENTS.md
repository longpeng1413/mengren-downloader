# 猛人下载器：AI 开发入口

开始任何任务前，请依次阅读：本文件、`README.md`、`docs/DEVELOPMENT.md`、`docs/PROJECT_STATUS.md`，然后检查实际代码、Git 状态和远端。无需读取原聊天记录。

## 项目边界

- 这是独立的 Windows x64 项目，正式仓库为 https://github.com/longpeng1413/mengren-downloader ，默认分支 `main`。不要新建重复仓库或 Fork。
- 当前是 C# 控制台入口 + PowerShell 下载流程，已重点验证 YouTube。图形界面、更多网站、音频模式和下载队列仍为后续计划，不能写成已经实现。
- 项目必须能在任意可写目录运行；不要依赖剪藏插件、原助手目录、某台电脑的用户名、盘符、Python 安装、系统 Node.js 或旧聊天里的路径。
- 不移动或删除用户的其他软件、知识库、原视频；视频默认保存到当前用户系统“下载”目录。

## 新电脑接手顺序

1. 确认环境是 Windows 10/11 的 Intel/AMD x64；按开发文档准备 Git。发布才需要 GitHub CLI。系统缺少基础组件时按官方文档修复，不从不明网站下载工具。
2. 新目录优先 `git clone` 现有仓库。已有目录先检查 `git status --short`、`git remote -v` 和分支。保留未提交修改，不用 `reset --hard`、`clean -fd` 或强推解决问题。
3. 执行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/setup-dev.ps1`。脚本检查基础环境、编译并打包，然后自动准备缺少的官方组件、验证 SHA-256 和启动能力。
4. 按文档做与本次修改相关的验证，记录实际结果。环境准备成功不代表网站下载成功；未在另一台实体电脑验证就如实说明。
5. 继续用户指定的开发任务；报告修改、验证和限制。已有明确的提交/发布授权时可继续执行，否则先完成可审查的工作再取得发布授权。

## 修改和发布约定

- Windows PowerShell 5.1 是运行基线，`.ps1` 必须保存为 UTF-8 **带 BOM**。不能只在 PowerShell 7 中验证。Windows CI 内含中文的内联命令使用 `pwsh`，避免 PS 5.1 临时脚本的编码问题。
- 入口使用 Windows .NET Framework `csc.exe` 构建，保持当前编译器支持的 C# 语法；无需现代 .NET SDK、Visual Studio 或 NuGet。改工具链时同步更新文档和 CI。
- 依赖版本、官方 URL、大小和哈希以 `dependencies.json` 为准。不要执行 `yt-dlp -U` 或悄悄升级组件；升级时验证上游来源与哈希，更新第三方许可证并测试初始化、解析、下载和合并。
- 不自动读取浏览器 Cookie；不把 Cookie、登录凭证、API 密钥、带签名的媒体 URL 或下载视频写入源码、日志和提交。
- 公共 ZIP 不打包 `yt-dlp.exe`、`ffmpeg.exe`、`node.exe`；首次运行从官方获取。完整便携包目前只用于个人电脑迁移，不当作可公开发布的默认产物。
- 提交前检查 Git 差异与忽略规则；按开发文档构建、校验。发布新版本时同步所有版本字段，不覆盖旧 tag，也不自动更换已有 Release 文件。
- 网络配置随电脑变化，不继承旧机器代理端口。不要修改全局代理、全局 Git 配置、系统执行策略或安全设置。登录使用原网站/浏览器流程；不要要求用户在聊天中提供令牌或验证码。
- 更新功能后同步 `docs/PROJECT_STATUS.md`，写明完成项、待办和实际验证范围，不把暂时失败推断成某个根因。
