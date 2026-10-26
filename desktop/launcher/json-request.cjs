"use strict";

// Launcher requests must settle even when a peer truncates a response or keeps
// sending bytes. A socket inactivity timeout alone is not a request deadline.
const http = require("node:http");

function requestJson(options, { httpClient = http, timeoutMs = 8000,
  maxBytes = 3_000_000, expectedStatus = 200, body } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let request;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(value);
    };
    const fail = () => { finish(null); request?.destroy(); };
    const deadline = setTimeout(fail, timeoutMs);
    try {
      request = httpClient.request({ ...options, timeout: timeoutMs }, (response) => {
        response.once("error", fail);
        response.once("aborted", fail);
        response.once("close", () => { if (!settled) fail(); });
        if (response.statusCode !== expectedStatus) {
          fail();
          return;
        }
        const chunks = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          if (settled) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += buffer.length;
          if (bytes > maxBytes) { fail(); return; }
          chunks.push(buffer);
        });
        response.once("end", () => {
          if (settled) return;
          try { finish(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
          catch { fail(); }
        });
      });
      request.once("timeout", fail);
      request.once("error", fail);
      request.end(body);
    } catch { fail(); }
  });
}

module.exports = { requestJson };
