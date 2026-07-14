import { describe, expect, it } from "vitest";
import {
  applyRefsOverlay,
  emptyRefsOverlay,
  listRefDirectories,
} from "./refsOverlay";
import type { RashRefsData } from "./rashRefs";

describe("refsOverlay", () => {
  const base: RashRefsData = {
    version: "1",
    byName: {
      Страна: [
        { kod: "RU", value: "Россия" },
        { kod: "KZ", value: "Казахстан" },
      ],
      a_Description: [{ kod: "1", value: "x" }],
    },
  };

  it("applies overlay group replacement", () => {
    const overlay = emptyRefsOverlay();
    overlay.byName.Страна = [{ kod: "RU", value: "РФ" }];
    const next = applyRefsOverlay(base, overlay);
    expect(next.byName.Страна).toEqual([{ kod: "RU", value: "РФ" }]);
    expect(next.byName.a_Description).toEqual(base.byName.a_Description);
  });

  it("lists used directories with Контрагент first", () => {
    const dirs = listRefDirectories(
      [
        {
          kod: 1,
          name: "N01",
          refA1Name: "Контрагент/1,2",
          refA2Name: "Страна/RU",
        } as never,
      ],
      base
    );
    expect(dirs[0]?.kind).toBe("Контрагент");
    const country = dirs.find((d) => d.kind === "Страна");
    expect(country?.ruleCount).toBe(1);
    expect(country?.itemCount).toBe(2);
    expect(dirs.find((d) => d.kind === "a_Description")?.technical).toBe(true);
  });
});
