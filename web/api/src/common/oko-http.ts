import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { domainErrorBody, resolveDomainHttpStatus, type DomainErrorLike } from "./domain-error.js";

/** Преобразует org-scope / domain ошибки в Nest HTTP exceptions. */
export function rethrowAsHttp(e: unknown, fallback = "Request failed"): never {
  if (e instanceof HttpException) {
    throw e;
  }
  const err = e as DomainErrorLike;
  const msg = err.message || fallback;
  const status = resolveDomainHttpStatus({ ...err, message: msg });

  if (status === 403) {
    throw new ForbiddenException({ error: msg });
  }
  if (status === 422) {
    const body = domainErrorBody({ ...err, message: msg }, 422);
    throw new UnprocessableEntityException(body);
  }
  if (status === 400) {
    throw new BadRequestException({ error: msg, message: msg });
  }
  throw new InternalServerErrorException({
    error: msg,
    message: msg,
  });
}
