import { describe, it, expect } from "vitest";
import { windowBarColor, WINDOW_BAR_WHITE, WINDOW_BAR_BLACK } from "./windowBar";

describe("windowBarColor", () => {
  it("is only ever white or black", () => {
    for (const hex of ["#ebcf88", "#a85748", "#9fb8c6", "#ece3cf", "#000000", "#ffffff"]) {
      expect([WINDOW_BAR_WHITE, WINDOW_BAR_BLACK]).toContain(windowBarColor(hex));
    }
  });

  it("coloured pastel walls get WHITE frames (incl. scandi yellow)", () => {
    for (const hex of ["#ebcf88", "#e0a566", "#b3c9a4", "#a85748", "#e6a690", "#9fb8c6"]) {
      expect(windowBarColor(hex)).toBe(WINDOW_BAR_WHITE);
    }
  });

  it("white / cream walls get BLACK frames", () => {
    for (const hex of ["#ece3cf", "#f1ece1", "#ffffff"]) {
      expect(windowBarColor(hex)).toBe(WINDOW_BAR_BLACK);
    }
  });
});
