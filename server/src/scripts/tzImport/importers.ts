/**
 * Deterministic TZ contracts. Header rows are intentionally fixed: App 8=3,
 * App 9=3, App 14=4, App 18=2, registry rows use their shown header rows.
 * A changed header rejects the whole sheet; no sheet-name or column guessing.
 */
import { createRequire } from "node:module";
import { bulkUpsertMinfinMappings, bulkUpsertTransferMaps } from "../../transferMaps.js";
import { upsertCheckRule } from "../../checkRulesRegistry.js";
import { createSvodDefinition, listSvodDefinitions } from "../../svodRegistry.js";
import { createKontrVersion } from "../../kontrVersions.js";
import type { OkoDb } from "../../oko-db.js";
const require = createRequire(import.meta.url);
export type Reject = { sheet: string; row?: number; reason: string };
export type Preview = { accepted: number; rejects: Reject[]; byKind: Record<string, number> };
const text = (v: unknown) => String(v ?? "").trim();
const yes = (v: unknown) => ["да", "+", "true", "1", "x", "х"].includes(text(v).toLowerCase());
function excel() { return require("../../../../portal/node_modules/exceljs") as { Workbook: new () => any }; }
function assertHeaders(ws: any, row: number, expected: string[], rejects: Reject[]) {
  const got = expected.map((_, i) => text(ws.getRow(row).getCell(i + 1).value));
  if (expected.some((x, i) => got[i] !== x)) { rejects.push({ sheet: ws.name, row, reason: `header mismatch: expected ${expected.join(" | ")}, got ${got.join(" | ")}` }); return false; }
  return true;
}
export async function importTz(db: OkoDb, file: string, apply: boolean): Promise<Preview> {
  const wb = new (excel().Workbook)(); await wb.xlsx.readFile(file);
  const out: Preview = { accepted: 0, rejects: [], byKind: {} };
  const add = (kind: string) => { out.accepted++; out.byKind[kind] = (out.byKind[kind] ?? 0) + 1; };
  const sheet = (name: string) => wb.getWorksheet(name);
  const big14 = sheet("14_Логические проверки");
  if (!big14 || !assertHeaders(big14, 4, ["Номер","Код АСКО","Комплект","Тип проверки","Формула","Скрыть","Только для года","Компании исключения","Только для компаний","Только для агрегированных","Только для строк/граф","Кроме строк/граф","Ручное обновление","Формула для расхождения"], out.rejects)) return out;
  const rules: any[] = [];
  for (let r=5;r<=big14.rowCount;r++) { const x=big14.getRow(r); const n=Number(x.getCell(1).value); const formula=text(x.getCell(5).value); if (!n && !formula) continue; if (!n || !formula) { out.rejects.push({sheet:big14.name,row:r,reason:"number and formula required"}); continue; }
    rules.push({ code:text(x.getCell(2).value)||`TZ-14-${n}`, number:n, packageKind:text(x.getCell(3).value)==="БАЛАНС"?"BALANCE":"OKO", type:text(x.getCell(4).value).includes("Расхождение")?"explain":"mandatory", expressionRaw:formula, yearOnly:yes(x.getCell(7).value)?undefined:null, includeGuids:text(x.getCell(9).value).split(/[,\s]+/).filter(Boolean), excludeGuids:text(x.getCell(8).value).split(/[,\s]+/).filter(Boolean), active:!yes(x.getCell(6).value) }); add("rules"); }
  if (apply) for (const r of rules) await upsertCheckRule(db,r);
  const app8 = sheet("8_Перенос периоды");
  if (app8 && assertHeaders(app8,3,["Number","","Ntbl_t","Ftbl_t","Stbl_t","Ntbl_s","Ftbl_s","Stbl_s","Ntbl_g","Ftbl_g","Stbl_g"],out.rejects)) { const items:any[]=[]; for(let r=4;r<=app8.rowCount;r++){const x=app8.getRow(r); if(!text(x.getCell(3).value))continue; for(const [f,c,row,scenario] of [[6,7,8,"same_year"],[9,10,11,"cross_year"]] as const) {if(!text(x.getCell(f).value))continue;items.push({kind:"period_to_period",sourceForm:text(x.getCell(f).value),sourceColumn:text(x.getCell(c).value),sourceRow:text(x.getCell(row).value),targetForm:text(x.getCell(3).value),targetColumn:text(x.getCell(4).value),targetRow:text(x.getCell(5).value),condition:{scenario},sortOrder:r});add("periodTransfers");}} if(apply)await bulkUpsertTransferMaps(db,items); }
  const app9=sheet("9_Перенос_Баланс-ОКО");
  if(app9 && assertHeaders(app9,3,["","","Number","","Ntbl_t","Ftbl_t","Stbl_t","Ftbl_g","Ntbl_s","Ftbl_s","Stbl_s"],out.rejects)){const items:any[]=[];for(let r=4;r<=app9.rowCount;r++){const x=app9.getRow(r);if(!text(x.getCell(5).value)||!text(x.getCell(9).value))continue;items.push({kind:"balance_to_oko",sourceForm:text(x.getCell(9).value),sourceColumn:text(x.getCell(10).value),sourceRow:text(x.getCell(11).value),targetForm:text(x.getCell(5).value),targetColumn:text(x.getCell(6).value),targetRow:text(x.getCell(7).value),sortOrder:r});add("balanceTransfers");}if(apply)await bulkUpsertTransferMaps(db,items);}
  const app18=sheet("18_ЭкспортМинФин");
  if(app18 && assertHeaders(app18,2,["id","ExcelSheetName","ExcelRow","ExcelColumn","FormName","FormColumn","FormRow","znak","InHeader?","period"],out.rejects)){const items:any[]=[];for(let r=3;r<=app18.rowCount;r++){const x=app18.getRow(r);if(!text(x.getCell(2).value))continue;items.push({templateName:"default",sheetName:text(x.getCell(2).value),excelRow:Number(x.getCell(3).value)||null,excelColumn:text(x.getCell(4).value),formId:text(x.getCell(5).value),formColumn:text(x.getCell(6).value),formRow:text(x.getCell(7).value),signFactor:yes(x.getCell(8).value)?-1:1,isHeader:yes(x.getCell(9).value),periodToken:text(x.getCell(10).value)||null});add("minfin");}if(apply)await bulkUpsertMinfinMappings(db,items);}
  return out;
}

