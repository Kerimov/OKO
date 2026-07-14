/**
 * Lightweight smoke tests for FormCorrespondence mask parsing / masked aggregate.
 * Run: node --experimental-strip-types packages/engine/src/correspondenceSpec.selftest.ts
 */
import {
  cellMaskIsEmpty,
  cellMatchesMask,
  columnsFromCorrespondenceSpec,
  parseCorrespondenceSpec,
  parseReorgUpdateFlag,
} from "./correspondenceSpec.ts";
import { aggregateInstances } from "./aggregateEngine.ts";
import type { OkoFormInstance } from "./types.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

{
  const m = parseCorrespondenceSpec("B,C,G-*;");
  assert(!m.all && m.columnsAllRows.has("B") && m.columnsAllRows.has("G"), "cols-*");
  assert(cellMatchesMask(m, "B", "10") && !cellMatchesMask(m, "H", "10"), "cols-* match");
}

{
  const m = parseCorrespondenceSpec("B,C,D-10,30;");
  assert(m.cells.has("B:10") && m.cells.has("D:30") && !m.cells.has("B:20"), "cols-nums");
  assert(columnsFromCorrespondenceSpec("B,C,D-10,30;").join(",") === "B,C,D", "columnsFrom");
}

{
  const m = parseCorrespondenceSpec("*-110;*-120;");
  assert(m.rowsAllColumns.has("110") && m.rowsAllColumns.has("120"), "*-nums");
}

{
  const m = parseCorrespondenceSpec("*-*;");
  assert(m.all, "*-*");
}

{
  const m = parseCorrespondenceSpec("B,C,D,E,F,G,H,I,J,K,-120;");
  assert(m.cells.has("B:120") && m.cells.has("K:120"), "empty token before dash");
}

{
  assert(parseReorgUpdateFlag("*") === true, "reorg *");
  assert(parseReorgUpdateFlag("* здесь нет обновления по строкам!") === false, "reorg no");
  assert(parseReorgUpdateFlag(null) === false, "reorg null");
}

{
  const mk = (id: string, rows: OkoFormInstance["rows"]): OkoFormInstance => ({
    instanceId: id,
    templateId: "N02_2",
    templateTitle: "t",
    displayName: id,
    meta: {},
    rows,
    signatures: {},
    status: "draft",
    createdAt: "",
    updatedAt: "",
  });
  const a = mk("a", [
    { num: "10", name: "x", B: 1, C: 10, P: 100 },
    { num: "170", name: "g", B: 2, C: 20, P: 200 },
  ]);
  const b = mk("b", [
    { num: "10", name: "x", B: 3, C: 30, P: 300 },
    { num: "170", name: "g", B: 4, C: 40, P: 400 },
  ]);
  const mask = parseCorrespondenceSpec("B,C-170;");
  const { instance } = aggregateInstances({
    templateId: "N02_2",
    sources: [a, b],
    cellMask: mask,
  });
  const r10 = instance.rows.find((r) => r.num === "10")!;
  const r170 = instance.rows.find((r) => r.num === "170")!;
  assert(r10.B === "" && r10.C === "" && r10.P === "", "outside mask blank");
  assert(r170.B === 6 && r170.C === 60 && r170.P === "", "masked sum; P unmasked blank");
  assert(!cellMaskIsEmpty(mask), "mask non-empty");
}

console.log("correspondenceSpec.selftest: ok");
