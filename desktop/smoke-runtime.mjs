/** Isolated Windows smoke, never touches the user's ~/.paperclip data. */
import { spawn } from "node:child_process";
import { mkdirSync, existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = path.join(root, "desktop", "runtime");
// Windows GitHub runners cannot reliably chmod checkout folders during
// PostgreSQL initdb ("fixing permissions on existing directory" fails).
// Create a fresh, owned, isolated cluster in the user's temporary directory.
// This never touches an existing Paperclip database or smoke-test-data folder.
const dataDir = mkdtempSync(path.join(os.tmpdir(), "paperclip-arabic-smoke-"));
const cli = path.join(runtime, "node_modules", "paperclipai", "dist", "index.js");
const node = path.join(runtime, "node.exe");
const port = 31288;
mkdirSync(dataDir, { recursive: true });
const startedAt = Date.now();
const logs = [];
const wasInitialized = existsSync(path.join(dataDir, "instances", "default", "config.json"));
const commandArgs = wasInitialized
  ? [cli, "run", "--data-dir", dataDir]
  : [cli, "onboard", "--yes", "--no-install-service", "--data-dir", dataDir];
const child = spawn(node, commandArgs, {
  cwd: runtime,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PAPERCLIP_NO_BROWSER: "true",
    PORT: String(port),
    HOST: "127.0.0.1",
    NO_COLOR: "1",
  },
});
let exited = false;
let exitCode = null;
child.stdout.on("data", (data) => { logs.push(data.toString()); if (logs.length > 100) logs.shift(); });
child.stderr.on("data", (data) => { logs.push(data.toString()); if (logs.length > 100) logs.shift(); });
child.on("exit", (code) => { exited = true; exitCode = code; });

async function run() {
  try {
    let response = null;
    while (Date.now() - startedAt < 360_000 && !exited) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1500);
        try {
          response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: controller.signal });
          if (response.ok) {
            const json = await response.json();
            if (json.status === "ok") break;
          }
        } finally { clearTimeout(timeout); }
      } catch { /* Not listening yet. */ }
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    if (!response?.ok || exited) {
      throw new Error(`Startup unsuccessful: exit=${exitCode}, health=${response?.status ?? "no response"}\n${logs.join("").slice(-2500)}`);
    }
    const frontend = await fetch(`http://127.0.0.1:${port}/`);
    const markup = await frontend.text();
    if (!frontend.ok || !markup.includes('lang="ar"')) {
      throw new Error(`Arabic frontend not served (status ${frontend.status}, lang ar=${markup.includes('lang="ar"')}).`);
    }
    console.log(`PASS: HTTP health + Arabic UI HTML on loopback ${port}; elapsed ${Math.ceil((Date.now()-startedAt)/1000)} s`);
  } finally {
    if (!exited) child.kill("SIGINT");
    setTimeout(() => { if (!exited) child.kill(); }, 1200).unref();
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
