"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { requestJson } = require("./json-request.cjs");
const { getLatestRelease } = require("./update-watch.cjs");

function transport(reply, statusCode = 200) {
  const request = new EventEmitter();
  const response = new EventEmitter();
  response.statusCode = statusCode;
  request.destroy = () => { request.destroyed = true; };
  const client = { request(options, handler) {
    request.options = options;
    request.end = (body) => {
      request.body = body;
      queueMicrotask(() => { handler(response); reply(response, request); });
    };
    return request;
  } };
  return { client, request };
}

test("JSON decodes UTF-8 correctly across chunk boundaries", async () => {
  const data = Buffer.from('{"name":"عربي"}');
  const { client } = transport((response) => {
    for (const byte of data) response.emit("data", Buffer.from([byte]));
    response.emit("end");
    response.emit("close");
  });
  assert.deepEqual(await requestJson({}, { httpClient: client }), { name: "عربي" });
});

for (const event of ["aborted", "error", "close"]) {
  test(`partial response ${event} fails without waiting for the deadline`, async () => {
    const { client, request } = transport((response) => {
      response.emit("data", '{"status":');
      response.emit(event, new Error("interrupted"));
    });
    assert.equal(await requestJson({}, { httpClient: client }), null);
    assert.equal(request.destroyed, true);
  });
}

test("a continuously streaming response still has an absolute deadline", async () => {
  let stream;
  const { client, request } = transport((response) => {
    stream = setInterval(() => response.emit("data", " "), 2);
  });
  try {
    assert.equal(await requestJson({}, { httpClient: client, timeoutMs: 30 }), null);
    assert.equal(request.destroyed, true);
  } finally { clearInterval(stream); }
});

test("non-success status, invalid JSON and oversized UTF-8 fail closed", async () => {
  const replies = [
    [503, "{}", 100],
    [200, "invalid", 100],
    [200, '"عربي"', 8],
  ];
  for (const [status, body, maxBytes] of replies) {
    const { client, request } = transport((response) => {
      response.emit("data", body);
      response.emit("end");
    }, status);
    assert.equal(await requestJson({}, { httpClient: client, maxBytes }), null);
    assert.equal(request.destroyed, true);
  }
});

test("synchronous connection failures and socket timeouts settle safely", async () => {
  assert.equal(await requestJson({}, {
    httpClient: { request() { throw new Error("unavailable"); } },
  }), null);
  const { client, request } = transport((_response, req) => req.emit("timeout"));
  assert.equal(await requestJson({}, { httpClient: client }), null);
  assert.equal(request.destroyed, true);
});

test("a truncated GitHub response does not block the next update check", async () => {
  const { client } = transport((response) => response.emit("aborted"));
  assert.equal(await getLatestRelease({ httpClient: client }), null);
});

test("backup-style POST preserves method, body and required success status", async () => {
  const { client, request } = transport((response) => {
    response.emit("data", '{"ok":true}');
    response.emit("end");
  }, 201);
  assert.deepEqual(await requestJson({ method: "POST", path: "/backup" }, {
    httpClient: client, expectedStatus: 201, body: "{}",
  }), { ok: true });
  assert.equal(request.options.method, "POST");
  assert.equal(request.body, "{}");
});
