/** Forms with counterparty (расшифровка) rows — N06/N09. */
export const KONTR_FORM_IDS = new Set([
  "N06_11",
  "N06_12",
  "N06_13",
  "N06_41",
  "N06_111",
  "N06_112",
  "N06_113",
  "N09_1",
  "N09_2",
  "N09_3",
  "N09_31",
  "N09_32",
]);

export function isKontrForm(formId: string): boolean {
  return KONTR_FORM_IDS.has(formId);
}
