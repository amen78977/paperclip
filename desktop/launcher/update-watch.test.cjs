"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isNewerVersion, getLatestRelease } = require("./update-watch.cjs");

test("newer compatible Arabic version", () => {
  assert.equal(isNewerVersion("0.1.12", "0.1.11"), true);
  assert.equal(isNewerVersion("0.2.0", "0.1.45"), true);
  assert.equal(isNewerVersion("0.1.10", "0.1.12"), false);
  assert.equal(isNewerVersion("2.0.0", "2.0.0"), false);
  assert.equal(isNewerVersion("arabic-v0.1.1", "0.1.0"), false);
  assert.equal(isNewerVersion("invalid", "0.1.0"), false);
});
test("repository is validated before any network request", async () => {
  assert.equal(await getLatestRelease({ repo: "../evil" }), null);
});
