import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { domainErrorBody, resolveDomainHttpStatus, type DomainErrorLike } from "./domain-error.js";

/**
 * Domain `Error` with `.status` / известные сообщения раньше уходили в
 * Nest ExceptionsHandler как opaque 500 «Internal Server Error».
 * Этот фильтр отдаёт 400/403/422 с текстом причины.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res.status(status).json(
        typeof body === "string"
          ? { statusCode: status, message: body, error: body }
          : body
      );
      return;
    }

    const err = exception as DomainErrorLike;
    const msg = err?.message || "Request failed";
    const status = resolveDomainHttpStatus(err);

    if (status === 500) {
      this.logger.error(msg, (exception as Error)?.stack);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(domainErrorBody(err, 500));
      return;
    }

    res.status(status).json(domainErrorBody(err, status));
  }
}
