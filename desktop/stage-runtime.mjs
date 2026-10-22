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
// Paperclip must keep its HMAC master signing secret in the server to mint
// agent-scoped JWTs, but upstream adapters commonly include process.env in
// child opts.env. Strip only server-master secrets at the final spawn boundary
// (local and remote), while preserving the already-scoped PAPERCLIP_API_KEY.
let childUtils = readFileSync(adapterUtils, "utf8");
const childSecretsMarker = "function stripServerOnlyAgentSecrets(env)";
if (!childUtils.includes(childSecretsMarker)) {
  const rawOld = '        const rawMerged = {\n            ...sanitizeInheritedPaperclipEnv(process.env),\n            ...opts.env,\n        };';
  const remoteOld = 'remoteEnv: opts.remoteExecution ? opts.env : null,';
  const childOld = 'const childEnv = { ...mergedEnv, ...target.env };';
  if (![rawOld, remoteOld, childOld, 'export async function runChildProcess('].every((s) => childUtils.includes(s))) {
    throw new Error("Bundled child process environment plumbing changed; review server-only secret handling before shipping.");
  }
  const secretHelper = `function stripServerOnlyAgentSecrets(env) {
    const safe = { ...env };
    const forbidden = new Set(["PAPERCLIP_AGENT_JWT_SECRET", "BETTER_AUTH_SECRET", "PAPERCLIP_TOOL_ACTION_SIGNING_SECRET"]);
    for (const key of Object.keys(safe)) if (forbidden.has(key.toUpperCase())) delete safe[key];
    return safe;
}
`;
  childUtils = childUtils.replace('export async function runChildProcess(', secretHelper + 'export async function runChildProcess(');
  childUtils = childUtils.replace(rawOld, '        const sanitizedRequestedEnv = stripServerOnlyAgentSecrets(opts.env);\n        const rawMerged = stripServerOnlyAgentSecrets({\n            ...sanitizeInheritedPaperclipEnv(process.env),\n            ...sanitizedRequestedEnv,\n        });');
  childUtils = childUtils.replace(remoteOld, 'remoteEnv: opts.remoteExecution ? sanitizedRequestedEnv : null,');
  childUtils = childUtils.replace(childOld, 'const childEnv = stripServerOnlyAgentSecrets({ ...mergedEnv, ...target.env });');
  writeFileSync(adapterUtils, childUtils, "utf8");
}
console.log("PASS master JWT and authentication signing secrets are excluded from all agent children");
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
// Published OpenCode adapter versions override disabled approval bypass with
// `permission: allow`, while the user's private instructions AGENTS.md is
// outside the working tree and is blocked when approvals ARE respected.
// Keep the existing external-directory policy but allow read-only access to
// this one generated per-run instructions folder. Never unlock arbitrary
// external paths or silently re-enable dangerous tool permissions.
const openCodeRuntimeConfig = path.join(runtime, "node_modules", "@paperclipai", "adapter-opencode-local", "dist", "server", "runtime-config.js");
if (!existsSync(openCodeRuntimeConfig)) throw new Error(`Missing bundled OpenCode runtime config: ${openCodeRuntimeConfig}`);
let openCodeSource = readFileSync(openCodeRuntimeConfig, "utf8");
const openCodePrematureApprovalReturn = '    if (!skipPermissions) {\n        return {\n            env: input.env,\n            notes: [],\n            cleanup: async () => { },\n        };\n    }\n';
if (openCodeSource.includes(openCodePrematureApprovalReturn)) {
  // Old npm versions return before creating a runtime config whenever the
  // owner leaves unsafe-tool bypass disabled. That also bypasses the narrow
  // read-only instructions grant below. Apply the safety-preserving path.
  openCodeSource = openCodeSource.replace(openCodePrematureApprovalReturn, "");
}
const openCodeUnsafeNote = '        "Injected runtime OpenCode config with permission=allow for all tools and connections.",';
const openCodeSafeNote = '        skipPermissions ? "Injected runtime OpenCode config with permission=allow for all tools and connections." : "Prepared isolated OpenCode provider configuration.",';
if (openCodeSource.includes(openCodeUnsafeNote)) openCodeSource = openCodeSource.replace(openCodeUnsafeNote, openCodeSafeNote);
const openCodeLegacyConfig = '    const nextConfig = {\n        ...existingConfig,\n        permission: "allow",\n    };';
const openCodeConditionalConfig = '    const nextConfig = {\n        ...existingConfig,\n        ...(skipPermissions ? { permission: "allow" } : {}),\n    };';
const openCodeInstructionsMarker = "Read-only managed AGENTS.md external-directory compatibility";
if (!openCodeSource.includes(openCodeInstructionsMarker)) {
  const hasSkipFlag = openCodeSource.includes('const skipPermissions = asBoolean(input.config.dangerouslySkipPermissions, true);');
  const configToReplace = openCodeSource.includes(openCodeLegacyConfig)
    ? openCodeLegacyConfig
    : openCodeSource.includes(openCodeConditionalConfig) ? openCodeConditionalConfig : null;
  if (!configToReplace) throw new Error("Published OpenCode approval configuration changed; manual review required.");
  const replacement = String.raw`
    ${hasSkipFlag ? "" : "const skipPermissions = asBoolean(input.config.dangerouslySkipPermissions, true);"}
    const nextConfig = {
        ...existingConfig,
        ...(skipPermissions ? { permission: "allow" } : {}),
    };
    // Read-only managed AGENTS.md external-directory compatibility
    if (!skipPermissions && typeof input.config.instructionsFilePath === "string") {
        const instructions = path.resolve(input.config.instructionsFilePath);
        const normalized = instructions.replaceAll("\\", "/");
        if (/\/file-sync\/runs\/[0-9a-f-]{36}\/live\/AGENTS\.md$/i.test(normalized)) {
            const authorizedPath = path.dirname(instructions).replaceAll("\\", "/") + "/*";
            const prior = nextConfig.permission;
            const ruleSet = isPlainObject(prior) ? { ...prior } : typeof prior === "string" ? { "*": prior } : {};
            const existingExternal = ruleSet.external_directory;
            ruleSet.external_directory = {
                ...(isPlainObject(existingExternal) ? existingExternal : { "*": typeof existingExternal === "string" ? existingExternal : "ask" }),
                [authorizedPath]: "allow",
            };
            const existingEdit = ruleSet.edit;
            ruleSet.edit = {
                ...(isPlainObject(existingEdit) ? existingEdit : { "*": typeof existingEdit === "string" ? existingEdit : "ask" }),
                [authorizedPath]: "deny",
            };
            nextConfig.permission = ruleSet;
        }
    }`.trimEnd();
  openCodeSource = openCodeSource.replace(configToReplace, replacement);
}
// Persist permission cleanups even when this is a second/idempotent staging
// pass and the generated instructions-scoping snippet already exists.
writeFileSync(openCodeRuntimeConfig, openCodeSource, "utf8");
console.log("Applied scoped read-only OpenCode AGENTS.md access without bypassing external directory approvals");
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
