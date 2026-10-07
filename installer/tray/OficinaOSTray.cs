// OficinaOSTray — ícone na bandeja para gerir o serviço OficinaOS.
// .NET Framework 4.x (compila com csc.exe, sem dependências):
//   csc /target:winexe /win32icon:..\OficinaOS.ico /out:OficinaOSTray.exe
//       /r:System.Windows.Forms.dll /r:System.Drawing.dll OficinaOSTray.cs
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Windows.Forms;

internal static class Program
{
    private const string AppUrl = "http://localhost:4000";
    private const string ServiceName = "OficinaOS";

    private static string InstallRoot
    {
        get
        {
            return Directory.GetParent(
                AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\')).FullName;
        }
    }

    private static NotifyIcon _tray;
    private static ToolStripMenuItem _statusItem;
    private static ToolStripMenuItem _toggleItem;
    private static System.Threading.Timer _timer;

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();

        _statusItem = new ToolStripMenuItem("A verificar estado...") { Enabled = false };
        _toggleItem = new ToolStripMenuItem("Parar OficinaOS", null, (s, e) => ToggleService());

        var menu = new ContextMenuStrip();
        menu.Items.Add("Abrir OficinaOS", null, (s, e) => OpenApp());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(_statusItem);
        menu.Items.Add(_toggleItem);
        menu.Items.Add("Reiniciar OficinaOS", null, (s, e) => RestartService());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Fazer backup agora", null, (s, e) => RunBackup());
        menu.Items.Add("Abrir pasta de backups", null, (s, e) => OpenBackups());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Sair", null, (s, e) => { _tray.Visible = false; Application.Exit(); });

        _tray = new NotifyIcon
        {
            Icon = LoadIcon(),
            Text = "OficinaOS",
            ContextMenuStrip = menu,
            Visible = true,
        };
        _tray.DoubleClick += (s, e) => OpenApp();

        _timer = new System.Threading.Timer(_ => RefreshStatus(), null, 0, 15000);
        Application.Run();
    }

    private static Icon LoadIcon()
    {
        var ico = Path.Combine(InstallRoot, "OficinaOS.ico");
        try { return File.Exists(ico) ? new Icon(ico) : SystemIcons.Application; }
        catch { return SystemIcons.Application; }
    }

    private static void RefreshStatus()
    {
        var running = false;
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(AppUrl + "/health");
            req.Timeout = 3000;
            using (req.GetResponse()) { }
            running = true;
        }
        catch { }

        var text = running ? "OficinaOS a correr — " + AppUrl : "OficinaOS parado";
        var parent = _statusItem.GetCurrentParent();
        if (parent != null && parent.InvokeRequired)
            parent.Invoke(new Action(() => SetStatus(text, running)));
        else
            SetStatus(text, running);
    }

    private static void SetStatus(string text, bool running)
    {
        _statusItem.Text = text;
        _toggleItem.Text = running ? "Parar OficinaOS" : "Iniciar OficinaOS";
    }

    private static void OpenApp() { Process.Start(AppUrl); }

    private static void ToggleService()
    {
        var running = _statusItem.Text.StartsWith("OficinaOS a correr");
        RunElevated(running ? "Stop-Service OficinaOS" : "Start-Service OficinaOS");
        _timer.Change(3000, 15000); // re-verificar daqui a 3s
    }

    private static void RestartService()
    {
        RunElevated("Restart-Service OficinaOS; Restart-Service OficinaOS-DB");
        _timer.Change(5000, 15000);
    }

    private static void RunBackup()
    {
        var ps1 = Path.Combine(InstallRoot, @"tools\backup.ps1");
        var psi = new ProcessStartInfo("powershell.exe",
            "-NoProfile -ExecutionPolicy Bypass -File \"" + ps1 + "\"")
        { UseShellExecute = true, Verb = "runas" }; // ProgramData exige elevação
        try { Process.Start(psi); }
        catch { /* UAC recusado */ }
    }

    private static void OpenBackups()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            @"OficinaOS\backups");
        if (Directory.Exists(dir)) Process.Start(dir);
    }

    private static void RunElevated(string command)
    {
        var psi = new ProcessStartInfo("powershell.exe",
            "-NoProfile -Command " + command)
        { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden };
        try { Process.Start(psi); }
        catch { MessageBox.Show("Operação cancelada.", "OficinaOS"); }
    }
}
