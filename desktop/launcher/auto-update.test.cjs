"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createPreInstallBackup, canRestartWithoutInterruptingAgents, startAutomaticUpdates } = require("./auto-update.cjs");

const companyId = "038e6547-26c2-4f68-b0ff-08da6314a44c";
const flush = () => new Promise((r) => setTimeout(r, 5));
const goodRelease = { version: "0.1.12", url: "https://github.com/amen78977/paperclip/releases/tag/arabic-v0.1.12" };
function updaterFixture(version = "0.1.12") {
  const updater = new EventEmitter();
  updater.setFeedURL = (feed) => { updater.feed = feed; };
  updater.checkForUpdates = async () => ({ updateInfo: { version } });
  updater.installCalls = 0;
  updater.quitHookRegistrations = 0;
  updater.addQuitHandler = () => { updater.quitHookRegistrations++; };
  updater.quitAndInstall = () => { updater.installCalls++; };
  return updater;
}
function fixture(updater, options = {}) {
  return startAutomaticUpdates({
    app: { isPackaged: true, getVersion: () => "0.1.11" },
    updater,
    lookup: async () => goodRelease,
    backup: async () => true,
    idleSeconds: () => 0,
    safeToRestart: async () => true,
    ...options,
  });
}

test("unverified update metadata is never installable", async () => {
  const updater = updaterFixture("0.1.99");
  const updates = fixture(updater);
  try {
    assert.equal(await updates.check(), false);
    updater.emit("update-downloaded", { version: "0.1.99" });
    await flush();
    assert.equal(updater.autoInstallOnAppQuit, false);
    assert.equal(updater.installCalls, 0);
  } finally { updates.stop(); }
});

test("verified update installs unattended on app close only after a successful backup", async () => {
  let backups = 0;
  const updater = updaterFixture();
  const updates = fixture(updater, { backup: async () => { backups++; return true; } });
  try {
    assert.equal(updater.autoInstallOnAppQuit, false);
    assert.equal(await updates.check(), true);
    assert.deepEqual(updater.feed, { provider: "github", owner: "amen78977", repo: "paperclip" });
    updater.emit("update-downloaded", { version: goodRelease.version });
    await flush();
    assert.equal(backups, 1);
    assert.equal(updater.autoInstallOnAppQuit, true);
    assert.equal(updater.quitHookRegistrations, 1);
    assert.equal(updater.installCalls, 0);
  } finally { updates.stop(); }
});

test("failed backup prevents an update being applied", async () => {
  const updater = updaterFixture();
  const updates = fixture(updater, { backup: async () => false });
  try {
    await updates.check();
    updater.emit("update-downloaded", { version: goodRelease.version });
    await flush();
    assert.equal(updater.autoInstallOnAppQuit, false);
    assert.equal(updater.quitHookRegistrations, 0);
    assert.equal(await updates.installIfIdle(), false);
  } finally { updates.stop(); }
});

test("missing quit handler blocks installation rather than skipping backup gate", async () => {
  const updater = updaterFixture();
  delete updater.addQuitHandler;
  const updates = fixture(updater);
  try {
    await updates.check();
    updater.emit("update-downloaded", { version: goodRelease.version });
    await flush();
    assert.equal(updater.autoInstallOnAppQuit, false);
    assert.equal(await updates.installIfIdle(), false);
  } finally { updates.stop(); }
});

test("idle restart checks user presence and in-flight agents", async () => {
  let idle = 0;
  let agentsQuiet = false;
  const updater = updaterFixture();
  const updates = fixture(updater, { idleSeconds: () => idle, safeToRestart: async () => agentsQuiet });
  try {
    await updates.check();
    updater.emit("update-downloaded", { version: goodRelease.version });
    await flush();
    assert.equal(await updates.installIfIdle(), false);
    idle = 31 * 60;
    assert.equal(await updates.installIfIdle(), false);
    agentsQuiet = true;
    assert.equal(await updates.installIfIdle(), true);
    assert.equal(updater.installCalls, 1);
  } finally { updates.stop(); }
});

test("unexpected run states and API errors block automatic restarts", async () => {
  const fetcher = (status) => async (path) => path === "/api/companies"
    ? [{ id: companyId }]
    : status === null ? null : [{ status }];
  assert.equal(await canRestartWithoutInterruptingAgents({ fetchJson: fetcher("succeeded") }), true);
  assert.equal(await canRestartWithoutInterruptingAgents({ fetchJson: fetcher("running") }), false);
  assert.equal(await canRestartWithoutInterruptingAgents({ fetchJson: fetcher("future_new_state") }), false);
  assert.equal(await canRestartWithoutInterruptingAgents({ fetchJson: fetcher(null) }), false);
});

test("user activity during the asynchronous agent check cancels idle installation", async () => {
  let idle = 31 * 60;
  const updater = updaterFixture();
  const updates = fixture(updater, {
    idleSeconds: () => idle,
    safeToRestart: async () => { idle = 0; return true; },
  });
  try {
    await updates.check();
    updater.emit("update-downloaded", { version: goodRelease.version });
    await flush();
    assert.equal(updater.installCalls, 0);
    assert.equal(await updates.installIfIdle(), false);
  } finally { updates.stop(); }
});

test("an interrupted backup response settles as failure instead of hanging", async () => {
  const response = new EventEmitter();
  response.statusCode = 201;
  const request = new EventEmitter();
  request.destroy = () => {};
  request.end = () => queueMicrotask(() => {
    callback(response);
    response.emit("data", '{"startedAt":');
    response.emit("aborted");
    response.emit("close");
  });
  let callback;
  const httpClient = { request: (_options, handler) => { callback = handler; return request; } };
  let timer;
  try {
    const result = await Promise.race([
      createPreInstallBackup({ httpClient }),
      new Promise((resolve) => { timer = setTimeout(() => resolve("unsettled"), 100); }),
    ]);
    assert.equal(result, false);
  } finally { clearTimeout(timer); }
});
