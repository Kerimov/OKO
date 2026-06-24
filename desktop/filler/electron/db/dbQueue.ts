/** Serialize SQLite / package DB work so concurrent IPC calls do not corrupt sql.js. */
let chain = Promise.resolve();

const TASK_TIMEOUT_MS = 45_000;

export function runDbTask<T>(fn: () => T): Promise<T> {
  const run = () =>
    Promise.race([
      Promise.resolve().then(fn),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("Таймаут операции с базой (45 с). Закройте лишние клиенты или проверьте доступ к папке комплекта.")),
          TASK_TIMEOUT_MS
        );
      }),
    ]);
  const result = chain.then(run, run) as Promise<T>;
  chain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
