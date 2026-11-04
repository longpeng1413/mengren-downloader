using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
[assembly: AssemblyTitle("猛人下载器")]
[assembly: AssemblyDescription("粘贴链接，选择画质，下载到系统下载文件夹")]
[assembly: AssemblyProduct("猛人下载器")]
[assembly: AssemblyVersion("0.9.2.0")]
[assembly: AssemblyFileVersion("0.9.2.0")]
// Starts the window version: node.exe runs source\gui-server.mjs without a console and
// opens the Edge app window. This launcher only waits for "ready" or shows the error.
internal static class GuiLauncher {
    [STAThread]
    private static int Main() {
        try {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string server = Path.Combine(root, @"source\gui-server.mjs");
            string node = Path.Combine(root, "node.exe");
            if (!File.Exists(server)) throw new FileNotFoundException("请先完整解压软件包，不要只复制 EXE。");
            if (!File.Exists(node)) throw new FileNotFoundException("缺少 node.exe。请下载文件名带 full 的完整版软件包，或运行“准备开发环境.cmd”。");
            ProcessStartInfo start = new ProcessStartInfo();
            start.FileName = node;
            start.Arguments = "\"" + server + "\"";
            start.WorkingDirectory = root;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.RedirectStandardInput = true;
            start.RedirectStandardOutput = true;
            start.StandardOutputEncoding = new UTF8Encoding(false);
            using (Process process = Process.Start(start)) {
                if (process == null) throw new InvalidOperationException("无法启动界面。");
                process.StandardInput.Close();
                Task<string> first = process.StandardOutput.ReadLineAsync();
                if (!first.Wait(45000)) throw new TimeoutException("界面启动超时。请稍后再试，或打开“猛人下载器-命令行版.exe”。");
                string line = first.Result ?? "";
                if (line.StartsWith("ready")) return 0;
                if (line.StartsWith("error ")) throw new InvalidOperationException(line.Substring(6));
                throw new InvalidOperationException("界面没有启动成功。可以先用“猛人下载器-命令行版.exe”下载。");
            }
        } catch (Exception error) {
            MessageBox.Show(error.Message, "猛人下载器", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return 1;
        }
    }
}
