import "./env.js";
import cors from "cors";
import express from "express";
import {
  auditMiddleware,
} from "./audit.js";
import {
  authMiddleware,
  userWriteGuard,
} from "./auth.js";

type AsyncHandler = (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<void | express.Response>;

function asyncRoute(handler: AsyncHandler): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * Shared Express shell for NestJS: CORS, JSON body, auth, audit, write guard.
 * All REST handlers live in server-nest modules.
 */
export function mountLegacyApi(app: express.Application): void {
  app.use(cors());
  app.use(express.json({ limit: "20mb" }));
  app.use(asyncRoute(authMiddleware));
  app.use(auditMiddleware);
  app.use(userWriteGuard);
}
