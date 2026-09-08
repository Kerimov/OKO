/**
 * Lightweight perf instrumentation. Enable with OKO_PERF_LOG=1.
 * Logs only labelled operations — no payloads.
 */

function perfEnabled(): boolean {
  const v = process.env.OKO_PERF_LOG?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export type PerfMeta = Record<string, string | number | boolean | null | undefined>;

export function logPerf(operation: string, durationMs: number, meta?: PerfMeta): void {
  if (!perfEnabled()) return;
  const parts: string[] = [`[perf] ${operation} ${durationMs.toFixed(1)}ms`];
  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      if (v === undefined) continue;
      parts.push(`${k}=${v}`);
    }
  }
  console.info(parts.join(" "));
}

/** Measure async work; always returns the same result/error as fn. */
export async function withTiming<T>(
  operation: string,
  fn: () => Promise<T>,
  meta?: PerfMeta | (() => PerfMeta | undefined)
): Promise<T> {
  if (!perfEnabled()) return fn();
  const t0 = performance.now();
  try {
    const result = await fn();
    const durationMs = performance.now() - t0;
    const extra = typeof meta === "function" ? meta() : meta;
    logPerf(operation, durationMs, extra);
    return result;
  } catch (e) {
    const durationMs = performance.now() - t0;
    const extra = typeof meta === "function" ? meta() : meta;
    logPerf(operation, durationMs, { ...extra, error: true });
    throw e;
  }
}
