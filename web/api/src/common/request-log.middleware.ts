import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

type Counters = {
  startedAt: string;
  requests: number;
  errors: number;
  lastRequestAt: string | null;
};

const counters: Counters = {
  startedAt: new Date().toISOString(),
  requests: 0,
  errors: 0,
  lastRequestAt: null,
};

export function getRequestMetrics(): Counters {
  return { ...counters };
}

@Injectable()
export class RequestLogMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const started = Date.now();
    counters.requests += 1;
    counters.lastRequestAt = new Date().toISOString();

    res.on("finish", () => {
      const ms = Date.now() - started;
      if (res.statusCode >= 500) counters.errors += 1;
      const path = req.originalUrl?.split("?")[0] ?? req.url;
      if (!path.startsWith("/api/health")) {
        console.log(`${req.method} ${path} ${res.statusCode} ${ms}ms`);
      }
    });

    next();
  }
}
