import { describe, expect, it } from "vitest";
import { translateInterfaceLabel } from "./interface-labels";

describe("Arabic desktop shell labels", () => {
  it("translates known navigation into idiomatic Arabic", () => {
    expect(translateInterfaceLabel("Dashboard", "ar")).toBe("لوحة التحكم");
    expect(translateInterfaceLabel("Agents", "ar")).toBe("الوكلاء");
    expect(translateInterfaceLabel("New Task", "ar")).toBe("مهمة جديدة");
  });
  it("retains user-entered names and untranslated terms", () => {
    expect(translateInterfaceLabel("Mohammed Co.", "ar")).toBe("Mohammed Co.");
  });
  it("keeps English when selected", () => {
    expect(translateInterfaceLabel("Dashboard", "en")).toBe("Dashboard");
  });
});
