/** Release integrity check. Prevents shipping a "working" EXE lacking server. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
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
  "Node.js v24": path.join(runtime, "node.exe"),
  "Paperclip CLI": path.join(runtime, "node_modules", "paperclipai", "dist", "index.js"),
  "Paperclip server": path.join(runtime, "node_modules", "@paperclipai", "server", "dist", "index.js"),
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
if (!readFileSync(mandatory["Arabic web UI"], "utf8").includes('lang="ar"')) {
  throw new Error("Missing Arabic-first UI in packaged server.");
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
