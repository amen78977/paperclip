/** Bundle the fresh Arabic UI and a local Node.js runtime for a Windows installer.
 * Run from the repository root: node desktop/stage-runtime.mjs
 * Does not edit the user's current Paperclip installation or personal data.
 */
import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const runtime = path.join(root, "desktop", "runtime");
const builtUI = path.join(root, "ui", "dist");
const publishedUI = path.join(runtime, "node_modules", "@paperclipai", "server", "ui-dist");
const installedCli = path.join(runtime, "node_modules", "paperclipai", "dist", "index.js");
if (process.platform !== "win32") throw new Error("This release targets Windows x64.");
for (const required of [builtUI, path.join(builtUI, "index.html"), installedCli, publishedUI]) {
  if (!existsSync(required)) throw new Error(`Missing build input: ${required}`);
}
if (!existsSync(path.join(builtUI, "assets")) || readdirSync(path.join(builtUI, "assets")).length < 1) {
  throw new Error("The Paperclip Arabic UI build is incomplete.");
}
mkdirSync(runtime, { recursive: true });
copyFileSync(process.execPath, path.join(runtime, "node.exe"));
// Overlay the customized UI on the published server's static resource tree.
// Assets retain their content-hash names; stale files are harmless.
cpSync(builtUI, publishedUI, { recursive: true, force: true });
// The published Paperclip adapter currently creates directory symlinks without
// telling Node they are directories. Ordinary Windows accounts cannot create
// those links (EPERM), whereas directory junctions work without admin rights.
// Keep this narrow compatibility shim until the upstream package implements
// Windows junctions itself. Fail closed if the shipped code changes.
const adapterUtils = path.join(runtime, "node_modules", "@paperclipai", "adapter-utils", "dist", "server-utils.js");
if (!existsSync(adapterUtils)) throw new Error(`Missing bundled Hermes skill helper: ${adapterUtils}`);
const unsafeSymlink = "fs.symlink(linkSource, linkTarget)";
const safeSymlink = 'fs.symlink(linkSource, linkTarget, process.platform === "win32" ? "junction" : undefined)';
const utilsSource = readFileSync(adapterUtils, "utf8");
if (utilsSource.includes(unsafeSymlink)) {
  writeFileSync(adapterUtils, utilsSource.replace(unsafeSymlink, safeSymlink), "utf8");
  console.log("Applied Windows-compatible Paperclip/Hermes skill junction shim");
} else if (!utilsSource.includes(safeSymlink)) {
  throw new Error("Paperclip skill-link implementation changed; review Windows junction support before shipping.");
}
console.log(`Staged Arabic UI: ${publishedUI}`);
console.log(`Staged Node.js ${process.version} x64: ${path.join(runtime, "node.exe")}`);
