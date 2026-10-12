using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
[assembly: AssemblyTitle("猛人下载器")]
[assembly: AssemblyDescription("粘贴链接，选择画质，下载到系统下载文件夹")]
[assembly: AssemblyProduct("猛人下载器")]
[assembly: AssemblyVersion("0.2.0.0")]
[assembly: AssemblyFileVersion("0.2.0.0")]
internal static class Launcher {
    private static int Main(string[] args) {
        bool check = args.Length == 1 && args[0] == "--check";
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.InputEncoding = new UTF8Encoding(false);
        Console.Title = "猛人下载器 v0.2.0";
        int code = 1;
        try {
            if (args.Length != 0 && !check) throw new ArgumentException("支持的参数：--check；正常下载请直接双击打开。");
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string script = Path.Combine(root, "download.ps1");
            if (!File.Exists(script)) throw new FileNotFoundException("请先完整解压软件包，不要只复制 EXE。", script);
            string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
            if (!File.Exists(powershell)) throw new FileNotFoundException("未找到 Windows 自带的 PowerShell。", powershell);
            ProcessStartInfo start = new ProcessStartInfo();
            start.FileName = powershell;
            start.Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"" + (check ? " -Check" : "");
            start.WorkingDirectory = root;
            start.UseShellExecute = false;
            start.CreateNoWindow = false;
            using (Process process = Process.Start(start)) {
                if (process == null) throw new InvalidOperationException("无法启动下载入口。");
                process.WaitForExit();
                code = process.ExitCode;
            }
        } catch (Exception error) {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine(error.Message);
            Console.ResetColor();
        }
        if (!check) {
            Console.WriteLine();
            Console.WriteLine("按回车关闭窗口。");
            Console.ReadLine();
        }
        return code;
    }
}
