import XLSX from "xlsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const xlsxPath = path.join(root, "reference", "ШаблоныФорм-МинФин.xlsx");
const wb = XLSX.readFile(xlsxPath);
console.log(JSON.stringify({ sheets: wb.SheetNames }, null, 2));
