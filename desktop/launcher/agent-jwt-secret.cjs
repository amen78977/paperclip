"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// Paperclip's local-agent API tokens are not minted unless this secret exists.
// Keep it stable in the desktop's isolated userData across every app upgrade.
function getOrCreateAgentJwtSecret(userDataDir, initialSecret = "") {
  if (!path.isAbsolute(userDataDir)) throw new Error("Agent JWT directory must be absolute");
  fs.mkdirSync(userDataDir, { recursive: true });
  const file = path.join(userDataDir, "agent-jwt-secret");
  if (!fs.existsSync(file)) {
    const secret = initialSecret.trim() || crypto.randomBytes(48).toString("hex");
    if (secret.length < 32) throw new Error("Local agent JWT secret must be at least 32 characters");
    try { fs.writeFileSync(file, `${secret}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }); }
    catch (error) { if (error?.code !== "EEXIST") throw error; }
  }
  const secret = fs.readFileSync(file, "utf8").trim();
  if (secret.length < 32 || /[\r\n]/.test(secret)) {
    throw new Error("Stored local agent JWT secret malformed; refusing to replace it silently");
  }
  return secret;
}

module.exports = { getOrCreateAgentJwtSecret };
