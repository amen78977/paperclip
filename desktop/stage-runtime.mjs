/** Bundle the fresh Arabic UI and a local Node.js runtime for a Windows installer.
 * Run from the repository root: node desktop/stage-runtime.mjs
 * Does not edit the user's current Paperclip installation or personal data.
 */
import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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
// The official server has a very deeply nested Microsoft Graph endpoints
// dependency. NSIS silently skips files whose *installed absolute path* is
// longer than the Windows legacy MAX_PATH limit, even when the build/CI smoke
// passes from a shorter checkout path. Hoist this otherwise-unique package to
// runtime/node_modules so that Node's ordinary ancestor resolution still
// finds it without creating >260-character installed paths.
const installedModules = path.join(runtime, "node_modules");
const graphNested = path.join(installedModules, "@paperclipai", "server", "node_modules", "@microsoft", "teams.graph-endpoints");
const graphHoisted = path.join(installedModules, "@microsoft", "teams.graph-endpoints");
if (existsSync(graphNested)) {
  if (existsSync(graphHoisted)) {
    throw new Error("Microsoft Graph endpoints is installed twice; review version compatibility before hoisting.");
  }
  mkdirSync(path.dirname(graphHoisted), { recursive: true });
  renameSync(graphNested, graphHoisted);
  console.log("Hoisted Microsoft Teams Graph endpoints to keep NSIS installed paths safe");
} else if (!existsSync(path.join(graphHoisted, "package.json"))) {
  throw new Error("Cannot find Microsoft Teams Graph endpoints dependency in published runtime.");
}
// Checking the staging path itself is not enough: GitHub's build directory is
// often shorter than a real per-user NSIS installation directory. Prevent a
// release that silently drops files during extraction under the standard path.
const expectedInstalledModules = path.join(
  process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "C:\\Users\\runneradmin", "AppData", "Local"),
  "Programs", "Paperclip Arabic", "resources", "runtime", "node_modules",
);
// Published dependency trees include TypeScript declaration/source-map files
// that are not used by Node.js at runtime. Some exceed the legacy Windows
// installer limit even after hoisting. Prune only these non-runtime artifacts
// when their final install paths would be too long; do not silently omit JS,
// JSON, native executables or any other runtime input.
let removedOptionalFiles = 0;
const pruneLongOptionalFiles = (directory, relative = "") => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const next = path.join(relative, entry.name);
    const absolute = path.join(directory, entry.name);
    const futurePath = path.join(expectedInstalledModules, next);
    if (entry.isDirectory()) pruneLongOptionalFiles(absolute, next);
    else if (entry.isFile() && futurePath.length >= 260 && /(?:\.d\.(?:ts|cts|mts)(?:\.map)?|\.map)$/i.test(entry.name)) {
      unlinkSync(absolute);
      removedOptionalFiles++;
    }
  }
};
pruneLongOptionalFiles(installedModules);
if (removedOptionalFiles > 0) console.log(`Pruned ${removedOptionalFiles} unused long-path declarations/source maps from bundled runtime`);
let longestInstalledPath = "";
const scanInstalledPaths = (directory, relative = "") => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const next = path.join(relative, entry.name);
    const futurePath = path.join(expectedInstalledModules, next);
    if (futurePath.length > longestInstalledPath.length) longestInstalledPath = futurePath;
    if (entry.isDirectory()) scanInstalledPaths(path.join(directory, entry.name), next);
  }
};
scanInstalledPaths(installedModules);
if (longestInstalledPath.length >= 260) {
  throw new Error(`Packaged module will exceed Windows MAX_PATH at default install location (${longestInstalledPath.length} chars): ${longestInstalledPath}`);
}
console.log(`PASS simulated installed Windows path lengths (longest ${longestInstalledPath.length}/259)`);
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
// Fix the published Hermes adapter inside the staged Windows runtime. Passing
// -m auto suppresses the working default from ~/.hermes/config.yaml and can
// hang Hermes 0.22 on Windows. Also require explicit opt-in for --yolo.
const hermesExecute = path.join(runtime, "node_modules", "@paperclipai", "hermes-paperclip-adapter", "dist", "server", "execute.js");
if (!existsSync(hermesExecute)) throw new Error(`Missing bundled Hermes adapter: ${hermesExecute}`);
let hermesSource = readFileSync(hermesExecute, "utf8");
const autoOld = 'if (model) {\n        args.push("-m", model);';
const autoSafe = 'if (model && model !== "auto") {\n        args.push("-m", model);';
if (hermesSource.includes(autoOld)) hermesSource = hermesSource.replace(autoOld, autoSafe);
else if (!hermesSource.includes(autoSafe)) throw new Error("Hermes auto-model logic changed; manually verify before shipping.");
const unsafeYolo = 'args.push("--yolo");';
const safeYolo = 'if (cfgBoolean(config.dangerouslySkipPermissions) === true) args.push("--yolo");';
if (hermesSource.includes(unsafeYolo) && !hermesSource.includes(safeYolo)) {
  hermesSource = hermesSource.replace(unsafeYolo, safeYolo);
} else if (!hermesSource.includes(safeYolo)) {
  throw new Error("Hermes dangerous-command policy changed; manually review before shipping.");
}
writeFileSync(hermesExecute, hermesSource, "utf8");
console.log("Applied Hermes Windows default-model and opt-in unsafe command permission fixes");
// The published server currently keeps every agent's managed AI subscription
// binding even when its harness changes to an incompatible local CLI. This
// blocks recovery to an already-authenticated local CLI after an expired
// isolated subscription (and makes the compatibility check itself fail).
// The checked-in source fixes this by retaining a binding only for the same
// harness and using the explicitly requested runtime config when present.
// Keep the compatibility fix narrow and fail if the vendored server diverges.
const agentsRoute = path.join(runtime, "node_modules", "@paperclipai", "server", "dist", "routes", "agents.js");
if (!existsSync(agentsRoute)) throw new Error(`Missing bundled agent route: ${agentsRoute}`);
let routeSource = readFileSync(agentsRoute, "utf8");
const stickyBindingOld = 'if (existing.runtimeConfig.aiConnection && requestedRuntimeConfig && !requestedRuntimeConfig.aiConnection)\n            requestedRuntimeConfig.aiConnection = existing.runtimeConfig.aiConnection;';
const stickyBindingNew = 'if (existing.runtimeConfig.aiConnection && requestedRuntimeConfig && !requestedRuntimeConfig.aiConnection && existing.adapterType === requestedAdapterType && (existing.adapterType !== "paperclip_runner" || (existing.adapterConfig.provider === (patchData.adapterConfig ?? existing.adapterConfig).provider && existing.adapterConfig.acpxAgent === (patchData.adapterConfig ?? existing.adapterConfig).acpxAgent)))\n            requestedRuntimeConfig.aiConnection = existing.runtimeConfig.aiConnection;';
const initialShim = 'if (existing.runtimeConfig.aiConnection && requestedRuntimeConfig && !requestedRuntimeConfig.aiConnection && agentHarnessType(existing.adapterType, existing.adapterConfig) === agentHarnessType(requestedAdapterType, patchData.adapterConfig ?? existing.adapterConfig))\n            requestedRuntimeConfig.aiConnection = existing.runtimeConfig.aiConnection;';
if (routeSource.includes(stickyBindingOld)) routeSource = routeSource.replace(stickyBindingOld, stickyBindingNew);
else if (routeSource.includes(initialShim)) routeSource = routeSource.replace(initialShim, stickyBindingNew);
else if (!routeSource.includes(stickyBindingNew)) throw new Error("Bundled agent binding retention changed; review before shipping.");
const nullishBindingOld = 'aiRuntimeConnectionBindingSchema.safeParse(requestedRuntimeConfig?.aiConnection ?? existing.runtimeConfig.aiConnection).data';
const explicitBindingNew = 'aiRuntimeConnectionBindingSchema.safeParse(requestedRuntimeConfig ? requestedRuntimeConfig.aiConnection : existing.runtimeConfig.aiConnection).data';
if (routeSource.includes(nullishBindingOld)) routeSource = routeSource.replace(nullishBindingOld, explicitBindingNew);
else if (!routeSource.includes(explicitBindingNew)) throw new Error("Bundled explicit agent binding handling changed; review before shipping.");
writeFileSync(agentsRoute, routeSource, "utf8");
console.log("Applied Windows local-CLI recovery for expired isolated AI account bindings");
console.log(`Staged Arabic UI: ${publishedUI}`);
console.log(`Staged Node.js ${process.version} x64: ${path.join(runtime, "node.exe")}`);
