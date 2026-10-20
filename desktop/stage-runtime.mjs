/** Bundle the fresh Arabic UI and a local Node.js runtime for a Windows installer.
 * Run from the repository root: node desktop/stage-runtime.mjs
 * Does not edit the user's current Paperclip installation or personal data.
 */
import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
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
console.log(`Staged Arabic UI: ${publishedUI}`);
console.log(`Staged Node.js ${process.version} x64: ${path.join(runtime, "node.exe")}`);
