/**
 * Golden Access-derived fixtures for check expressions + detailed saldo.
 * Run: npx tsx src/accessGolden.selftest.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cellGetterToContext,
  evaluateCheckExpression,
} from "./cellExpression.js";
import {
  applySaldoDetailedRules,
  type SaldoDetailedRule,
  type SaldoDetailedType,
} from "./saldoEngine.js";
import type { OkoFormInstance, RowData } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "../fixtures/access-golden.json");

interface CheckCase {
  id: string;
  expression: string;
  cells: Record<string, number>;
  expectOk: boolean;
}

interface SaldoCase {
  id: string;
  saldoType: SaldoDetailedType;
  sourceRow: RowData;
  targetRow: RowData;
  rule: SaldoDetailedRule;
  expectTargetB: number;
  expectApplied: number;
}

interface FixtureFile {
  checks: CheckCase[];
  saldo: SaldoCase[];
}

function fail(msg: string): never {
  console.error(`FAIL ${msg}`);
  process.exit(1);
}

const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as FixtureFile;

for (const c of fixture.checks) {
  const map = new Map(Object.entries(c.cells));
  const ctx = cellGetterToContext((form, col, row) => {
    const key = `${form}|${col}|${row}`;
    return map.get(key) ?? 0;
  });
  const result = evaluateCheckExpression(c.expression, ctx);
  if (result.ok !== c.expectOk) {
    fail(
      `check ${c.id}: expected ok=${c.expectOk}, got ${JSON.stringify(result)}`
    );
  }
  console.log(`ok check ${c.id}`);
}

function inst(id: string, row: RowData): OkoFormInstance {
  return {
    instanceId: id,
    templateId: "N01_1",
    templateTitle: "t",
    displayName: id,
    rows: [row],
    updatedAt: "",
    createdAt: "",
    meta: {
      organization: "",
      enterpriseCode: "",
      periodStart: "",
      periodEnd: "",
      unit: "",
    },
    signatures: {},
  };
}

for (const s of fixture.saldo) {
  const out = applySaldoDetailedRules(
    inst("src", s.sourceRow),
    inst("tgt", s.targetRow),
    [s.rule],
    s.saldoType
  );
  if (out.applied !== s.expectApplied) {
    fail(`saldo ${s.id}: applied=${out.applied} expected ${s.expectApplied}`);
  }
  if (out.rows[0]?.B !== s.expectTargetB) {
    fail(
      `saldo ${s.id}: B=${JSON.stringify(out.rows[0]?.B)} expected ${s.expectTargetB}`
    );
  }
  console.log(`ok saldo ${s.id}`);
}

console.log(
  `accessGolden.selftest: ${fixture.checks.length} checks + ${fixture.saldo.length} saldo passed`
);
