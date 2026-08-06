import assert from "node:assert/strict";
import {
  checkRequiredSch,
  indexRequiredSch,
  type RequiredSchItem,
} from "./requiredSchCheck.js";
import type { RowData } from "./types.js";

const items: RequiredSchItem[] = [
  { account: 400, rowNumber: 1, row: 400 },
  { account: 400, rowNumber: 2, row: 100 },
  { account: 400, rowNumber: 3, row: 4100 },
  { account: 100, rowNumber: 1, row: 100 },
];

{
  const idx = indexRequiredSch(items);
  assert.equal(idx.get("400")?.size, 3);
  assert.ok(idx.get("400")?.has("100"));
}

{
  // Account 400 has activity but only maps Стр. 400 → missing 100, 4100
  const accRows: RowData[] = [
    { num: "400", name: "Test", B: "400", C: "10", D: "0" },
  ];
  const balRows: RowData[] = [{ num: "400" }, { num: "100" }, { num: "4100" }];
  const result = checkRequiredSch({
    items,
    forms: { N01_01: accRows },
    balanceRows: balRows,
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.row === "100"));
  assert.ok(result.issues.some((i) => i.row === "4100"));
}

{
  // All required rows mapped
  const accRows: RowData[] = [
    {
      num: "400",
      name: "Test",
      B: "400",
      C: "1",
      D: "0",
      E: "100",
      F: "2",
      G: "0",
      H: "4100",
      I: "3",
      J: "0",
    },
  ];
  const balRows: RowData[] = [{ num: "400" }, { num: "100" }, { num: "4100" }];
  const result = checkRequiredSch({
    items,
    forms: { N01_01: accRows },
    balanceRows: balRows,
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
}

{
  // Quiet empty form — no fail
  const result = checkRequiredSch({
    items,
    forms: { N01_01: [{ num: "400", name: "empty" }] },
    balanceRows: [{ num: "100" }],
  });
  assert.equal(result.ok, true);
}

{
  // tblRequiredRow: need at least 3 Стр. for account 100
  const accRows: RowData[] = [
    { num: "100", name: "OS", B: "100", C: "5", D: "0" },
  ];
  const result = checkRequiredSch({
    items: [{ account: 100, rowNumber: 1, row: 100 }],
    forms: { N01_01: accRows },
    balanceRows: [{ num: "100" }],
    requiredRowSlots: [
      { account: "100", slot: 1 },
      { account: "100", slot: 2 },
      { account: "100", slot: 3 },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.message.includes("минимум 3")));
}

console.log("requiredSchCheck.selftest: ok");
