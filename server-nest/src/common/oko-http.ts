import {
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  UnprocessableEntityException,
} from "@nestjs/common";

/** Преобразует org-scope / domain ошибки в Nest HTTP exceptions. */
export function rethrowAsHttp(e: unknown, fallback = "Request failed"): never {
  const err = e as Error & { status?: number; result?: unknown; toJSON?: () => unknown };
  if (err.status === 403) {
    throw new ForbiddenException({ error: err.message || "Forbidden" });
  }
  if (err.status === 422) {
    const body =
      typeof err.toJSON === "function"
        ? err.toJSON()
        : { error: err.message || "Unprocessable Entity", result: err.result, results: (err as { results?: unknown }).results };
    throw new UnprocessableEntityException(body);
  }
  if (e instanceof HttpException) {
    throw e;
  }
  throw new InternalServerErrorException({
    error: err.message || fallback,
  });
}

