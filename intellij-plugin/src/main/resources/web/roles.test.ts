import { afterEach, describe, expect, it } from "vitest";
import { roleColor, roleLabel, setDarkMode } from "./roles";

describe("fragment head role", () => {
  afterEach(() => {
    setDarkMode(false);
  });

  it("renders the fragment-head label", () => {
    expect(roleLabel("FRAGMENT_HEAD")).toBe("片段主体");
  });

  it("uses the structural subject-family palette in light and dark themes", () => {
    setDarkMode(false);
    expect(roleColor("FRAGMENT_HEAD")).toBe("#0284c7");

    setDarkMode(true);
    expect(roleColor("FRAGMENT_HEAD")).toBe("#38bdf8");
  });
});
