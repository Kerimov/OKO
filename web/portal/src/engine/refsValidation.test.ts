import { describe, expect, it } from "vitest";
import { mergeLoanGroups, KZS_GROUP, NZS_GROUP } from "./refsPackage";
import {
  previewLoansNzsImport,
  validateClassifierItems,
  validateInn,
  validateKpp,
  validateKontrDraftRow,
  validateLoansNzsPackageShape,
  validateOrgType,
} from "./refsValidation";
import { applyRefsOverlay, emptyRefsOverlay } from "./refsOverlay";
import type { RashRefsData } from "./rashRefs";

describe("refsValidation", () => {
  it("rejects empty classifier used by rules", () => {
    const errs = validateClassifierItems([], { ruleCount: 3 });
    expect(errs[0]).toMatch(/пустой справочник/);
  });

  it("rejects duplicate codes", () => {
    const errs = validateClassifierItems([
      { kod: "RU", value: "Россия" },
      { kod: "RU", value: "РФ" },
    ]);
    expect(errs.some((e) => e.includes("Дублирующиеся"))).toBe(true);
  });

  it("validates INN/KPP/orgType", () => {
    expect(validateInn("123")).toBeTruthy();
    expect(validateInn("1234567890")).toBeNull();
    expect(validateKpp("12")).toBeTruthy();
    expect(validateKpp("123456789")).toBeNull();
    expect(validateOrgType("9")).toBeTruthy();
    expect(validateOrgType("1")).toBeNull();
    expect(validateKontrDraftRow({ name: "", inn: "1" }).length).toBeGreaterThan(0);
  });

  it("validates loans package shape and preview", () => {
    expect(() => validateLoansNzsPackageShape({})).toThrow(/groups/);
    const pkg = validateLoansNzsPackageShape({
      groups: {
        [KZS_GROUP]: [{ kod: "1", value: "A", newkod: "n1" }],
        [NZS_GROUP]: [{ kod: "2", value: "B" }],
      },
    });
    expect(pkg.groups[KZS_GROUP]).toHaveLength(1);
    const current = {
      version: "1.0",
      kind: "loans-nzs-refs" as const,
      exportedAt: new Date().toISOString(),
      groups: {
        [KZS_GROUP]: [{ kod: "1", value: "Old", newkod: "n1" }],
        [NZS_GROUP]: [{ kod: "x", value: "Keep" }],
      },
    };
    const preview = previewLoansNzsImport(current, pkg, "replace");
    expect(preview.resultCounts[KZS_GROUP]).toBe(1);
    expect(preview.warnings.length).toBeGreaterThanOrEqual(0);
  });

  it("mergeLoanGroups merges by newkod", () => {
    const merged = mergeLoanGroups(
      {
        [KZS_GROUP]: [{ kod: "1", value: "Old", newkod: "n1" }],
        [NZS_GROUP]: [],
      },
      {
        [KZS_GROUP]: [{ kod: "1", value: "New", newkod: "n1" }, { kod: "2", value: "Extra", newkod: "n2" }],
        [NZS_GROUP]: [],
      },
      "merge"
    );
    expect(merged[KZS_GROUP]).toHaveLength(2);
    expect(merged[KZS_GROUP].find((i) => i.newkod === "n1")?.value).toBe("New");
  });

  it("applyRefsOverlay skips KZS/НЗС groups", () => {
    const base: RashRefsData = {
      version: "1",
      byName: {
        [KZS_GROUP]: [{ kod: "from-loans", value: "Loans" }],
        Страна: [{ kod: "RU", value: "Россия" }],
      },
    };
    const overlay = emptyRefsOverlay();
    overlay.byName[KZS_GROUP] = [{ kod: "hijack", value: "Bad" }];
    overlay.byName.Страна = [{ kod: "RU", value: "РФ" }];
    const next = applyRefsOverlay(base, overlay);
    expect(next.byName[KZS_GROUP]?.[0]?.kod).toBe("from-loans");
    expect(next.byName.Страна?.[0]?.value).toBe("РФ");
  });
});
