import type { CheckResultItem, CheckRunResult } from "../engine/checkEngine";

interface Props {
  result: CheckRunResult | null;
  loading?: boolean;
}

function formatNum(n: number): string {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 4 });
}

function formatCompareHint(item: CheckResultItem): string | null {
  if (!item.failedOp) return null;
  if (item.left === 0 && item.right === 0 && item.failedOp !== "=" && item.failedOp !== "<>") {
    return `(${formatNum(item.left)} ${item.failedOp} ${formatNum(item.right)} — не выполнено при пустых ячейках)`;
  }
  return null;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export function CheckResultsPanel({ result, loading }: Props) {
  if (loading) return <div className="loading">Выполняется проверка…</div>;
  if (!result) return null;

  const failed = result.items.filter((i) => !i.passed && !i.parseError);
  const parseErrors = result.items.filter((i) => i.parseError);

  return (
    <section className="check-results">
      <div className="check-summary">
        <span className="check-stat ok">Пройдено: {result.passed}</span>
        <span className="check-stat fail">Ошибок: {result.failed}</span>
        {result.skipped > 0 && (
          <span className="check-stat skip">Не вычислено: {result.skipped}</span>
        )}
        <span className="check-stat">Всего правил: {result.total}</span>
      </div>

      {failed.length === 0 && parseErrors.length === 0 ? (
        <p className="check-ok">Все проверки пройдены.</p>
      ) : (
        <>
          {failed.length > 0 && (
            <div className="check-table-wrap">
              <h3 className="check-table-title">Ошибки увязок</h3>
              <table className="check-table">
                <thead>
                  <tr>
                    <th>№</th>
                    <th>Не выполнено</th>
                    <th>Левая</th>
                    <th>Правая</th>
                    <th>Сообщение</th>
                  </tr>
                </thead>
                <tbody>
                  {failed.map((item) => {
                    const hint = formatCompareHint(item);
                    return (
                      <tr key={item.number}>
                        <td>{item.number}</td>
                        <td
                          className="expr-cell failed-clause"
                          title={item.failedClause ?? item.expression}
                        >
                          {item.failedClause
                            ? truncate(item.failedClause, 100)
                            : truncate(item.expression, 100)}
                          {hint && (
                            <span className="check-hint">{hint}</span>
                          )}
                        </td>
                        <td>{formatNum(item.left)}</td>
                        <td>{formatNum(item.right)}</td>
                        <td>{item.message ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {parseErrors.length > 0 && (
            <div className="check-table-wrap check-parse-errors">
              <h3 className="check-table-title">Не удалось вычислить</h3>
              <table className="check-table">
                <thead>
                  <tr>
                    <th>№</th>
                    <th>Выражение</th>
                    <th>Причина</th>
                  </tr>
                </thead>
                <tbody>
                  {parseErrors.map((item) => (
                    <tr key={item.number}>
                      <td>{item.number}</td>
                      <td className="expr-cell">{item.expression}</td>
                      <td>{item.error ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
