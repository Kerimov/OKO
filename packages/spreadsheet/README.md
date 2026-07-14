# @oko/spreadsheet

Excel-like formula engine and grid adapter for OKO **managed forms**.

## Role

| Layer | Responsibility |
|-------|----------------|
| `@oko/spreadsheet` | A1 formulas, whitelist functions, stable `rowId+columnKey` refs, sheet model |
| `@oko/engine` | Access DSL (`Cell`, checks, FTotal recalc, saldo, aggregation) |
| Portal `SpreadsheetFormTable` | Selection, keyboard, clipboard, formula bar |
| Univer OSS (optional) | Future host behind `VITE_SPREADSHEET_BACKEND=univer` |

## Stage-0 whitelist

`SUM IF AND OR NOT ROUND ABS MIN MAX COUNT COUNTA AVERAGE IFERROR DATE YEAR MONTH DAY`

Forbidden: `WEBSERVICE HYPERLINK INDIRECT OFFSET NOW TODAY RAND …`

## Feature flags

- `VITE_SPREADSHEET_GRID=1` (default on) — Excel-like grid
- `VITE_SPREADSHEET_GRID=0` — legacy `FormTable`
- `VITE_SPREADSHEET_BACKEND=univer` — reserved for Univer preset host

## Selftest

```bash
cd packages/spreadsheet && npm run selftest
```
