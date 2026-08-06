# Промты Для Дальнейшей Оптимизации Производительности

Ниже собраны готовые промты, которые можно по одному отдавать модели на реализацию.

## Общая Шапка

```text
Работаем в репозитории /Users/vadim/OKO. Не откатывай чужие изменения. Сначала прочитай связанные файлы и существующие паттерны, затем внеси минимальные точечные правки. После изменений запусти проверки: portal tsc/build/tests, server typecheck/selftest, server-nest build, насколько применимо. В финале дай список изменённых файлов, что ускорено, какие проверки прошли и что осталось проверить руками.
```

## 1. Замеры Реальных Timings

```text
Добавь instrumentation для измерения производительности ключевых операций портала.

Нужно реализовать:
1. В backend добавить лёгкий helper для измерения durationMs, например withTiming(label, fn), без внешних зависимостей.
2. Обернуть операции:
   - POST /api/packages/create → createReportPackage
   - GET /api/instances?full=1
   - previewPackageAggregation
   - runPackageAggregation
   - runPackageChecks
3. Логировать: operation, zid/eid, counts (forms/cells/instances), durationMs.
4. Логи должны быть информативны, но не шуметь на каждом мелком запросе.
5. Не логировать чувствительные payloads.
6. Добавить опциональный env-флаг, например OKO_PERF_LOG=1, чтобы можно было включать/выключать perf logs.

Проверить:
- TypeScript server/server-nest.
- Вызов endpoints не меняет response shape.
```

## 2. Проверка Bulk Insert На Комплектах

```text
Проверь и укрепи bulk insert в server/src/instances.ts.

Нужно сделать:
1. Прочитать saveInstanceCells, rowsFromCells, loadInstanceFromDb/loadInstancesBulk.
2. Добавить unit/selftest для сохранения и загрузки instance с:
   - обычными строками с num/name;
   - пустой строкой с num;
   - строкой без num, где нужен _row_index;
   - большим количеством rows/cells больше одного chunk.
3. Проверить, что rows после load совпадают с rows до save по значимым полям.
4. Проверить, что repeated save не дублирует cells.
5. Если найдёшь проблему в bulk insert, исправь её без изменения публичного контракта.

Проверить:
- server typecheck.
- новый selftest.
- существующий server test:selftest.
```

## 3. Тесты Для `saveInstanceCells`

```text
Добавь отдельный regression selftest для saveInstanceCells.

Нужно реализовать:
1. Найти существующий стиль selftest в server/src/*.selftest.ts.
2. Создать server/src/instancesCells.selftest.ts или расширить подходящий existing selftest.
3. Поднять in-memory/mock OkoDb, если в проекте есть такой паттерн, либо использовать существующий тестовый DB helper.
4. Проверить:
   - сохранение header в form_instances;
   - сохранение cells batch;
   - восстановление rowsFromCells;
   - placeholder num для пустой строки;
   - _row_index для строк без num;
   - delete+replace при повторном save.
5. Добавить запуск в npm script test:selftest.

Проверить:
- npm run typecheck в server.
- npm run test:selftest.
```

## 4. Оптимизация `upsertInstance` / `upsertInstancesBatch`

```text
Оптимизируй массовое сохранение instances, чтобы не делать лишний full load/save.

Нужно сделать:
1. Прочитать server/src/instances.ts: upsertInstance, upsertInstancesBatch, patchInstanceCells, assertInstanceWritable.
2. Найти, где portal вызывает saveInstancesAtomic / /api/instances/batch.
3. Для batch сохранить текущую проверку прав и блокировок, но убрать N+1 loadInstance там, где можно получить headers одним запросом.
4. Добавить helper loadInstanceHeadersByIds или assertInstancesWritableBatch.
5. Если instance новый — сохранять как сейчас.
6. Если instance существующий и меняются только rows/cells — рассмотреть использование bulk cell replace без legacy portal_instances dual-write, если это безопасно.
7. Не ломать submitted/period/BP protection.

Проверить:
- server/server-nest typecheck.
- сценарии сохранения одной формы и batch recalc.
```

## 5. Bulk Insert Для `saveRashEntries`

