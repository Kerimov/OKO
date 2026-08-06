/**
 * Server-side expression test for ChecksEditor (no full client instance download).
 */
import {
  CheckParseError,
  combineCheckExpression,
  evalContextFromInstances,
  evaluateCheckExpression,
  latestInstancePerTemplate,
} from "@oko/engine";
import type { OkoDb } from "./oko-db.js";
import {
  buildEvalSnapshotFromDb,
  loadInstancesBulk,
  loadInstancesForPackage,
} from "./instances.js";
import type { OkoFormInstance } from "./types.js";

export interface TestCheckExpressionInput {
  expression: string;
  expressionAlt?: string | null;
  zid?: number;
  eid?: number;
}

export interface TestCheckExpressionResult {
  ok: boolean;
  left: number | null;
  right: number | null;
  failedClause?: string | null;
  failedOp?: string | null;
  message: string;
  instancesUsed: number;
  mode: "snapshot" | "instances";
}

function contextFromSnapshot(snapshot: {
  rowsByForm: Record<string, Record<string, string | number>[]>;
  cellIndex: Record<string, Record<string, Record<string, number>>>;
}) {
  const instances: OkoFormInstance[] = Object.entries(snapshot.rowsByForm).map(
    ([templateId, rows]) => ({
      instanceId: `snap:${templateId}`,
      templateId,
      templateTitle: templateId,
      displayName: templateId,
      meta: {
        organization: "",
        enterpriseCode: "1@1",
        periodStart: "",
        periodEnd: "",
        unit: "тыс.руб.",
      },
      rows,
      signatures: {},
      createdAt: "",
      updatedAt: "",
    })
  );
  // Prefer full CellK via rows; cellIndex is available for lighter payloads later.
  void snapshot.cellIndex;
  return evalContextFromInstances(instances);
}

async function loadInstancesForTest(
  db: OkoDb,
  input: TestCheckExpressionInput
): Promise<OkoFormInstance[]> {
  if (input.zid != null && input.eid != null) {
    return loadInstancesForPackage(db, input.zid, input.eid);
  }
  if (input.zid != null) {
    return [...(await loadInstancesBulk(db, { zid: input.zid })).values()];
  }
  const headers = (await db
    .prepare(
      `SELECT instance_id, template_id FROM form_instances ORDER BY updated_at DESC`
    )
    .all()) as Array<{ instance_id: string; template_id: string }>;
  const picked = new Map<string, string>();
  for (const h of headers) {
    if (!picked.has(h.template_id)) picked.set(h.template_id, h.instance_id);
  }
  const ids = [...picked.values()];
  if (ids.length === 0) return [];
  return [...(await loadInstancesBulk(db, { instanceIds: ids })).values()];
}

export async function testCheckExpression(
  db: OkoDb,
  input: TestCheckExpressionInput
): Promise<TestCheckExpressionResult> {
  const expr = combineCheckExpression(input.expression ?? "", input.expressionAlt);
  if (!expr.trim()) {
    throw new Error("Пустое выражение");
  }

  let mode: "snapshot" | "instances" = "instances";
  let instancesUsed = 0;
  let ctx: ReturnType<typeof evalContextFromInstances> | undefined;

  try {
    const snapshot = await buildEvalSnapshotFromDb(db, {
      zid: input.zid,
      eid: input.eid,
    });
    const formCount = Object.keys(snapshot.rowsByForm).length;
    if (formCount > 0) {
      ctx = contextFromSnapshot(snapshot);
      instancesUsed = formCount;
      mode = "snapshot";
    }
  } catch {
    ctx = undefined;
  }

  if (!ctx) {
    let instances = await loadInstancesForTest(db, input);
    instances = latestInstancePerTemplate(instances);
    instancesUsed = instances.length;
    ctx = evalContextFromInstances(instances);
    mode = "instances";
  }

  try {
    const result = evaluateCheckExpression(expr, ctx);
    if (result.ok) {
      return {
        ok: true,
        left: result.left,
        right: result.right,
        failedClause: result.failedClause ?? null,
        failedOp: result.failedOp ?? null,
        message: `OK — условие выполнено (лево=${result.left}, право=${result.right})`,
        instancesUsed,
        mode,
      };
    }
    return {
      ok: false,
      left: result.left,
      right: result.right,
      failedClause: result.failedClause ?? null,
      failedOp: result.failedOp ?? null,
      message: `Не выполнено: ${result.failedClause ?? expr} (лево=${result.left}, право=${result.right})`,
      instancesUsed,
      mode,
    };
  } catch (e) {
    if (e instanceof CheckParseError) {
      throw new Error(`Ошибка разбора: ${e.message}`);
    }
    throw e;
  }
}
