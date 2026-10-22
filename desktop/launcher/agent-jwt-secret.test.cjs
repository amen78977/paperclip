"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { getOrCreateAgentJwtSecret } = require("./agent-jwt-secret.cjs");

test("creates and reuses a strong isolated agent JWT secret across upgrades", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-agent-jwt-test-"));
  try {
    const first = getOrCreateAgentJwtSecret(dir);
    assert.match(first, /^[a-f0-9]{96}$/);
    assert.equal(getOrCreateAgentJwtSecret(dir), first);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("preserves existing credentials and rejects malformed secrets", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-agent-jwt-test-"));
  try {
    const secret = "a".repeat(64);
    assert.equal(getOrCreateAgentJwtSecret(dir, secret), secret);
    assert.equal(getOrCreateAgentJwtSecret(dir, "b".repeat(64)), secret);
    fs.writeFileSync(path.join(dir, "agent-jwt-secret"), "invalid\n");
    assert.throws(() => getOrCreateAgentJwtSecret(dir), /malformed/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
