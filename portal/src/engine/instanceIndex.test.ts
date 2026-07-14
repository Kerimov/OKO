import { describe, expect, it } from "vitest";
import {
  instanceMatchesCheckScope,
  latestInstancePerTemplate,
} from "./instanceIndex";
import type { OkoFormInstance } from "../types";

function stub(
  partial: Partial<OkoFormInstance> & Pick<OkoFormInstance, "instanceId" | "templateId">
): OkoFormInstance {
  return {
    templateTitle: partial.templateId,
    displayName: partial.templateId,
    meta: {
      organization: "org",
      enterpriseCode: "1",
      periodStart: "2024-01-01",
      periodEnd: "2024-03-31",
      unit: "тыс.руб.",
      ...(partial.meta ?? {}),
    },
    rows: [],
    signatures: {},
    status: "draft",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2024-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("check scope helpers", () => {
  it("matches by zid/eid when present", () => {
    const inst = stub({
      instanceId: "a",
      templateId: "N01",
      zid: 10,
      eid: 2,
    });
    expect(instanceMatchesCheckScope(inst, { zid: 10, eid: 2 })).toBe(true);
    expect(instanceMatchesCheckScope(inst, { zid: 11, eid: 2 })).toBe(false);
    expect(instanceMatchesCheckScope(inst, { zid: 10, eid: 3 })).toBe(false);
  });

  it("matches by period dates", () => {
    const inst = stub({
      instanceId: "a",
      templateId: "N01",
      meta: {
        organization: "org",
        enterpriseCode: "1",
        periodStart: "2024-01-01",
        periodEnd: "2024-03-31",
        unit: "тыс.руб.",
      },
    });
    expect(
      instanceMatchesCheckScope(inst, {
        start: "2024-01-01",
        end: "2024-03-31",
      })
    ).toBe(true);
    expect(
      instanceMatchesCheckScope(inst, {
        start: "2023-01-01",
        end: "2024-03-31",
      })
    ).toBe(false);
  });

  it("keeps latest instance per template", () => {
    const a1 = stub({
      instanceId: "1",
      templateId: "N01",
      updatedAt: "2024-01-01T00:00:00.000Z",
    });
    const a2 = stub({
      instanceId: "2",
      templateId: "N01",
      updatedAt: "2024-06-01T00:00:00.000Z",
    });
    const b = stub({
      instanceId: "3",
      templateId: "N02",
      updatedAt: "2024-02-01T00:00:00.000Z",
    });
    const latest = latestInstancePerTemplate([a1, b, a2]);
    expect(latest.map((i) => i.instanceId).sort()).toEqual(["2", "3"]);
  });
});