```text
Ускорь сохранение расшифровок rash.

Нужно сделать:
1. Прочитать server/src/rash-data.ts: saveRashEntries, loadRashEntries.
2. Заменить поштучный insert entries на batch insert чанками.
3. Сохранить текущую транзакцию, delete старых entries и update revision.
4. Соблюсти порядок line_no/id при load.
5. Добавить/обновить selftest, если есть тесты rash; иначе добавить минимальный regression для save/load нескольких entries.

Проверить:
- server typecheck.
- server selftests.
- Ручной сценарий: открыть форму с расшифровками, сохранить, снова открыть.
```

## 6. Backend Cache Для Schemas

```text
Добавь безопасный in-memory cache для схем форм на backend.

Нужно сделать:
1. Прочитать server/src/forms.ts: loadFormSchema/loadFormSchemas/save/create/update формы.
2. Добавить module-level cache Map<formId, FormSchemaDto> с TTL или версионным ключом schema_version.
3. loadFormSchema/loadFormSchemas должны сначала использовать cache, но не возвращать stale после изменения формы.
4. В местах изменения схемы формы вызвать clearFormSchemaCache(formId?) или обновить cache.
5. Не кэшировать несуществующие формы навсегда.
6. Добавить тест/самопроверку: load → update schema → load возвращает новую версию.

Проверить:
- server typecheck.
- сценарии FormsEditor save/archive/import.
```

## 7. Оптимизация `recalcAggregatedRows`

```text
Оптимизируй пересчёт строк при агрегации.

Нужно сделать:
1. Прочитать server/src/aggregation.ts: runPackageAggregation, recalcAggregatedRows.
2. Сейчас recalcAggregatedRows может грузить schema/rules на каждую форму.
3. В runPackageAggregation до цикла предзагрузить:
   - schemas для всех formIds через loadFormSchemas;
   - recalc-rules.json и row-formulas.json один раз;
   - подготовить Map<formId, rules>.
4. Передать подготовленный контекст в recalcAggregatedRows или заменить функцию на recalcAggregatedRowsWithContext.
5. Сохранить поведение, если схемы/правила отсутствуют.
6. Не менять математический результат пересчёта.

Проверить:
- server typecheck/selftests.
- preview/run aggregation на тестовых данных, если возможно.
```

## 8. Дробление Тяжёлых Frontend Chunks

```text
Уменьши размер initial bundle портала.

Нужно сделать:
1. Запустить npm run build в portal и посмотреть крупные chunks.
2. Разобрать, почему в initial index попадают тяжёлые зависимости.
3. Вынести в dynamic imports:
   - UniverFormHost / @univerjs/*
   - PDF export / pdfmake
   - Excel export/import / exceljs, если попадает в main
4. При необходимости настроить vite build.rollupOptions.output.manualChunks.
5. Не ломать lazy routes в App.tsx.
6. После build сравнить список chunks и убедиться, что main index стал меньше или тяжёлые libs выделены.

Проверить:
- npm run build в portal.
- Ручные сценарии: открыть форму, экспорт PDF, Excel, Univer-mode если включён.
```

## 9. Background Jobs Для Долгих Операций

```text
Спроектируй и реализуй минимальный job queue для долгих операций.

Нужно сделать:
1. Найти долгие операции: createReportPackage, runPackageAggregation, runPackageChecks, batch recalc.
2. Добавить таблицу jobs или использовать существующую, если есть.
3. Endpoint start возвращает jobId сразу.
4. Endpoint status возвращает: status, progress, message, result/error.
5. Worker может быть in-process, без внешнего Redis, с понятным ограничением concurrency.
6. Сначала подключить одну операцию: createReportPackage или runPackageAggregation.
7. UI должен показывать прогресс/обновлять статус, не ждать долгий HTTP.

Проверить:
- TypeScript.
- Ошибка job не теряет stack/message.
- Повторное открытие страницы может получить статус job по id.
```

## 10. Optimistic UI После Создания Комплекта

```text
Улучши perceived latency после createReportPackage.

Нужно сделать:
1. Прочитать portal/src/pages/PackagePage.tsx: handleCreatePackage, refreshAll, loadList/loadDetail.
2. После успешного createReportPackage локально обновить выбранный row/detail:
   - filled += result.created;
   - total = result.total;
   - draft += result.created;
   - percent пересчитать.
3. Переключить tab=forms сразу.
4. Полный refreshAll запускать фоном после локального обновления.
5. При ошибке фонового refresh показать мягкое сообщение, не откатывая успешное создание.
6. Не ломать роли/readonly/closed period.

Проверить:
- Создание полного комплекта.
- Дозаведение недостающих форм.
- Обновление списка и карточки.
```

