using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;

// Keep the normal Hermes CLI argument contract while executing its Python
// foreground bridge. No shell, credential arguments, or persistent daemon.
class HermesForeground {
    static string Quote(string value) {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') result.Append('\\', slashes * 2 + 1);
            else result.Append('\\', slashes);
            result.Append(c);
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        return result.Append('"').ToString();
    }
    static int Main(string[] args) {
        try {
            string python = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "hermes", "hermes-agent", "venv", "Scripts", "python.exe");
            string script = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "hermes-foreground.py");
            if (!File.Exists(python) || !File.Exists(script)) {
                Console.Error.WriteLine("Hermes foreground runtime is missing");
                return 1;
            }
            var arguments = new StringBuilder("-u " + Quote(script));
            foreach (string arg in args) arguments.Append(" " + Quote(arg));
            var start = new ProcessStartInfo(python, arguments.ToString());
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            start.EnvironmentVariables["PYTHONUTF8"] = "1";
            start.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
            using (var child = Process.Start(start)) {
                var stdout = child.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
                var stderr = child.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
                child.WaitForExit();
                Task.WaitAll(stdout, stderr);
                return child.ExitCode;
            }
        } catch {
            Console.Error.WriteLine("Cannot start Hermes foreground runtime");
            return 1;
        }
    }
}
