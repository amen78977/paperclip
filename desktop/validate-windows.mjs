/** Release integrity check. Prevents shipping a "working" EXE lacking server. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outputIndex = process.argv.indexOf("--output");
if (outputIndex !== -1 && !process.argv[outputIndex + 1]) {
  throw new Error("--output requires a directory");
}
const dist = outputIndex === -1
  ? path.join(root, "desktop", "dist-windows")
  : path.resolve(process.argv[outputIndex + 1]);
const extracted = path.join(dist, "win-unpacked");
const runtime = path.join(extracted, "resources", "runtime");
const launcherPkg = JSON.parse(readFileSync(path.join(root, "desktop", "launcher", "package.json"), "utf8"));
const launcherVersion = launcherPkg.version;
if (typeof launcherVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(launcherVersion)) {
  throw new Error("Invalid launcher version; cannot identify the expected release installer.");
}
const installer = path.join(dist, `Paperclip-Arabic-Setup-${launcherVersion}.exe`);
const portableOnly = process.argv.includes("--portable");
const mandatory = {
  "Electron application": path.join(extracted, "Paperclip Arabic.exe"),
  "Electron app.asar": path.join(extracted, "resources", "app.asar"),
  "Electron update feed": path.join(extracted, "resources", "app-update.yml"),
  "Node.js v24": path.join(runtime, "node.exe"),
  "Paperclip CLI": path.join(runtime, "node_modules", "paperclipai", "dist", "index.js"),
  "Paperclip server": path.join(runtime, "node_modules", "@paperclipai", "server", "dist", "index.js"),
  "Hermes Windows execution adapter": path.join(runtime, "node_modules", "@paperclipai", "hermes-paperclip-adapter", "dist", "server", "execute.js"),
  "Local agent master secret boundary": path.join(runtime, "node_modules", "@paperclipai", "adapter-utils", "dist", "server-utils.js"),
  "OpenCode Windows permission adapter": path.join(runtime, "node_modules", "@paperclipai", "adapter-opencode-local", "dist", "server", "runtime-config.js"),
  "Agent runtime binding recovery": path.join(runtime, "node_modules", "@paperclipai", "server", "dist", "routes", "agents.js"),
  "Hoisted Teams Graph runtime": path.join(runtime, "node_modules", "@microsoft", "teams.graph-endpoints", "package.json"),
  "Embedded PostgreSQL": path.join(runtime, "node_modules", "@embedded-postgres", "windows-x64", "native", "bin", "postgres.exe"),
  "Arabic web UI": path.join(runtime, "node_modules", "@paperclipai", "server", "ui-dist", "index.html"),
  ...(!portableOnly ? { "Windows installer": installer } : {}),
};

for (const [label, filename] of Object.entries(mandatory)) {
  if (!existsSync(filename) || statSync(filename).size === 0) {
    throw new Error(`${label} missing or empty: ${filename}`);
  }
  console.log(`PASS ${label}`);
}
const feed = readFileSync(mandatory["Electron update feed"], "utf8");
if (!/provider:\s*github/.test(feed) || !/owner:\s*amen78977/.test(feed) || !/repo:\s*paperclip/.test(feed)) {
  throw new Error("Electron update feed is not bound to the Arabic GitHub repository.");
}
// Verify the actual packaged Electron main archive includes its production
// updater dependencies (not only the dev checkout's node_modules).
const launcherRequire = createRequire(path.join(root, "desktop", "launcher", "package.json"));
const { listPackage } = launcherRequire("@electron/asar");
const packedFiles = listPackage(mandatory["Electron app.asar"]).map((p) => p.replaceAll("\\", "/"));
for (const required of ["/auto-update.cjs", "/update-watch.cjs", "/agent-jwt-secret.cjs", "/node_modules/electron-updater/out/main.js"]) {
  if (!packedFiles.some((p) => p.endsWith(required))) {
    throw new Error(`Missing critical auto-update module from the real Electron app.asar: ${required}`);
  }
}
console.log("PASS verified automatic updater and Arabic-only GitHub release feed in packaged app");
const agentRuntimeCode = readFileSync(mandatory["Agent runtime binding recovery"], "utf8");
if (!agentRuntimeCode.includes('existing.adapterType === requestedAdapterType && (existing.adapterType !== "paperclip_runner"') ||
    !agentRuntimeCode.includes('aiRuntimeConnectionBindingSchema.safeParse(requestedRuntimeConfig ? requestedRuntimeConfig.aiConnection : existing.runtimeConfig.aiConnection).data')) {
  throw new Error("Bundled server prevents selecting authenticated local CLI when a managed AI subscription expires.");
}
console.log("PASS bundled agent binding recovery for locally authenticated CLI");
const hermesCode = readFileSync(mandatory["Hermes Windows execution adapter"], "utf8");
if (!hermesCode.includes('model && model !== "auto"') ||
    !hermesCode.includes('if (cfgBoolean(config.dangerouslySkipPermissions) === true) args.push("--yolo")')) {
  throw new Error("Bundled Hermes adapter may hang on auto model or bypass command safety approvals.");
}
console.log("PASS bundled Hermes uses configured model and opt-in unsafe command permissions");
const masterBoundary = readFileSync(mandatory["Local agent master secret boundary"], "utf8");
if (!masterBoundary.includes('function stripServerOnlyAgentSecrets(env)') ||
    !masterBoundary.includes('const childEnv = stripServerOnlyAgentSecrets({ ...mergedEnv, ...target.env });') ||
    !masterBoundary.includes('remoteEnv: opts.remoteExecution ? sanitizedRequestedEnv : null')) {
  throw new Error("Agent child process can inherit server master JWT or Better Auth signing secret.");
}
console.log("PASS agent child process environments exclude master server signing secrets");
const openCodePermissionCode = readFileSync(mandatory["OpenCode Windows permission adapter"], "utf8");
if (!openCodePermissionCode.includes("Read-only managed AGENTS.md external-directory compatibility") ||
    openCodePermissionCode.includes('if (!skipPermissions) {\n        return {\n            env: input.env,\n            notes: [],')) {
  throw new Error("Bundled OpenCode cannot safely read its managed instructions without approval bypass.");
}
console.log("PASS OpenCode read-only managed instructions, with external directory approvals preserved");
if (!readFileSync(mandatory["Arabic web UI"], "utf8").includes('lang="ar"')) {
  throw new Error("Missing Arabic-first UI in packaged server.");
}
if (existsSync(path.join(runtime, "node_modules", "@paperclipai", "server", "node_modules", "@microsoft", "teams.graph-endpoints"))) {
  throw new Error("Deeply nested Teams Graph package remains: NSIS will omit required Windows files.");
}
if (!portableOnly && statSync(installer).size < 30_000_000) {
  throw new Error("Installer is suspiciously small, likely missing the runtime.");
}
// Verify the *current* UI assets are actually in the unpacked release, not
// just an old Arabic HTML file left behind by a previous build.
const builtUi = path.join(root, "ui", "dist");
const packagedUi = path.join(runtime, "node_modules", "@paperclipai", "server", "ui-dist");
let checked = 0;
function verifyAssets(relative = "") {
  for (const entry of readdirSync(path.join(builtUi, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) { verifyAssets(name); continue; }
    if (!entry.isFile()) continue;
    const a = path.join(builtUi, name);
    const b = path.join(packagedUi, name);
    if (!existsSync(b) || statSync(a).size !== statSync(b).size) {
      throw new Error(`Outdated or missing packaged UI asset: ${name}`);
    }
    const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
    if (sha(a) !== sha(b)) throw new Error(`Packaged UI differs from latest source build: ${name}`);
    checked++;
  }
}
verifyAssets();
console.log(`PASS latest Arabic UI bundled: ${checked} identical assets`);
if (portableOnly) {
  console.log("PASS unpacked Windows EXE and runtime (portable directory mode)");
} else {
  if (statSync(installer).mtimeMs < statSync(mandatory["Electron app.asar"]).mtimeMs) {
    throw new Error("Installer predates the current Windows executable; rebuild NSIS before distributing.");
  }
  console.log(`PASS installer integrity: ${(statSync(installer).size / 1024 / 1024).toFixed(1)} MiB`);
}
