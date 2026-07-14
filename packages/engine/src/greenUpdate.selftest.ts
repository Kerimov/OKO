import { aggregateInstances } from "./aggregateEngine.ts";
import { parseCorrespondenceSpec, unionCellMasks } from "./correspondenceSpec.ts";
import type { OkoFormInstance } from "./types.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

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

{
  const a = mk("a", [
    { num: "10", B: 1, C: 10 },
    { num: "170", B: 2, C: 20 },
  ]);
  const b = mk("b", [
    { num: "10", B: 3, C: 30 },
    { num: "170", B: 4, C: 40 },
  ]);
  const existing = [
    { num: "10", B: 99, C: 88, P: 777 },
    { num: "170", B: 0, C: 0, P: 555 },
  ];
  const mask = parseCorrespondenceSpec("B,C-170;");
  const { instance } = aggregateInstances({
    templateId: "N02_2",
    sources: [a, b],
    cellMask: mask,
    preserveRows: existing,
  });
  const r10 = instance.rows.find((r) => r.num === "10")!;
  const r170 = instance.rows.find((r) => r.num === "170")!;
  assert(r10.B === 99 && r10.P === 777, `preserve outside ${JSON.stringify(r10)}`);
  assert(r170.B === 6 && r170.C === 60 && r170.P === 555, `update mask ${JSON.stringify(r170)}`);
}

{
  const u = unionCellMasks(
    parseCorrespondenceSpec("B-10;"),
    parseCorrespondenceSpec("*-110;")
  );
  assert(u.cells.has("B:10") && u.rowsAllColumns.has("110"), "union");
}

console.log("greenUpdate.selftest: ok");
