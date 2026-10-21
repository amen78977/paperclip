"use strict";

// Electron's signed SHA512 latest.yml payload is used by electron-updater;
// the GitHub release gate ensures we never install the official ENGLISH app.
// Updates download unattended, and apply automatically when the app closes,
// so running agents and unsaved edits are not interrupted by forced restarts.
const http = require("node:http");
const { getLatestRelease, isNewerVersion, RETRY_AFTER_MS } = require("./update-watch.cjs");

const RELEASE_PROVIDER = Object.freeze({ provider: "github", owner: "amen78977", repo: "paperclip" });
const API_HOST = "127.0.0.1";
const API_PORT = 31287;
const BACKUP_PATH = "/api/instance/database-backups";
const IDLE_SECONDS_FOR_RESTART = 30 * 60;
const IDLE_RETRY_MS = 10 * 60 * 1000;

function localJson(path, { httpClient = http, timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => { if (!done) { done = true; resolve(result); } };
    const req = httpClient.get({ hostname: API_HOST, port: API_PORT, path, timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) { res.resume(); finish(null); return; }
      let data = "";
      res.on("data", (chunk) => {
        if (data.length + chunk.length > 3_000_000) { req.destroy(); finish(null); }
        else data += chunk;
      });
      res.on("end", () => { try { finish(JSON.parse(data)); } catch { finish(null); } });
    });
    req.once("timeout", () => { req.destroy(); finish(null); });
    req.once("error", () => finish(null));
  });
}

async function canRestartWithoutInterruptingAgents({ fetchJson = localJson } = {}) {
  const companies = await fetchJson("/api/companies");
  if (!Array.isArray(companies) || companies.length > 50) return false;
  for (const company of companies) {
    if (!/^[a-f0-9-]{36}$/i.test(company.id)) return false;
    const runs = await fetchJson(`/api/companies/${company.id}/heartbeat-runs`);
    if (!Array.isArray(runs)) return false;
    // Unknown new states block an unattended restart until reviewed.
    if (runs.some((run) => !["succeeded", "failed", "cancelled", "timed_out", "skipped"].includes(run?.status))) return false;
  }
  return true;
}

function createPreInstallBackup({ httpClient = http, timeoutMs = 180_000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const req = httpClient.request({
      hostname: API_HOST, port: API_PORT, path: BACKUP_PATH,
      method: "POST", timeout: timeoutMs,
      headers: { "Content-Type": "application/json", "Content-Length": 2 },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        if (data.length + chunk.length > 90_000) { req.destroy(); finish(false); }
        else data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode !== 201) return finish(false);
        try {
          const result = JSON.parse(data);
          finish(Boolean(result.finishedAt && result.startedAt && result.backupDir));
        } catch { finish(false); }
      });
    });
    req.once("timeout", () => { req.destroy(); finish(false); });
    req.once("error", () => finish(false));
    req.end("{}");
  });
}

function startAutomaticUpdates({ app, updater, onLog = () => {},
  lookup = getLatestRelease, backup = createPreInstallBackup,
  idleSeconds = () => 0, safeToRestart = canRestartWithoutInterruptingAgents } = {}) {
  if (!app || !updater) throw new Error("An Electron app and updater are required");
  // Disabled in dev builds. Installing a new version into the source tree
  // would corrupt the development environment.
  if (!app.isPackaged) return { stop() {}, check: async () => false };

  onLog("auto_update_service_started", app.getVersion());
  updater.setFeedURL(RELEASE_PROVIDER);
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false; // unlocked only after a fresh backup
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;

  let checking = false;
  let stopped = false;
  let approvedVersion = null;
  let backedUpVersion = null;
  let restarting = false;

  const installIfIdle = async () => {
    if (stopped || restarting || !backedUpVersion || !updater.autoInstallOnAppQuit) return false;
    try {
      // Never silently close the desktop while the user is working.
      if (idleSeconds() < IDLE_SECONDS_FOR_RESTART) return false;
      const safe = await safeToRestart();
      if (!safe || stopped || restarting || !updater.autoInstallOnAppQuit) return false;
      restarting = true;
      onLog("auto_update_idle_restarting", backedUpVersion);
      updater.quitAndInstall(true, true);
      return true;
    } catch (error) {
      restarting = false;
      onLog("auto_update_install_failed", String(error?.message || error));
      return false;
    }
  };

  updater.on("error", (error) => onLog("auto_update_error", String(error?.message || error)));
  updater.on("update-downloaded", async (info) => {
    if (stopped || !approvedVersion || info.version !== approvedVersion) {
      updater.autoInstallOnAppQuit = false;
      onLog("auto_update_skipped", "Downloaded version not from the verified Arabic release");
      return;
    }
    if (backedUpVersion === info.version) return;
    let ok = false;
    try { ok = await backup(); } catch { ok = false; }
    if (stopped) return;
    if (!ok) {
      updater.autoInstallOnAppQuit = false;
      onLog("auto_update_backup_failed", info.version);
      return;
    }
    backedUpVersion = info.version;
    updater.autoInstallOnAppQuit = true;
    // electron-updater's BaseUpdater calls addQuitHandler() synchronously
    // right after dispatching update-downloaded. Our required PostgreSQL
    // backup is asynchronous, so autoInstallOnAppQuit was still false when
    // that one-time registration check occurred. Explicitly register the
    // handler *after* the backup succeeds; otherwise a normal app close does
    // not install anything even though we logged "prepared".
    try {
      if (typeof updater.addQuitHandler !== "function") throw new Error("Quit hook not supported");
      updater.addQuitHandler();
    } catch {
      updater.autoInstallOnAppQuit = false;
      backedUpVersion = null;
      onLog("auto_update_quit_hook_failed", info.version);
      return;
    }
    onLog("auto_update_prepared", info.version);
    // No confirmation or manual installation step. Apply when the app closes,
    // OR restart unattended after 30 minutes idle with no active agent runs.
    void installIfIdle();
  });

  const check = async () => {
    if (checking || stopped) return false;
    checking = true;
    try {
      onLog("auto_update_check_started", app.getVersion());
      const release = await lookup();
      if (!release) {
        onLog("auto_update_release_lookup_empty");
        return false;
      }
      if (!isNewerVersion(release.version, app.getVersion())) {
        onLog("auto_update_already_current", release.version);
        return false;
      }
      approvedVersion = release.version;
      const update = await updater.checkForUpdates();
      // A mismatch cannot be installed, even if the GitHub feed or metadata
      // points to an unexpected source/version.
      if (update?.updateInfo?.version !== approvedVersion) {
        approvedVersion = null;
        updater.autoInstallOnAppQuit = false;
        onLog("auto_update_mismatch", "Release and update metadata versions differ");
        return false;
      }
      onLog("auto_update_available", approvedVersion);
      return true;
    } catch (err) {
      onLog("auto_update_check_failed", String(err?.message || err));
      return false;
    } finally {
      checking = false;
    }
  };
  const timer = setInterval(() => { void check(); }, RETRY_AFTER_MS);
  timer.unref?.();
  // Don't slow down first paint. The frontend and database come up first.
  const initialTimer = setTimeout(() => { void check(); }, 8000);
  initialTimer.unref?.();
  const installTimer = setInterval(() => { void installIfIdle(); }, IDLE_RETRY_MS);
  installTimer.unref?.();
  return {
    check,
    installIfIdle,
    stop() { stopped = true; clearTimeout(initialTimer); clearInterval(timer); clearInterval(installTimer); },
  };
}

module.exports = { RELEASE_PROVIDER, createPreInstallBackup, canRestartWithoutInterruptingAgents, startAutomaticUpdates };
