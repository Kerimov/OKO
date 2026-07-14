import { buildTempAccountRows } from "./aggrSetAccount.ts";
import {
  checkRelationsAccRows,
  fillBalanceRows,
} from "./balanceRelations.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

{
  const acc = [
    { num: "800", B: "1110", C: 100, D: 0 },
    { num: "801", B: "1110", C: 20, D: 5 },
  ];
  const bal = [
    { num: "1110", name: "NA", H: 115 },
    { num: "1100", name: "total", H: 999 },
  ];
  const pairs = buildTempAccountRows(acc);
  assert(pairs.length === 2, "pairs");

  const rel = checkRelationsAccRows({
    accRows: acc,
    balRows: bal,
    uncheckingRows: ["1100"],
    tolerance: 0.5,
  });
  assert(rel.compared === 1, `compared ${rel.compared}`);
  assert(rel.ok && rel.mismatched === 0, "match 115");
  assert(rel.skipped >= 1, "skip 1100");

  const bad = checkRelationsAccRows({
    accRows: acc,
    balRows: [{ num: "1110", H: 50 }],
    uncheckingRows: [],
  });
  assert(!bad.ok && bad.mismatched === 1, "mismatch");
}

{
  const acc = [{ num: "800", B: "1110", C: 40, D: 10 }];
  const bal = [
    { num: "1110", H: "", I: 3 },
    { num: "1120", H: 7, I: 0 },
  ];
  const filled = fillBalanceRows({
    accRows: acc,
    balRows: bal,
    mode: "ifEmpty",
    uncheckingRows: [],
  });
  assert(filled.updated === 1, "updated");
  const r = filled.rows.find((x) => x.num === "1110")!;
  assert(r.H === 30 && r.J === 33, `H/J ${r.H}/${r.J}`);
}

console.log("balanceRelations.selftest: ok");
