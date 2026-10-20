"use strict";

const https = require("node:https");

// Only releases of the Arabic fork are compatible with this Arabic Windows app.
// Never offer installation of an official upstream English runtime in its place.
const RELEASE_REPO = "amen78977/paperclip";
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

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
          const release = JSON.parse(buffer);
          // Require an installable artifact, not just an unrelated tag or branch.
          const asset = release.assets?.find((a) => /^Paperclip-Arabic-Setup-\d+\.\d+\.\d+\.exe$/.test(a.name));
          const webpage = new URL(release.html_url);
          if (!asset || webpage.protocol !== "https:" || webpage.hostname !== "github.com" ||
            !webpage.pathname.startsWith(`/${repo}/releases/tag/`) || release.draft || release.prerelease) {
            done(null); return;
          }
          done({ version: String(release.tag_name).replace(/^arabic-v/, ""), url: webpage.href });
        } catch { done(null); }
      });
    });
    req.on("timeout", () => { req.destroy(); done(null); });
    req.on("error", () => done(null));
  });
}
module.exports = { RELEASE_REPO, RETRY_AFTER_MS, isNewerVersion, getLatestRelease };
