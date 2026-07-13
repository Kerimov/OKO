/**
 * DEPRECATED legacy Express entrypoint.
 *
 * REST handlers live in `server-nest/`. This process only mounts the shared
 * Express shell (CORS, JSON, auth, audit, write-guard) via `mountLegacyApi` —
 * there are no API routes here.
 *
 * Use: `cd server-nest && npm run dev` or `./dev.sh` (Nest by default).
 * Escape hatch: `OKO_API_RUNTIME=express ./dev.sh`
 */
import "./env.js";
import express from "express";
import { bootstrapDatabase } from "./db.js";
import { isPostgresMode } from "./oko-db.js";
import { mountLegacyApi } from "./legacy-routes.js";

const PORT = Number(process.env.PORT ?? 3001);

console.warn(
  "[deprecated] server/src/index.ts — Express entrypoint has no REST routes. Prefer server-nest (OKO_API_RUNTIME=nest)."
);

const app = express();
mountLegacyApi(app);

bootstrapDatabase()
  .then(() => {
    app.listen(PORT, () => {
      const dialect = isPostgresMode() ? "postgresql" : "sqlite";
      console.log(`OKO API (Express shell only) http://localhost:${PORT} (${dialect})`);
      console.log("REST: use NestJS — cd server-nest && npm run dev");
    });
  })
  .catch((err) => {
    console.error("Failed to start OKO API:", err);
    process.exit(1);
  });
