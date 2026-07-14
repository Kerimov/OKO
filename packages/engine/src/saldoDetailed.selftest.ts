import {
  applySaldoDetailedRules,
  ruleMatchesSaldoType,
  type SaldoDetailedRule,
} from "./saldoEngine.js";
import type { OkoFormInstance } from "./types.js";

function ok(name: string) {
  console.log(`ok ${name}`);
}

function fail(name: string, msg: string): never {
  console.error(`FAIL ${name}: ${msg}`);
  process.exit(1);
}

const baseInst = (id: string, rows: OkoFormInstance["rows"]): OkoFormInstance => ({
  instanceId: id,
  templateId: "N01_1",
  templateTitle: "t",
  displayName: id,
  rows,
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
});

const ruleNoFlags: SaldoDetailedRule = {
  sourceRow: 1110,
  sourceColumn: "B",
  targetRow: 1110,
  targetColumn: "B",
  endRow: 1110,
  endColumn: "J",
  saldoT: false,
  saldoS: false,
  saldoG: false,
  targetForm: "N01_1",
};

if (!ruleMatchesSaldoType(ruleNoFlags, "t")) fail("fallback-t", "expected match");
if (!ruleMatchesSaldoType(ruleNoFlags, "s")) fail("fallback-s", "expected match");
if (!ruleMatchesSaldoType(ruleNoFlags, "g")) fail("fallback-g", "expected match");
ok("flag-fallback");

const flagged: SaldoDetailedRule = { ...ruleNoFlags, saldoT: true, saldoS: false, saldoG: false };
if (!ruleMatchesSaldoType(flagged, "t")) fail("flag-t", "expected t");
if (ruleMatchesSaldoType(flagged, "g")) fail("flag-g", "expected no g");
ok("explicit-flags");

const source = baseInst("src", [{ num: "1110", B: 10, J: 77 }]);
const target = baseInst("tgt", [{ num: "1110", B: "", J: "" }]);

const t = applySaldoDetailedRules(source, target, [ruleNoFlags], "t");
if (t.applied !== 1 || t.rows[0].B !== 10) fail("apply-t", `got ${JSON.stringify(t)}`);
ok("apply-t");

const g = applySaldoDetailedRules(source, target, [ruleNoFlags], "g");
if (g.applied !== 1 || g.rows[0].B !== 77) fail("apply-g", `got ${JSON.stringify(g)}`);
ok("apply-g");

console.log("saldoDetailed.selftest: all passed");
