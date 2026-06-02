import type { FormCatalog, FormSchema } from "./types";

export async function loadCatalog(): Promise<FormCatalog> {
  const res = await fetch("/schemas/catalog.json");
  if (!res.ok) throw new Error("Не удалось загрузить каталог форм");
  return res.json();
}

export async function loadSchema(formId: string): Promise<FormSchema> {
  const res = await fetch(`/schemas/${formId}.json`);
  if (!res.ok) throw new Error(`Форма ${formId} не найдена`);
  return res.json();
}
