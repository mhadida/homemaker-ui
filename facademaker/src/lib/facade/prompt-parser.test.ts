import { describe, it, expect } from "vitest";
import { parseFacadePromptLocal, mergeFacadeParams } from "./prompt-parser";
import { DEFAULT_FACADE } from "./types";

describe("parseFacadePromptLocal", () => {
  it("parses storeys and bays", () => {
    const u = parseFacadePromptLocal("4 storeys with 5 bays");
    expect(u.storeys).toBe(4);
    expect(u.bays).toBe(5);
  });

  it("clamps storeys and bays to limits", () => {
    const u = parseFacadePromptLocal("12 storeys, 15 bays");
    expect(u.storeys).toBe(6);
    expect(u.bays).toBe(9);
  });

  it("parses width", () => {
    expect(parseFacadePromptLocal("9m wide").width).toBe(9);
  });

  it("recognizes presets by name", () => {
    expect(parseFacadePromptLocal("a georgian terrace").preset).toBe("georgian");
    expect(parseFacadePromptLocal("victorian shopfront").preset).toBe(
      "victorian-shopfront",
    );
    expect(parseFacadePromptLocal("modern minimal").preset).toBe("modern");
  });

  it("parses ground-floor treatment keywords", () => {
    expect(parseFacadePromptLocal("with a shopfront").groundFloor?.treatment).toBe(
      "shopfront",
    );
    expect(parseFacadePromptLocal("garage door").groundFloor?.treatment).toBe(
      "garage",
    );
    expect(parseFacadePromptLocal("with a stoop").groundFloor?.stoop).toBe(true);
  });

  it("parses ornament keywords", () => {
    expect(parseFacadePromptLocal("add a cornice").ornament?.cornice).toBe(true);
    expect(parseFacadePromptLocal("with a parapet").ornament?.parapet).toBe(true);
  });

  it("parses wall and door colors", () => {
    // last-word match: "yellow" → Scandi Yellow, "red" → Barn Red
    expect(parseFacadePromptLocal("yellow walls").wallColor).toBe("#ebcf88");
    expect(parseFacadePromptLocal("barn red walls").wallColor).toBe("#a85748");
    expect(parseFacadePromptLocal("white walls").wallColor).toBe("#f1ece1"); // warm white
    expect(parseFacadePromptLocal("navy door").doorColor).toBe("#2e3a4d");
  });

  it("returns empty updates for unrelated text", () => {
    expect(parseFacadePromptLocal("hello there")).toEqual({});
  });

  it("preset + explicit storeys recomputes storeyHeights on merge", () => {
    const u = parseFacadePromptLocal("5 storey georgian house");
    expect(u.preset).toBe("georgian");
    expect(u.storeys).toBe(5);
    const merged = mergeFacadeParams(DEFAULT_FACADE, u);
    expect(merged.storeyHeights).toHaveLength(5);
  });

  it("parses window glazing styles", () => {
    expect(parseFacadePromptLocal("small panes").windowStyle).toBe("georgian");
    expect(parseFacadePromptLocal("sash windows").windowStyle).toBe("sash");
    expect(parseFacadePromptLocal("plain glass").windowStyle).toBe("none");
  });

  it("explicit glazing overrides the preset's default", () => {
    const u = parseFacadePromptLocal("georgian house with plain glass");
    expect(u.preset).toBe("georgian");
    expect(u.windowStyle).toBe("none");
  });
});

describe("mergeFacadeParams", () => {
  it("deep-merges nested groundFloor and ornament", () => {
    const merged = mergeFacadeParams(DEFAULT_FACADE, {
      groundFloor: { treatment: "shopfront" },
      ornament: { parapet: true },
    });
    expect(merged.groundFloor.treatment).toBe("shopfront");
    expect(merged.groundFloor.doorBay).toBe(DEFAULT_FACADE.groundFloor.doorBay);
    expect(merged.ornament.parapet).toBe(true);
    expect(merged.ornament.cornice).toBe(DEFAULT_FACADE.ornament.cornice);
  });

  it("recomputes storeyHeights when storeys change without explicit heights", () => {
    const merged = mergeFacadeParams(DEFAULT_FACADE, { storeys: 5 });
    expect(merged.storeyHeights).toHaveLength(5);
  });
});

describe("sections keywords", () => {
  it("parses a section count as equal-weight sections", () => {
    const u = parseFacadePromptLocal("3 sections");
    expect(u.sections).toHaveLength(3);
    expect(u.sections!.every((s) => s.offset === 0)).toBe(true);
  });

  it("recessed center emits a symmetric center pattern (default 3)", () => {
    const u = parseFacadePromptLocal("recessed centre");
    expect(u.sections!.map((s) => s.offset < 0)).toEqual([false, true, false]);
    expect(u.sectionsSymmetrical).toBe(true);
  });

  it("projecting center with an explicit count", () => {
    const u = parseFacadePromptLocal("5 sections with a projecting center");
    expect(u.sections).toHaveLength(5);
    expect(u.sections![2].offset).toBeGreaterThan(0);
  });

  it("symmetrical / asymmetrical set the flag", () => {
    expect(parseFacadePromptLocal("symmetrical facade").sectionsSymmetrical).toBe(true);
    expect(parseFacadePromptLocal("asymmetrical facade").sectionsSymmetrical).toBe(false);
  });
});
