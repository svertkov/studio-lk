# backfill-finance-comment

Переносит `Order.netProfitOverrideReason` (старая "причина" ручного
переопределения прибыли, собиралась через удалённый `NetProfitOverrideDialog`)
в новое поле `Order.financeComment` ("Комментарий к прибыли") — только там,
где `financeComment` ещё пуст. `netProfitOverrideReason` не удаляется/не
очищается (заморожен, см. комментарий в `schema.prisma`).

`Order.netProfitManualAmount` (само число прибыли) эта миграция не трогает —
оно уже верно (AUTO-заказы имели `null`, MANUAL_OVERRIDE — реальное число, оба
случая уже совпадают с новой семантикой "Прибыль по заказу").

## Запуск

```bash
set -a && source .env.local && set +a
npx tsx scripts/backfill-finance-comment/dry-run.ts
npx tsx scripts/backfill-finance-comment/apply.ts
```
