"use strict";

const https = require("node:https");

// Only releases of the Arabic fork are compatible with this Arabic Windows app.
// Never offer installation of an official upstream English runtime in its place.
const RELEASE_REPO = "amen78977/paperclip";
// Retry hourly: a transient outage must not defer an automatic update by a day.
const RETRY_AFTER_MS = 60 * 60 * 1000;

function numericVersion(raw) {
  const match = String(raw || "").match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : null;
}
function isNewerVersion(candidate, current) {
  const a = numericVersion(candidate);
  const b = numericVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}
function parseArabicRelease(release, repo) {
  if (!release || release.draft || release.prerelease || typeof release.tag_name !== "string") return null;
  const match = release.tag_name.match(/^arabic-v(\d+\.\d+\.\d+)$/);
  if (!match) return null;
  const version = match[1];
  const expectedInstaller = `Paperclip-Arabic-Setup-${version}.exe`;
  const asset = release.assets?.find((item) => item?.name === expectedInstaller && item.state === "uploaded" && Number(item.size) > 1_000_000);
  if (!asset) return null;
  try {
    const url = new URL(release.html_url);
    const repoParts = repo.split("/");
    const expected = `/${repoParts[0]}/${repoParts[1]}/releases/tag/${release.tag_name}`;
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.pathname !== expected || url.username || url.password) return null;
    return { version, url: url.origin + url.pathname };
  } catch { return null; }
}
function getLatestRelease({ repo = RELEASE_REPO, timeoutMs = 6000 } = {}) {
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repo)) return Promise.resolve(null);
  return new Promise((resolve) => {
    let finished = false;
    const done = (value) => { if (!finished) { finished = true; resolve(value); } };
    const req = https.get({
      hostname: "api.github.com",
      path: `/repos/${repo}/releases/latest`,
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Paperclip-Arabic-Desktop" },
      timeout: timeoutMs,
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); done(null); return; }
      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        if (buffer.length + chunk.length > 150_000) { req.destroy(); done(null); }
        else buffer += chunk;
      });
      res.on("end", () => {
        try {
          done(parseArabicRelease(JSON.parse(buffer), repo));
        } catch { done(null); }
      });
    });
    req.on("timeout", () => { req.destroy(); done(null); });
    req.on("error", () => done(null));
  });
}
module.exports = { RELEASE_REPO, RETRY_AFTER_MS, isNewerVersion, parseArabicRelease, getLatestRelease };
