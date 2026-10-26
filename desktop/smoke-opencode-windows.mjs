/** Exercise the staged adapter with real Windows junctions and isolated data. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareOpenCodeRuntimeConfig } from "./runtime/node_modules/@paperclipai/adapter-opencode-local/dist/server/runtime-config.js";

if (process.platform !== "win32") throw new Error("This smoke targets native Windows.");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-packaged-opencode-"));
let prepared;
try {
  const config = path.join(root, "config");
  const plugins = path.join(root, "plugins");
  await fs.mkdir(path.join(config, "opencode"), { recursive: true });
  await fs.mkdir(plugins);
  await fs.writeFile(path.join(plugins, "operator.js"), "export default {};");
  const permission = { external_directory: "ask", bash: "ask" };
  await fs.writeFile(path.join(config, "opencode", "opencode.json"), JSON.stringify({ permission }));
  await fs.symlink(plugins, path.join(config, "opencode", "plugins"), "junction");
  prepared = await prepareOpenCodeRuntimeConfig({
    env: { XDG_CONFIG_HOME: config }, config: { dangerouslySkipPermissions: false },
  });
  const dest = path.join(prepared.env.XDG_CONFIG_HOME, "opencode");
  assert((await fs.lstat(path.join(dest, "plugins"))).isDirectory());
  assert((await fs.lstat(path.join(config, "opencode", "plugins"))).isSymbolicLink());
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dest, "opencode.json"), "utf8")).permission, permission);
  await fs.writeFile(path.join(dest, "plugins", "operator.js"), "isolated");
  assert.equal(await fs.readFile(path.join(plugins, "operator.js"), "utf8"), "export default {};");
  console.log("PASS packaged OpenCode Windows junction isolation and approvals");
} finally {
  await prepared?.cleanup();
  await fs.rm(root, { recursive: true, force: true });
}
