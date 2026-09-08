import type { OkoDb } from "../oko-db.js";
import { backfillCheckRuleForms } from "../checks.js";
import type { Migration } from "./types.js";

export const checkRuleFormsMigration: Migration = {
  id: "012_check_rule_forms",
  description: "Indexed check_rule_forms for formId filter + backfill from expressions",
  async up(db: OkoDb) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS check_rule_forms (
        rule_number INTEGER NOT NULL REFERENCES check_rules(number) ON DELETE CASCADE,
        form_id TEXT NOT NULL,
        PRIMARY KEY (rule_number, form_id)
      );
      CREATE INDEX IF NOT EXISTS idx_check_rule_forms_form ON check_rule_forms(form_id);
      CREATE INDEX IF NOT EXISTS idx_check_rules_active_period
        ON check_rules(active, period_active, number);
    `);
    await backfillCheckRuleForms(db);
  },
};
