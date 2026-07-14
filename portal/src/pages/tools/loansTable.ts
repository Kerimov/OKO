import {
  KZS_GROUP,
  NZS_GROUP,
  type LoansNzsPackage,
} from "../../engine/refsPackage";

export function loansTableRows(pkg: LoansNzsPackage) {
  const rows: Array<{
    group: string;
    groupShort: string;
    kod: string;
    value: string;
    newkod?: string | null;
    creditor?: string | null;
    dateStart?: string | null;
    dateFinish?: string | null;
  }> = [];
  for (const g of [KZS_GROUP, NZS_GROUP] as const) {
    const short = g === KZS_GROUP ? "KZS" : "НЗС";
    for (const it of pkg.groups?.[g] ?? []) {
      rows.push({
        group: g,
        groupShort: short,
        kod: it.kod,
        value: it.value,
        newkod: it.newkod,
        creditor: it.creditor,
        dateStart: it.dateStart,
        dateFinish: it.dateFinish,
      });
    }
  }
  return rows;
}
