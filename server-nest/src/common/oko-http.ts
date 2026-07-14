import {
  BadRequestException,
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
  if (err.status === 400) {
    throw new BadRequestException({ error: err.message || "Bad Request" });
  }
  if (e instanceof HttpException) {
    throw e;
  }
  // Domain validation messages → 400 (not opaque 500)
  const msg = err.message || fallback;
  if (
    /неполон|не все|недопустимый|period is closed|не найден|not found|already closed|закрыт|нельзя принять|комплект/i.test(
      msg
    )
  ) {
    throw new BadRequestException({ error: msg, message: msg });
  }
  throw new InternalServerErrorException({
    error: msg,
    message: msg,
  });
}

