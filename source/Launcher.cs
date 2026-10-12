using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
[assembly: AssemblyTitle("猛人下载器")]
[assembly: AssemblyDescription("粘贴链接，选择画质，下载到系统下载文件夹")]
[assembly: AssemblyProduct("猛人下载器")]
[assembly: AssemblyVersion("0.4.0.0")]
[assembly: AssemblyFileVersion("0.4.0.0")]
internal static class Launcher {
    private static int Main(string[] args) {
        bool check = args.Length == 1 && args[0] == "--check";
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.InputEncoding = new UTF8Encoding(false);
        Console.Title = "猛人下载器 v0.4.0";
        int code = 1;
        try {
            if (args.Length != 0 && !check) throw new ArgumentException("支持的参数：--check；正常下载请直接双击打开。");
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string script = Path.Combine(root, "download.ps1");
            if (!File.Exists(script)) throw new FileNotFoundException("请先完整解压软件包，不要只复制 EXE。", script);
            string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
            if (!File.Exists(powershell)) throw new FileNotFoundException("未找到 Windows 自带的 PowerShell。", powershell);
            while (true) {
                ProcessStartInfo start = new ProcessStartInfo();
                start.FileName = powershell;
                start.Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"" + (check ? " -Check" : " -Session");
                start.WorkingDirectory = root;
                start.UseShellExecute = false;
                start.CreateNoWindow = false;
                using (Process process = Process.Start(start)) {
                    if (process == null) throw new InvalidOperationException("无法启动下载入口。");
                    process.WaitForExit();
                    code = process.ExitCode;
                }
                if (check || code == 130) break;
                if (code == 20) { code = 0; break; }
                Console.WriteLine();
                Console.WriteLine(code == 0 ? "本次任务已完成，可继续粘贴下一条链接。" : "本次任务未完成，可以重试或换一条链接。");
            }
        } catch (Exception error) {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine(error.Message);
            Console.ResetColor();
            if (!check) {
                Console.WriteLine("按回车关闭窗口。");
                Console.ReadLine();
            }
        }
        return code;
    }
}
