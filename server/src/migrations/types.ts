import type { OkoDb } from "../oko-db.js";

export interface Migration {
  id: string;
  description: string;
  up: (db: OkoDb) => Promise<void>;
}
