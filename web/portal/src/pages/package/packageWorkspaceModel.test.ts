import { describe, expect, it } from "vitest";
import {
  campaignKeyOf,
  quarterYearFromCampaign,
  quarterYearFromPeriodName,
  rowKey,
} from "./packageWorkspaceModel";

describe("packageWorkspaceModel", () => {
  it("builds stable campaign and row keys", () => {
    expect(campaignKeyOf({ periodName: "1 квартал 2026", packageKind: "OKO" })).toBe(
      "1 квартал 2026||OKO"
    );
    expect(rowKey({ zid: 12, eid: 3 })).toBe("12:3");
  });

  it("parses quarter/year from period name", () => {
    expect(quarterYearFromPeriodName("2 квартал 2025")).toEqual({ quarter: 2, year: 2025 });
    expect(quarterYearFromPeriodName("bad")).toBeNull();
  });

  it("falls back to periodStart when name is non-standard", () => {
    expect(
      quarterYearFromCampaign({
        periodName: "Период А",
        periodStart: "2024-07-01",
      })
    ).toEqual({ quarter: 3, year: 2024 });
  });
});
