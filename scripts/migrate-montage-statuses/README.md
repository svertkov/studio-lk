# Миграция статусов/типа контента исторических проектов монтажа

Доработка карточки проекта монтажа (`MontageProjectModal.tsx`) сократила
`MontageStatus` с 14 значений до 6 и добавила структурированный `contentType`
(`MontageContentType`) вместо свободного текста, а также раздельные
"календарные/рабочие" дни срока (`turnaroundDayType`). Этот скрипт приводит
уже импортированные исторические проекты (см. `scripts/import-montage-projects`)
в соответствие новой схеме — БЕЗ повторного обращения к исходной Google-таблице,
всё нужное уже в базе.

## Что делает

1. **Статус** — только сверка, ничего не меняет. Все 76 исторических проектов
   на момент написания использовали только `DELIVERED`/`IN_PROGRESS` — оба
   значения пережили сокращение enum без изменений (проверено прямым запросом
   к базе до `prisma db push --accept-data-loss`). Отчёт dry-run всё равно
   явно показывает текущее распределение статусов.
2. **Тип контента** — `classifyMontageContentType(title)` для проектов с
   `contentType IS NULL` (тот же классификатор, что и автосоздание проекта
   монтажа из заказа, `ensureMontageProjectForOrder`). Неуверенно
   классифицируемые названия уходят в `OTHER` с исходным текстом, сохранённым
   в `customContentType` — ничего не теряется и не угадывается вслепую.
3. **Тип дней срока** — бэкафилл `turnaroundDayType = 'CALENDAR'` для
   проектов с `deadlineType = 'DURATION_DAYS'`, у которых тип дней ещё не
   задан (так исторически всегда считался дедлайн — календарные дни, рабочие
   дни появились только в этой доработке).

## Что НЕ делается

- Суммы, исполнители, ссылки на материалы, описания, комментарии, даты — не
  трогаются.
- `deliveredAt`/`completedAt` не меняются и не сверяются друг с другом
  автоматически — если у проекта заполнены оба поля одновременно, dry-run
  только показывает это в отчёте как информационную заметку, ничего не решает
  за администратора.

## Команды

```bash
set -a && source .env.local && set +a

npx tsx scripts/migrate-montage-statuses/dry-run.ts     # ничего не меняет, только отчёт
npx tsx scripts/migrate-montage-statuses/apply.ts        # применяет план, пишет манифест для отката
npx tsx scripts/migrate-montage-statuses/rollback.ts scripts/migrate-montage-statuses/backups/apply-....json
```

## Идемпотентность

`buildPlan()` каждый раз считает план заново от текущего состояния базы
(`contentType IS NULL` / `turnaroundDayType IS NULL` при `DURATION_DAYS`) —
уже обновлённые проекты просто не попадают в план как `update` при повторном
запуске, дублей/перезаписи не будет.

## Откат

`apply.ts` пишет манифест в `scripts/migrate-montage-statuses/backups/apply-<дата>.json`
с полями `before`/`after` для каждого изменённого проекта. `rollback.ts` с
этим файлом восстанавливает `contentType`/`customContentType`/`turnaroundDayType`
ровно в состояние "до".
