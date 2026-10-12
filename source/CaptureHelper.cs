using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Threading;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using Microsoft.Win32;
using System.Runtime.InteropServices;
class CaptureHelper {
    [DllImport("wininet.dll", SetLastError=true)] static extern bool InternetSetOption(IntPtr h,int option,IntPtr buffer,int length);
    static string Dir;
    static bool Testing;
    static string SettingsPath=@"Software\Microsoft\Windows\CurrentVersion\Internet Settings";
    static JavaScriptSerializer Json = new JavaScriptSerializer();
    static string FilePath(string name) { return Path.Combine(Dir,name); }
    static void Save(string name,object value) { string temporary=FilePath(name+".new");File.WriteAllText(temporary,Json.Serialize(value),new UTF8Encoding(false));if(File.Exists(FilePath(name)))File.Replace(temporary,FilePath(name),null);else File.Move(temporary,FilePath(name)); }
    static Dictionary<string,object> Load(string name) { return Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(FilePath(name))); }
    static X509Certificate2 Root() { return new X509Certificate2(FilePath("root.pfx"),"",X509KeyStorageFlags.Exportable|X509KeyStorageFlags.EphemeralKeySet); }
    static void ProtectDirectory() {
        Directory.CreateDirectory(Dir);
        var acl=new DirectorySecurity(); acl.SetAccessRuleProtection(true,false);
        var me=WindowsIdentity.GetCurrent().User;
        acl.SetOwner(me);
        acl.AddAccessRule(new FileSystemAccessRule(me,FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
        acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid,null),FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
        new DirectoryInfo(Dir).SetAccessControl(acl);
    }
    static void Init() {
        ProtectDirectory();
        if(File.Exists(FilePath("root.pfx"))) { using(var r=Root()) { if(r.NotAfter<DateTime.Now.AddDays(2))throw new Exception("Capture certificate expired. Remove it only after restoring the proxy."); } return; }
        using(var rsa=new RSACryptoServiceProvider(2048)) {
            rsa.PersistKeyInCsp=false;
            var request=new CertificateRequest("CN=Mengren Local Capture "+Guid.NewGuid().ToString("N").Substring(0,8),rsa,HashAlgorithmName.SHA256,RSASignaturePadding.Pkcs1);
            request.CertificateExtensions.Add(new X509BasicConstraintsExtension(true,false,0,true));
            request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign|X509KeyUsageFlags.CrlSign,true));
            request.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(request.PublicKey,false));
            using(var cert=request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-5),DateTimeOffset.UtcNow.AddYears(1))) {
                File.WriteAllBytes(FilePath("root.pfx"),cert.Export(X509ContentType.Pfx,""));
                File.WriteAllBytes(FilePath("root.cer"),cert.Export(X509ContentType.Cert));
            }
        }
    }
    static void Leaf(string host) {
        if(!System.Text.RegularExpressions.Regex.IsMatch(host,@"^[a-zA-Z0-9.-]{1,253}$"))throw new Exception("Invalid certificate hostname");
        string path=FilePath("leaf-"+host+".pfx");
        if(File.Exists(path)) { using(var old=new X509Certificate2(path,"")){if(old.NotAfter>DateTime.Now.AddHours(2)){Console.WriteLine(path);return;}} }
        using(var issuer=Root())using(var rsa=new RSACryptoServiceProvider(2048)) {
            rsa.PersistKeyInCsp=false;
            var request=new CertificateRequest("CN="+host,rsa,HashAlgorithmName.SHA256,RSASignaturePadding.Pkcs1);
            request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false,false,0,true));
            request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature|X509KeyUsageFlags.KeyEncipherment,true));
            var usages=new OidCollection();usages.Add(new Oid("1.3.6.1.5.5.7.3.1"));request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(usages,false));
            var san=new SubjectAlternativeNameBuilder();san.AddDnsName(host);request.CertificateExtensions.Add(san.Build());
            byte[] serial=new byte[16];using(var rng=RandomNumberGenerator.Create()){rng.GetBytes(serial);}serial[0]&=127;
            using(var publicCert=request.Create(issuer,DateTimeOffset.UtcNow.AddMinutes(-5),DateTimeOffset.UtcNow.AddDays(7),serial))
            using(var cert=publicCert.CopyWithPrivateKey(rsa))File.WriteAllBytes(path,cert.Export(X509ContentType.Pfx,""));
        }
        Console.WriteLine(path);
    }
    static void Trust(bool add) {
        if(!File.Exists(FilePath("root.pfx")))return;
        using(var cert=Root())using(var store=new X509Store(StoreName.Root,StoreLocation.CurrentUser)) {
            store.Open(OpenFlags.ReadWrite);
            if(add)store.Add(new X509Certificate2(cert.RawData));
            else foreach(var old in store.Certificates.Find(X509FindType.FindByThumbprint,cert.Thumbprint,false))store.Remove(old);
        }
    }
    static string[] Keys={"ProxyEnable","ProxyServer","ProxyOverride","AutoConfigURL"};
    static void Notify(){if(Testing)return;InternetSetOption(IntPtr.Zero,39,IntPtr.Zero,0);InternetSetOption(IntPtr.Zero,37,IntPtr.Zero,0);}
    static void ProxyOn(string server) {
        if(File.Exists(FilePath("proxy-backup.json")))throw new Exception("A previous capture session needs network recovery first.");
        if(!System.Text.RegularExpressions.Regex.IsMatch(server,@"^127\.0\.0\.1:\d{1,5}$"))throw new Exception("Invalid local proxy");
        using(var key=Registry.CurrentUser.OpenSubKey(SettingsPath,true)) {
            var backup=new Dictionary<string,object>();
            foreach(string name in Keys) {var item=new Dictionary<string,object>();object value=key.GetValue(name,null,RegistryValueOptions.DoNotExpandEnvironmentNames);item["exists"]=value!=null; if(value!=null){item["value"]=value;item["kind"]=(int)key.GetValueKind(name);}backup[name]=item;}
            backup["captureServer"]="http="+server+";https="+server;
            Save("proxy-backup.json",backup); // Journal before any settings change.
            key.SetValue("ProxyServer",backup["captureServer"],RegistryValueKind.String);
            key.SetValue("ProxyOverride","<local>;localhost;127.*;[::1]",RegistryValueKind.String);
            key.DeleteValue("AutoConfigURL",false);
            key.SetValue("ProxyEnable",1,RegistryValueKind.DWord);
        }
        Notify();
    }
    static void ProxyOff() {
        if(!File.Exists(FilePath("proxy-backup.json")))return;
        var saved=Load("proxy-backup.json");
        using(var key=Registry.CurrentUser.OpenSubKey(SettingsPath,true)) {
            string current=Convert.ToString(key.GetValue("ProxyServer",""));
            if(current!=Convert.ToString(saved["captureServer"])&&current==Convert.ToString(((Dictionary<string,object>)saved["ProxyServer"]).ContainsKey("value")?((Dictionary<string,object>)saved["ProxyServer"])["value"]:"")){File.Delete(FilePath("proxy-backup.json"));return;}
            if(current!=Convert.ToString(saved["captureServer"]))throw new Exception("Proxy was changed by another app. Original backup was preserved; no overwrite was made.");
            foreach(string name in Keys) {
                var item=(Dictionary<string,object>)saved[name];
                if(Convert.ToBoolean(item["exists"])) {var kind=(RegistryValueKind)Convert.ToInt32(item["kind"]);object value=item["value"];if(kind==RegistryValueKind.DWord)value=Convert.ToInt32(value);key.SetValue(name,value,kind);}
                else key.DeleteValue(name,false);
            }
        }
        Notify();File.Delete(FilePath("proxy-backup.json"));
    }
    static void Recover(bool checkOwner) {
        using(var mutex=new Mutex(false,"Local\\MengrenCapture-"+WindowsIdentity.GetCurrent().User.Value)) {
            mutex.WaitOne();try {
                if(checkOwner&&File.Exists(FilePath("capture.lock"))) {
                    var pid=Convert.ToInt32(Load("capture.lock")["pid"]);
                    try{using(var active=Process.GetProcessById(pid)){if(!active.HasExited)throw new Exception("Capture is still active. Exit its window first.");}}catch(ArgumentException){}
                }
                try{ProxyOff();}finally{Trust(false);}
                if(checkOwner&&File.Exists(FilePath("capture.lock")))File.Delete(FilePath("capture.lock"));
            }finally{mutex.ReleaseMutex();}
        }
    }
    static void Guard(int owner) {
        try {using(var process=Process.GetProcessById(owner)){process.WaitForExit();}}catch(ArgumentException){}
        if(File.Exists(FilePath("capture.lock"))&&Convert.ToInt32(Load("capture.lock")["pid"])!=owner)return;
        try{Recover(true);}catch(Exception e){File.WriteAllText(FilePath("recovery-needed.txt"),e.Message);}
    }
    static void TestProxy() {
        Testing=true;SettingsPath=@"Software\MengrenDownloader\CaptureTest\"+Guid.NewGuid().ToString("N");
        try {
            using(var key=Registry.CurrentUser.CreateSubKey(SettingsPath)) {
                key.SetValue("ProxyEnable",1,RegistryValueKind.DWord);key.SetValue("ProxyServer","127.0.0.1:9876");key.SetValue("ProxyOverride","<local>;fixture");key.SetValue("AutoConfigURL","https://example.invalid/proxy.pac");
            }
            ProxyOn("127.0.0.1:7777");ProxyOff();
            using(var key=Registry.CurrentUser.OpenSubKey(SettingsPath,true)) {
                if(Convert.ToString(key.GetValue("ProxyServer"))!="127.0.0.1:9876"||Convert.ToString(key.GetValue("AutoConfigURL"))!="https://example.invalid/proxy.pac"||Convert.ToString(key.GetValue("ProxyOverride"))!="<local>;fixture")throw new Exception("Proxy recovery mismatch");
            }
            ProxyOn("127.0.0.1:7777");
            using(var key=Registry.CurrentUser.OpenSubKey(SettingsPath,true))key.SetValue("ProxyServer","127.0.0.1:5678");
            bool refused=false;try{ProxyOff();}catch{refused=true;}
            if(!refused)throw new Exception("External proxy changes were overwritten");
            using(var key=Registry.CurrentUser.OpenSubKey(SettingsPath))if(Convert.ToString(key.GetValue("ProxyServer"))!="127.0.0.1:5678")throw new Exception("External proxy value changed");
            Console.WriteLine("Isolated proxy backup/recovery/conflict checks passed.");
        }finally{Registry.CurrentUser.DeleteSubKeyTree(SettingsPath,false);if(File.Exists(FilePath("proxy-backup.json")))File.Delete(FilePath("proxy-backup.json"));}
    }
    static int Main(string[] args) {
        try {
            if(args.Length<2)throw new Exception("Missing capture helper arguments");
            Dir=Path.GetFullPath(args[1]);
            switch(args[0]) {
                case "selftest-proxy": TestProxy();break;
                case "routing": using(var key=Registry.CurrentUser.OpenSubKey(SettingsPath)){var r=new Dictionary<string,object>();foreach(string name in Keys){var entry=new Dictionary<string,object>();entry["value"]=key.GetValue(name,null);r[name]=entry;}Console.WriteLine(Json.Serialize(r));}break;
                case "init": Init();break;
                case "leaf": Leaf(args[2]);break;
                case "trust": Trust(true);break;
                case "untrust": Trust(false);break;
                case "proxy-on": ProxyOn(args[2]);break;
                case "recover": Recover(true);Console.WriteLine("Network recovery completed.");break;
                case "end": Recover(false);break;
                case "check": using(var rsa=new RSACryptoServiceProvider(2048)){rsa.PersistKeyInCsp=false;new CertificateRequest("CN=check",rsa,HashAlgorithmName.SHA256,RSASignaturePadding.Pkcs1);Console.WriteLine("Capture helper check passed.");}break;
                case "guard": Guard(Int32.Parse(args[2]));break;
                default:throw new Exception("Unknown capture helper action");
            }
            return 0;
        }catch(Exception e){Console.Error.WriteLine(e.Message);return 1;}
    }
}