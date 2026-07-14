import {
  cellGetterToContext,
  evaluateCheckExpression,
  extractCellSvRefs,
  parseArithmetic,
} from "./cellExpression.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

{
  const ast = parseArithmetic('CELL_sv("N02_1","B",40)');
  assert(ast.kind === "cellsv", `expected cellsv got ${ast.kind}`);
}

{
  const refs = extractCellSvRefs('CELL_sv("N02_1","B",40)=Cell("N02_1","B",200)');
  assert(refs.length === 1 && refs[0].row === 40 && refs[0].column === "B", "extract");
}

{
  const ctx = cellGetterToContext((f, c, r) => (r === 40 || r === 200 ? 5 : 0));
  const r = evaluateCheckExpression(
    'CELL_sv("N02_1","B",40)=Cell("N02_1","B",200)',
    ctx
  );
  assert(r.ok && r.left === 5 && r.right === 5, JSON.stringify(r));
}

console.log("cellSv.selftest: ok");
