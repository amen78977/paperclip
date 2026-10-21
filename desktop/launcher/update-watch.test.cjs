"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isNewerVersion, parseArabicRelease, getLatestRelease } = require("./update-watch.cjs");

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
test("only matching, uploaded Arabic fork installers count as verified releases", () => {
  const release = {
    tag_name: "arabic-v0.1.12",
    html_url: "https://github.com/amen78977/paperclip/releases/tag/arabic-v0.1.12",
    assets: [{ name: "Paperclip-Arabic-Setup-0.1.12.exe", state: "uploaded", size: 490_000_000 }],
  };
  assert.deepEqual(parseArabicRelease(release, "amen78977/paperclip"), {
    version: "0.1.12",
    url: release.html_url,
  });
  assert.equal(parseArabicRelease({ ...release, tag_name: "v0.1.12" }, "amen78977/paperclip"), null);
  assert.equal(parseArabicRelease({ ...release, tag_name: "arabic-v0.1.13" }, "amen78977/paperclip"), null);
  assert.equal(parseArabicRelease({ ...release, prerelease: true }, "amen78977/paperclip"), null);
  assert.equal(parseArabicRelease({ ...release, assets: [{ ...release.assets[0], state: "new" }] }, "amen78977/paperclip"), null);
  assert.equal(parseArabicRelease({ ...release, html_url: "https://github.com.attacker.invalid/amen78977/paperclip/releases/tag/arabic-v0.1.12" }, "amen78977/paperclip"), null);
  assert.equal(parseArabicRelease({ ...release, html_url: release.html_url + "/suspicious" }, "amen78977/paperclip"), null);
});
