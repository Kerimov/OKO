import { describe, expect, it } from "vitest";
import { emptyFormula } from "./formulaSpec";
import { emptyRefSpec } from "./refSpec";
import { stepHasErrors, validateRashDraft } from "./validateDraft";

describe("validateRashDraft steps", () => {
  it("tags basic errors to step 1 and blocks only that step", () => {
    const issues = validateRashDraft({
      isNew: true,
      draft: {
        kod: 0,
        name: "",
        isActive: true,
      },
      formula: emptyFormula(),
      refs: [
        emptyRefSpec("Контрагент"),
        emptyRefSpec(""),
        emptyRefSpec(""),
        emptyRefSpec(""),
      ],
      addsum: [],
      placements: [],
      schemas: {},
    });
    expect(issues.some((i) => i.level === "error" && i.step === 1)).toBe(true);
    expect(stepHasErrors(issues, 1)).toBe(true);
    expect(stepHasErrors(issues, 2)).toBe(false);
  });

  it("requires fixed modal rows for fixed/mixed modes", () => {
    const issues = validateRashDraft({
      isNew: false,
      draft: { kod: 151104, name: "Тест", isActive: true },
      formula: emptyFormula(),
      refs: [
        emptyRefSpec("Контрагент"),
        emptyRefSpec(""),
        emptyRefSpec(""),
        emptyRefSpec(""),
      ],
      addsum: [],
      placements: [{ formId: "N01_1", rowNo: "2000", columnKey: "K" }],
      modalSettings: { rowMode: "fixed" },
      modalRows: [],
      schemas: {},
    });
    expect(stepHasErrors(issues, 3)).toBe(true);
  });
});
