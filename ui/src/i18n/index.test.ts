// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storageKey = "paperclip.ui.language";

describe("Arabic desktop language initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.removeItem(storageKey);
  });
  afterEach(() => { window.localStorage.setItem(storageKey, "en"); });

  it("starts a new browser in Arabic with RTL", async () => {
    const { i18n } = await import("./index");
    expect(i18n.language).toBe("ar");
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("respects an explicit English preference", async () => {
    window.localStorage.setItem(storageKey, "en");
    const { i18n } = await import("./index");
    expect(i18n.language).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("ignores an unsupported saved locale", async () => {
    window.localStorage.setItem(storageKey, "unsupported");
    const { i18n } = await import("./index");
    expect(i18n.language).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("updates direction and saves a changed language", async () => {
    const { i18n } = await import("./index");
    await i18n.changeLanguage("en");
    expect(document.documentElement.dir).toBe("ltr");
    expect(window.localStorage.getItem(storageKey)).toBe("en");
    await i18n.changeLanguage("ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(window.localStorage.getItem(storageKey)).toBe("ar");
  });
});
