# ПСД: приёмочный статус (черновик)

> **DRAFT.** Не считать функционал production-готовым, пока не зелёные integration/E2E
> и не загружены/валидированы приложения ТЗ. XML/SAP/ЭЦП остаются вне scope.

## Восстановленный контур (этапы 0–5)

| Область | Статус |
|---------|--------|
| Express `userWriteGuard` vs Nest PSD RBAC | Исправлено: PSD-маршруты делегируются Nest |
| Org scope / IDOR на БП и cell comments | Исправлено |
| Domain BP/period locks в `patchInstanceCells` / transfers | Исправлено |
| БП — единственный workflow; legacy status — derived | Исправлено |
| Package context / `collection_unit_zid` | Миграция 007 |
| Appendix 12 notation + package check run | `checkNotation12` + `packageCheckRun` + mig 008 |
| НСИ карточка 3.1 / периметр / non-destructive import | mig 009 + `/perimeter` |
| Deterministic TZ importers + transfer rollback + svod calc | mig 010 + `tzImport/` |
| Safe support reports catalog | whitelist presets (без произвольного SQL) |
| UX: BP lock banner на FormPage, PSD nav/role badge | Исправлено |
| XML DO / SAP / ЭЦП | **Не входит** — stubs only |

## Bootstrap

1. Обязательно прогнать numbered migrations (`005`–`010`) при старте API.
2. Назначить PSD-роли в `/admin/users`.
3. Импорт приложений ТЗ:
   ```bash
   cd server
   DATABASE_URL=... npx tsx src/scripts/importTzAppendices.ts --preview
   DATABASE_URL=... npx tsx src/scripts/importTzAppendices.ts --apply
   ```
4. Package checks: `POST /api/psd-checks/package-run` `{ zid, eid, packageKind }`.

## Acceptance gate (ещё не закрыт)

- [ ] Integration tests: PSD role matrix, org isolation, BP acceptance, package check run, completed lock, TZ import counts, svod/drill-down, MinFin filled workbook
- [ ] Portal E2E real API journey
- [ ] TZ volumes validated (~11 819 rules, ~4 137+1 820 transfers, ~5 141 MinFin)

До закрытия gate — rollout в production **запрещён**.
