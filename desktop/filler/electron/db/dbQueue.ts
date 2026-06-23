/** Serialize SQLite / package DB work so concurrent IPC calls do not corrupt sql.js. */
let chain = Promise.resolve();

export function runDbTask<T>(fn: () => T): Promise<T> {
  const run = () => Promise.resolve().then(fn);
  const result = chain.then(run, run) as Promise<T>;
  chain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
