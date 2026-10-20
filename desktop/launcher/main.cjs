"use strict";

const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { RETRY_AFTER_MS, isNewerVersion, getLatestRelease } = require("./update-watch.cjs");

// A dedicated port prevents this app from hijacking the existing user's
// standard Paperclip instance on port 3100.
const PORT = 31287;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const HOST = "127.0.0.1";
const HEALTH_PATH = "/api/health";
// The published Paperclip server's first cold import may itself take ~120 sec
// on Windows; embedded PostgreSQL and migrations run afterward.
const START_TIMEOUT_MS = 480_000;
let serverChild = null;
let window = null;
let shuttingDown = false;
let updateTimer = null;
let lastNotifiedRelease = null;

async function checkArabicUpdates() {
  if (shuttingDown || !window || window.isDestroyed()) return;
  try {
    const release = await getLatestRelease();
    if (!release || !isNewerVersion(release.version, app.getVersion()) || lastNotifiedRelease === release.version) return;
    lastNotifiedRelease = release.version;
    const answer = await dialog.showMessageBox(window, {
      type: "info",
      title: "تحديث جديد لبرنامج شركتي",
      message: `تتوفر نسخة عربية جديدة (${release.version}).`,
      detail: "يمكنك مراجعة التغييرات وتنزيل النسخة الجديدة. احفظ نسخة احتياطية من بياناتك قبل تثبيت أي تحديث.",
      buttons: ["عرض التحديث", "لاحقًا"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (answer.response === 0) await shell.openExternal(release.url);
  } catch {
    // Offline, unpublished fork or GitHub API rate-limit: the app still works.
  }
}

function bundledPaths() {
  const runtime = app.isPackaged
    ? path.join(process.resourcesPath, "runtime")
    : path.resolve(__dirname, "..", "runtime");
  const cliDir = path.join(runtime, "node_modules", "paperclipai");
  const pkgPath = path.join(cliDir, "package.json");
  if (!existsSync(pkgPath)) throw new Error("Missing Paperclip server payload. Rebuild via the Arabic Desktop packaging instructions.");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const entry = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.paperclipai;
  if (!entry) throw new Error("The installed Paperclip package has no CLI entry point.");
  const node = path.join(runtime, "node.exe");
  if (!existsSync(node)) throw new Error("Bundled Node.js 24 runtime is missing.");
  return { node, cli: path.join(cliDir, entry), runtime };
}

function httpHealth(timeout = 1500) {
  return new Promise((resolve) => {
    const req = http.get(`${ORIGIN}${HEALTH_PATH}`, { timeout }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { if (body.length < 65536) body += chunk; });
      res.on("end", () => {
        try {
          const status = JSON.parse(body);
          resolve(res.statusCode === 200 && status?.status === "ok" && Boolean(status?.version));
        } catch { resolve(false); }
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

function launchCli(command, extra, options = {}) {
  const { node, cli, runtime } = bundledPaths();
  const env = {
    ...process.env,
    PATH: `${runtime}${path.delimiter}${process.env.PATH ?? ""}`,
    PORT: String(PORT),
    HOST,
    PAPERCLIP_DEPLOYMENT_MODE: "local_trusted",
    PAPERCLIP_NO_BROWSER: "true",
    BROWSER: "none",
    NO_COLOR: "1",
    ELECTRON_RUN_AS_NODE: "",
  };
  return spawn(node, [cli, command, ...extra], {
    ...options,
    windowsHide: true,
    env,
    cwd: runtime,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runAndWait(command, args, timeout = 90_000) {
  return new Promise((resolve, reject) => {
    const proc = launchCli(command, args);
    let output = "";
    const onData = (part) => { output = (output + part.toString()).slice(-12_000); };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    const timer = setTimeout(() => { proc.kill(); reject(new Error(`${command}: startup timeout`)); }, timeout);
    proc.once("error", (err) => { clearTimeout(timer); reject(err); });
    proc.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`${command} exited ${code}: ${output.slice(-1200)}`));
    });
  });
}

async function ensureServer() {
  // Preserves the user's existing ~/.paperclip instances. No destructive
  // migration, resetting of credentials or replacement of prior data.
  const dataDir = path.join(app.getPath("userData"), "paperclip-data");
  // One foreground CLI process. The automatic setup (`run`) cannot initialize
  // with stdin redirected; `onboard --yes` both initializes and starts it.
  // On subsequent launches, `run` reuses this isolated, stored configuration.
  const configExists = existsSync(path.join(dataDir, "instances", "default", "config.json"));
  serverChild = configExists
    ? launchCli("run", ["--data-dir", dataDir])
    : launchCli("onboard", ["--yes", "--no-install-service", "--data-dir", dataDir]);
  const chunks = [];
  const record = (part) => {
    chunks.push(String(part).slice(-1500));
    if (chunks.length > 12) chunks.shift();
  };
  serverChild.stdout?.on("data", record);
  serverChild.stderr?.on("data", record);
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (!shuttingDown && Date.now() < deadline) {
    if (await httpHealth()) return;
    if (serverChild.exitCode !== null) {
      throw new Error(`Paperclip stopped during startup (${serverChild.exitCode}). ${chunks.join("").slice(-2000)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }
  throw new Error(`The local Paperclip server did not become ready. ${chunks.join("").slice(-2000)}`);
}

function isAllowedUrl(raw) {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" && parsed.hostname === HOST && parsed.port === String(PORT);
  } catch { return false; }
}

function createWindow() {
  window = new BrowserWindow({
    width: 1450, height: 900, minWidth: 980, minHeight: 620,
    title: "شركتي — Paperclip عربي",
    autoHideMenuBar: true,
    backgroundColor: "#111827",
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedUrl(url)) event.preventDefault();
  });
  void window.loadFile(path.join(__dirname, "assets", "loading.html"));
}

async function boot() {
  createWindow();
  try {
    await ensureServer();
    if (window && !window.isDestroyed()) await window.loadURL(ORIGIN);
    // Arabic builds are published separately; never offer a raw upstream EXE.
    void checkArabicUpdates();
    updateTimer = setInterval(() => void checkArabicUpdates(), RETRY_AFTER_MS);
    updateTimer.unref?.();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("تعذّر تشغيل Paperclip", `${message}\n\nلم تُحذف بياناتك. يمكنك مراجعة تعليمات التشغيل داخل المشروع.`);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(boot);
}

app.on("before-quit", () => {
  shuttingDown = true;
  if (updateTimer) clearInterval(updateTimer);
  if (serverChild && serverChild.exitCode === null) serverChild.kill();
});
app.on("window-all-closed", () => app.quit());
