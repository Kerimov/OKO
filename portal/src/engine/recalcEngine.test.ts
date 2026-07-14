import { describe, expect, it, vi } from "vitest";
import { prepareRecalcPackage } from "./recalcEngine";
import type { FormSchema, OkoFormInstance } from "../types";

vi.mock("../api", () => ({
  loadRecalcRules: async () => ({ byForm: {} }),
  loadRowFormulas: async () => ({ byForm: {} }),
}));

vi.mock("@oko/engine", async () => {
  const actual = await vi.importActual<typeof import("@oko/engine")>("@oko/engine");
  return {
    ...actual,
    recalcRowsFull: (_schema: FormSchema, rows: OkoFormInstance["rows"]) =>
      rows.map((r) => ({ ...r, A: Number(r.A ?? 0) + 1 })),
  };
});

function stubInst(id: string, templateId: string): OkoFormInstance {
  return {
    instanceId: id,
    templateId,
    templateTitle: templateId,
    displayName: templateId,
    meta: {
      organization: "org",
      enterpriseCode: "1",
      periodStart: "2024-01-01",
      periodEnd: "2024-03-31",
      unit: "тыс.руб.",
    },
    rows: [{ num: "1", A: 0 }],
    signatures: {},
    status: "draft",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

const schema = (id: string): FormSchema =>
  ({
    id,
    title: id,
    category: "test",
    columns: [{ key: "num", label: "№" }, { key: "A", label: "A" }],
    rows: [],
    signatures: [],
    meta: { unit: "тыс.руб." },
  }) as unknown as FormSchema;

describe("prepareRecalcPackage", () => {
  it("returns computed package when all forms succeed", async () => {
    const result = await prepareRecalcPackage(
      [stubInst("1", "N01"), stubInst("2", "N02")],
      async (id) => schema(id)
    );
    expect(result.ok).toBe(true);
    expect(result.computed).toHaveLength(2);
    expect(result.changedCount).toBe(2);
    expect(result.computed[0].rows[0].A).toBe(1);
  });

  it("fails closed — no computed rows when any form errors", async () => {
    const result = await prepareRecalcPackage(
      [stubInst("1", "N01"), stubInst("2", "BAD")],
      async (id) => {
        if (id === "BAD") throw new Error("schema missing");
        return schema(id);
      }
    );
    expect(result.ok).toBe(false);
    expect(result.computed).toEqual([]);
    expect(result.items.some((i) => !i.ok && i.error?.includes("schema missing"))).toBe(
      true
    );
  });
});
