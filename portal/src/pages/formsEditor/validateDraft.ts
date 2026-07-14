import type { FormColumn, FormRowTemplate, FormSchema } from "../../types";

export interface FormValidationIssue {
  level: "error" | "warning";
  message: string;
}

const SYSTEM_KEYS = new Set(["num", "name"]);

export function suggestNextColumnKey(existing: string[]): string {
  const used = new Set(existing.map((k) => k.toUpperCase()));
  const alphabet = "BCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const ch of alphabet) {
    if (!used.has(ch)) return ch;
  }
  for (let i = 2; i < 50; i++) {
    for (const ch of alphabet) {
      const key = `${ch}${i}`;
      if (!used.has(key)) return key;
    }
  }
  return `X${existing.length + 1}`;
}

export function validateFormSchema(schema: FormSchema): FormValidationIssue[] {
  const issues: FormValidationIssue[] = [];
  if (!schema.title.trim()) {
    issues.push({ level: "error", message: "Укажите название формы" });
  }
  if (!schema.category.trim()) {
    issues.push({ level: "error", message: "Укажите раздел (category)" });
  }
  if (!schema.pages || schema.pages < 1) {
    issues.push({ level: "error", message: "Число страниц должно быть ≥ 1" });
  }

  const colKeys = new Set<string>();
  let hasNum = false;
  let hasName = false;
  let fTotalCount = 0;
  for (const col of schema.columns) {
    const key = (col.key ?? "").trim();
    if (!key) {
      issues.push({ level: "error", message: "Есть графа без ключа" });
      continue;
    }
    if (colKeys.has(key.toUpperCase())) {
      issues.push({ level: "error", message: `Дубликат ключа графы «${key}»` });
    }
    colKeys.add(key.toUpperCase());
    if (key === "num") hasNum = true;
    if (key === "name") hasName = true;
    if (!col.label?.trim()) {
      issues.push({ level: "error", message: `Графа ${key}: пустой заголовок` });
    }
    if (col.width != null && col.width <= 0) {
      issues.push({ level: "error", message: `Графа ${key}: ширина должна быть > 0` });
    }
    if (col.fTotal) fTotalCount += 1;
    if (col.formula?.trim() && !col.readonly && !col.fTotal) {
      issues.push({
        level: "warning",
        message: `Графа ${key}: есть формула, но не отмечена как только чтение / итоговая`,
      });
    }
  }
  if (!hasNum) {
    issues.push({ level: "error", message: "Обязательна графа num (номер строки)" });
  }
  if (!hasName) {
    issues.push({ level: "error", message: "Обязательна графа name (наименование)" });
  }
  if (fTotalCount > 3) {
    issues.push({
      level: "warning",
      message: `Отмечено итоговых граф: ${fTotalCount} — проверьте методику`,
    });
  }

  const rowNums = new Set<string>();
  for (const row of schema.rows) {
    if (!row.name?.trim()) {
      issues.push({ level: "error", message: "Есть строка без наименования" });
    }
    const num = String(row.num ?? "").trim();
    if (num) {
      if (rowNums.has(num)) {
        issues.push({ level: "error", message: `Дубликат номера строки «${num}»` });
      }
      rowNums.add(num);
    } else if (row.kind !== "header" && row.kind !== "section") {
      issues.push({
        level: "warning",
        message: `Строка «${row.name}» без номера`,
      });
    }
  }

  if (schema.rows.length === 0) {
    issues.push({ level: "error", message: "В форме нет строк" });
  }
  if (schema.signatures.length === 0) {
    issues.push({ level: "warning", message: "Не заданы подписи" });
  }

  return issues;
}

export function schemaFingerprint(schema: FormSchema): string {
  return JSON.stringify({
    title: schema.title,
    category: schema.category,
    pages: schema.pages,
    pdfFile: schema.pdfFile,
    allowAddRows: !!schema.allowAddRows,
    kontrForm: !!schema.kontrForm,
    archived: !!schema.archived,
    unit: schema.meta.unit,
    signatures: schema.signatures,
    columns: schema.columns,
    rows: schema.rows,
  });
}

export function isSystemColumn(key: string): boolean {
  return SYSTEM_KEYS.has(key);
}

export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function parseExcelPaste(text: string): FormRowTemplate[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.map((line) => {
    const parts = line.split("\t");
    if (parts.length >= 3) {
      return { num: parts[0], code: parts[1], name: parts.slice(2).join(" ") };
    }
    if (parts.length === 2) {
      return { num: parts[0], name: parts[1] };
    }
    return { name: parts[0] || "Строка" };
  });
}

export function defaultColumn(key: string): FormColumn {
  return {
    key,
    label: `Графа ${key}`,
    type: "number",
    width: 100,
    align: "right",
    decimals: 0,
  };
}