## 11. Server-side Test Rule Для ChecksEditor

```text
Перенеси тест увязки в редакторе на server-side endpoint.

Нужно сделать:
1. Прочитать portal/src/pages/ChecksEditorPage.tsx handleTest.
2. Сейчас клиент грузит instances и считает expression локально.
3. Добавить backend endpoint: POST /api/checks/test-expression.
4. Input: expression, expressionAlt, optional zid/eid/template scope.
5. Backend должен собрать eval context через bulk instances/eval snapshot и вернуть result.
6. Frontend handleTest должен использовать endpoint в backend mode и оставить local fallback.
7. Не менять сохранение самих правил.

Проверить:
- Тест правила в ChecksEditor.
- Ошибки парсинга возвращаются понятно.
- Нет загрузки всех instances на клиент при backend mode.
```

## 12. Индексы / Нормализация `check_rules`

```text
Оптимизируй поиск правил увязок по форме.

Нужно сделать:
1. Найти listCheckRules/fetchChecksPage и фильтр formId.
2. Если поиск идёт через LIKE по expression, добавить нормализованную таблицу или колонку referenced_forms.
3. При create/update правила парсить Cell("FORM",...) и обновлять references.
4. Добавить миграцию/backfill для существующих check_rules.
5. Фильтр по форме перевести на indexed lookup.
6. Добавить индексы: referenced form, active/period_active/number, если их нет.

Проверить:
- Страница ChecksEditor с фильтром formId.
- Создание/редактирование правила обновляет references.
- Backfill корректно проходит.
```

## 13. Lazy Materialization Ячеек

```text
Спроектируй lazy materialization форм комплекта. Это рискованная оптимизация, сначала сделай дизайн и минимальный PoC.

Нужно сделать:
1. Сейчас createReportPackage создаёт form_instances и materialized form_cell_values.
2. Изменить модель так, чтобы при создании комплекта создавались только headers form_instances.
3. loadInstance должен, если cells отсутствуют, собрать rows из template schema через buildInitialRows.
4. При первом save материализовать cells.
5. Checks/aggregation должны корректно воспринимать нематериализованные пустые формы.
6. Добавить feature flag, чтобы можно было отключить lazy mode.
7. Миграции существующих данных не должны ломаться.

Проверить:
- Создание комплекта становится почти мгновенным.
- Открытие формы без cells показывает строки.
- Сохранение формы создаёт cells.
- Проверки/агрегация не падают.
```

## 14. Compact Eval Snapshot

```text
Сделай компактный snapshot для проверок вместо передачи полных форм.

Нужно сделать:
1. Прочитать buildEvalSnapshotFromDb, evalContextFromSnapshot, evalContextFromInstances.
2. Спроектировать формат: formId -> rowNo -> columnKey -> numeric/string value.
3. Endpoint должен принимать scope zid/eid и возвращать только latest instances нужного комплекта.
4. Для CellK сохранить поддержку поиска по code/account/name/condition.
5. ChecksEditor/Tools/checkEngine должны использовать snapshot в backend mode.
6. Старый путь через полные instances оставить fallback.

Проверить:
- run checks даёт тот же результат до/после.
- Payload меньше, чем full instances.
- Работают Cell и CellK.
```

## 15. Column Virtualization Для Очень Широких Форм

```text
Расширь текущую виртуализацию таблицы до колонок.

Нужно сделать:
1. Прочитать SpreadsheetFormTable и useVirtualRows.
2. Добавить useVirtualColumns или расширить hook для горизонтального scroll.
3. Виртуализировать visibleCols при большом количестве колонок.
4. Сохранить:
   - frozen columns;
   - keyboard navigation;
   - selection range;
   - copy/paste;
   - active cell scrollIntoView по row и column.
5. Не ломать layout обычных форм с малым числом колонок.
6. Добавить ручной/автотест на широкую таблицу.

Проверить:
- Большая широкая форма.
- Выделение диапазона.
- Copy/paste.
- Rash button и readonly cells.
```
