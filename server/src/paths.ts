import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (/Users/.../OKO) */
export const ROOT = path.resolve(__dirname, "../..");

export const DATA_DIR = path.join(ROOT, "data");
export const DB_PATH = process.env.OKO_DB_PATH ?? path.join(DATA_DIR, "oko.db");
export const SCHEMA_PATH = path.join(ROOT, "data", "schema.sql");