export function validateTzHeader(actual: string[], expected: string[]): string | null {
  return actual.length === expected.length && actual.every((x,i)=>x===expected[i]) ? null : "header mismatch";
}

/** Imports the concrete App 19 registry and captures the App 17 navigation contract. */
export async function importTzCompanion(
  db: OkoDb, file: string, apply: boolean, eid = 1
): Promise<Preview> {
  const wb = new (excel().Workbook)(); await wb.xlsx.readFile(file);
  const out: Preview = { accepted: 0, rejects: [], byKind: {} };
  const add = (kind: string) => { out.accepted++; out.byKind[kind] = (out.byKind[kind] ?? 0) + 1; };
  const registry = wb.getWorksheet("Реестр");
  if (!registry || !assertHeaders(registry, 2, ["№","Номер формы","Наименование формы","Тип формы"],out.rejects)) return out;
  // App 19's authoritative membership is the XXX.060 card, with the registry as code/name source.
  const card = wb.getWorksheet("ХХХ.060");
  if (card && text(card.getCell("B10").value) === "Вхождение в свод в отчетном периоде ▼") {
    const code = text(card.getCell("C6").value); const name = text(card.getCell("C7").value);
    if (code && name) {
      const members: any[] = [];
      for (let r=11;r<=card.rowCount;r++) { const row=card.getRow(r); const zid=Number(row.getCell(3).value); if (!Number.isFinite(zid)) continue;
        members.push({zid, included: yes(row.getCell(2).value), headCompany:text(row.getCell(5).value)||null, flagRsbu:yes(row.getCell(6).value), flagMgk:yes(row.getCell(7).value), flagNkdo:yes(row.getCell(8).value)}); }
      add("svods"); if (apply && !(await listSvodDefinitions(db,eid)).some((s)=>s.code===code)) await createSvodDefinition(db,{eid,code,name,createdBy:"tz-import",members});
    } else out.rejects.push({sheet:card.name,reason:"C6 code and C7 name required"});
  }
  for (const form of ["XXX.058","ХХХ.059","ХХХ.060"]) {
    const ws=wb.getWorksheet(form); if (!ws) continue;
    const row = form.includes("058") ? 19 : form.includes("059") ? 17 : 16;
    if (!text(ws.getRow(row).getCell(1).value)) out.rejects.push({sheet:ws.name,row,reason:"detail header missing"});
    else { add("detailContracts"); if (apply) await db.prepare(
      `INSERT INTO svod_detail_mappings (form_id,detail_form,active) VALUES (?, ?, 1) ON CONFLICT DO NOTHING`
    ).run("ANY",form); }
  }
  // App 3.1 is a card layout, therefore its contract is literal label/value coordinates.
  const card066 = wb.getWorksheet("ХХХ.066 ОС");
  if (card066) {
    if (text(card066.getCell("D18").value) !== "GUID" || text(card066.getCell("D22").value) !== "ИНН") {
      out.rejects.push({ sheet: card066.name, reason: "card coordinate contract changed (D18/D22 labels)" });
    } else {
      const guid = text(card066.getCell("J18").value);
      const found = await db.prepare(`SELECT id FROM kontragents WHERE guid = ?`).get(guid) as { id: number } | undefined;
      if (!found) out.rejects.push({ sheet: card066.name, reason: `no existing kontragent for GUID ${guid}` });
      else {
        add("kontrCard");
        if (apply) await createKontrVersion(db, { kontrId: Number(found.id), createdBy: "tz-import", fields: {
          name: text(card066.getCell("Z18").value), fullName: text(card066.getCell("Z14").value),
          inn: text(card066.getCell("J22").value) || null, ogrn: text(card066.getCell("J24").value) || null,
          kpp: text(card066.getCell("J28").value) || null, oldName: text(card066.getCell("Z20").value) || null,
          country: text(card066.getCell("J26").value) || null,
          card: { source: "App3.1", guid, fullName: text(card066.getCell("Z14").value) },
        } as any });
      }
    }
  }
  return out;
}
