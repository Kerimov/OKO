import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Repo root .env (OKO/.env) — as documented in DEVELOPMENT.md
dotenv.config({ path: path.join(here, "../../.env") });
// Fallback: server/.env
dotenv.config({ path: path.join(here, "../.env") });
