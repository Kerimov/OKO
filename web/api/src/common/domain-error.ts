/**
 * Shared classification of domain Error → HTTP status.
 * Used by DomainExceptionFilter and rethrowAsHttp so heuristics live in one place.
 */

const CLIENT_ERROR_RE =
  /неполон|не все|недопустимый|закрыт|нельзя принять|period is closed|период не найден|не найден|not found|already closed|комплект/i;

export type DomainErrorLike = {
  message?: string;
  status?: number;
  result?: unknown;
  results?: unknown;
  toJSON?: () => unknown;
};

export function resolveDomainHttpStatus(err: DomainErrorLike): 400 | 403 | 422 | 500 {
  if (err.status === 403) return 403;
  if (err.status === 422) return 422;
  if (err.status === 400) return 400;
  const msg = err.message || "";
  if (CLIENT_ERROR_RE.test(msg)) return 400;
  return 500;
}

export function domainErrorBody(err: DomainErrorLike, status: number): Record<string, unknown> {
  const msg = err.message || "Request failed";
  if (status === 422 && typeof err.toJSON === "function") {
    return { statusCode: 422, ...(err.toJSON() as object) };
  }
  if (status === 422) {
    return {
      statusCode: 422,
      error: msg,
      result: err.result,
      results: err.results,
    };
  }
  return { statusCode: status, error: msg, message: msg };
}
