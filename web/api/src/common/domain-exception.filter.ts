import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";

/**
 * Domain `Error` with `.status` / известные русские сообщения раньше уходили в
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

    const err = exception as Error & {
      status?: number;
      result?: unknown;
      results?: unknown;
      toJSON?: () => unknown;
    };
    const msg = err?.message || "Request failed";
    const domainStatus = err?.status;

    if (domainStatus === 403) {
      res.status(403).json({ statusCode: 403, error: msg, message: msg });
      return;
    }
    if (domainStatus === 422) {
      const body =
        typeof err.toJSON === "function"
          ? err.toJSON()
          : {
              error: msg,
              result: err.result,
              results: err.results,
            };
      res.status(422).json({ statusCode: 422, ...(body as object) });
      return;
    }
    if (
      domainStatus === 400 ||
      /неполон|не все|недопустимый|закрыт|нельзя принять|period is closed|период не найден|not found|already closed|комплект/i.test(
        msg
      )
    ) {
      res.status(400).json({ statusCode: 400, error: msg, message: msg });
      return;
    }

    this.logger.error(msg, err?.stack);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      error: msg,
      message: msg,
    });
  }
}
