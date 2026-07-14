import {
  buildTempAccountRows,
  validateAggrAccountPackage,
  validateAggrAccounts,
} from "./aggrSetAccount.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

{
  const pairs = buildTempAccountRows([
    { num: "800", name: "acc", B: "1110", C: 10, D: 2, E: "9999", F: 1, G: 0 },
    { num: "801", name: "empty" },
  ]);
  assert(pairs.length === 2, "pairs");
  assert(pairs[0].account === "800" && pairs[0].row === "1110" && pairs[0].balance === 8, "p0");
  assert(pairs[1].row === "9999", "p1");
}

{
  const report = validateAggrAccounts({
    formId: "N01_01",
    accRows: [
      { num: "800", B: "1110", C: 5, D: 0 },
      { num: "801", B: "4040", C: 1, D: 0 },
      { name: "no num", B: "1110", C: 2, D: 0 },
      { num: "802", C: 3, D: 0 },
    ],
    balRows: [{ num: "1110" }, { num: "1120" }],
  });
  assert(report.tempRows === 2, "temp");
  assert(report.missingRowMappings.some((m) => m.row === "4040"), "missing");
  assert(report.blankAccountCells.length >= 1, "blank");
  assert(report.orphanAmounts.some((o) => o.account === "802"), "orphan");
}

{
  const r = validateAggrAccountPackage({ forms: [], balRows: null });
  assert(!r.ok && r.message?.includes("Не заведены"), "msg");
}

console.log("aggrSetAccount.selftest: ok");
