import { describe, expect, it } from "vitest";
import { sanitizeInheritedPaperclipEnv, stripServerOnlyAgentSecrets } from "./server-utils.js";

describe("sanitizeInheritedPaperclipEnv", () => {
  it("drops the host-only Paperclip CLI command pointer", () => {
    expect(sanitizeInheritedPaperclipEnv({
      PAPERCLIPAI_CMD: "node /missing/paperclipai/dist/index.js",
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    })).toEqual({
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    });
  });
});

describe("server-only agent signing secrets", () => {
  it("never exposes master JWT/auth/signing secrets but preserves minted per-run API token", () => {
    expect(stripServerOnlyAgentSecrets({
      PAPERCLIP_AGENT_JWT_SECRET: "master-jwt-must-not-leak",
      Better_Auth_Secret: "master-auth-must-not-leak",
      PAPERCLIP_TOOL_ACTION_SIGNING_SECRET: "master-action-must-not-leak",
      PAPERCLIP_API_KEY: "minted-scoped-agent-token",
      PATH: "/usr/bin",
    })).toEqual({ PAPERCLIP_API_KEY: "minted-scoped-agent-token", PATH: "/usr/bin" });
  });
});
