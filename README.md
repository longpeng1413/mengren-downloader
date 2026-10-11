# 猛人下载器

<p align="center"><img src="assets/app.png" width="160" alt="猛人下载器图标"></p>

一个可以解压使用的 Windows 视频下载小工具。粘贴链接，选择画质，下载到系统“下载”文件夹。

当前版本 **v0.1.0** 使用命令行窗口交互，重点验证 YouTube；未来计划逐步加入常用网站和图形界面。

## 下载和使用

到 [Releases](https://github.com/longpeng1413/mengren-downloader/releases/latest) 下载 `mengren-downloader-0.1.0-windows-x64.zip`。

1. **完整解压**到普通文件夹，不要在压缩包内直接打开。
2. 双击 **猛人下载器.exe**。首次运行会自动从官方准备并校验下载组件，约 194 MiB，只需一次。
3. 粘贴 YouTube 视频链接，选择最高画质、1080P、720P 或 480P。
4. 等待视频、音频下载及合并，完成后到当前电脑的系统 **下载** 文件夹查看。

选择的清晰度是上限：例如视频只有 720P，选 1080P 也会下载最佳的 720P。直接回车默认最高画质；竖屏上限按高度计算。

双击 **创建桌面快捷方式.cmd** 可创建带“猛”字图标的桌面入口。请保留整个软件文件夹，移动后需要重新创建快捷方式。

## 运行要求与范围

- Windows 10 / 11，64 位 Intel 或 AMD 电脑。
- 无需安装 Python、Node.js、剪藏插件或剪藏助手，也无需管理员权限。
- 网络需要能访问 YouTube 和首次准备组件的官方站点。代理设置不会跨电脑复制。
- 默认使用系统下载目录，视频和音频自动合并，通常为 MP4，部分格式为 MKV。
- 不自动读取浏览器 Cookie。部分需要登录、受地区限制或 DRM 保护的视频可能无法下载。
- 不声称所有网站均已支持；其他网站按实际验证逐项增加。

已在 Windows 上验证启动、官方组件初始化、画质解析、换目录运行，以及公开短视频整段下载、音画合并和解码；尚未在用户另一台电脑上验证，也未验证 macOS、Linux、ARM64。

## 在另一台电脑继续开发

AI 先读取根目录 [AGENTS.md](AGENTS.md)，再按 [开发环境与跨电脑接手](docs/DEVELOPMENT.md) 准备 Git、克隆源码并运行开发入口。完整说明包含必需/可选工具、依赖锁定、网络/登录配置、代码结构、构建验证和 GitHub 发布流程；[项目状态](docs/PROJECT_STATUS.md)记录已完成能力与待办。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/setup-dev.ps1
```

也可双击 **准备开发环境.cmd**。入口检查基础条件、构建程序与 ZIP，自动下载缺少的官方视频组件并验证。源码仓库不保存登录凭证；新电脑向 GitHub 推送时需在浏览器正常授权。

## 源码与构建

源码入口在 `source/Launcher.cs`，下载流程在 `download.ps1`，组件初始化在 `bootstrap.ps1`。版本和 SHA-256 固定在 `dependencies.json`。

Windows 自带 .NET Framework 编译器即可构建：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build.ps1 -Package
```

生成的便携 ZIP 位于 `dist`。构建不需要预先安装下载组件；公开 ZIP 只包含本项目入口、源码、图标和说明。用户初次运行时直接从上游获取组件并检查 SHA-256。

```powershell
.\猛人下载器.exe --check
```

这会准备缺少的组件、检查它们能否启动，并显示系统下载位置。

## 组件和许可

本项目的入口、脚本和图标采用 [MIT License](LICENSE)。[组件说明](组件说明.txt)列出了第三方项目及其许可证；第三方程序不受本项目 MIT 许可覆盖。

- [yt-dlp](https://github.com/yt-dlp/yt-dlp)：视频解析和下载。
- [FFmpeg / Gyan Builds](https://www.gyan.dev/ffmpeg/builds/)：音视频合并。
- [Node.js](https://nodejs.org/)：YouTube JavaScript 解析运行组件。

公开发布包不包含这些第三方程序，首次运行直接从官方来源获取未修改的程序，许可证文本附在 `licenses`。

## 后续计划

- 根据常用网站逐项增加并验证兼容性。
- 图形界面、可视化下载进度、保存位置选择和队列。
- 清晰度列表与音频单独下载。

反馈请提交 [Issue](https://github.com/longpeng1413/mengren-downloader/issues)，附上网站类型和错误信息，避免上传 Cookie 或含临时播放凭证的完整地址。
