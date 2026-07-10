# Восстановление времени исторических съёмок

Разово восстанавливает `startAt`/`endAt` у уже импортированных `ClientVisit`
из исходной Google-таблицы студии (колонка вида «2 часа (16-18)»).

Сопоставление — по `sourceRowHash` (точный хэш исходной строки таблицы, уже
хранится на каждом визите с момента импорта), не по имени клиента.

## Запуск

Все команды — из корня проекта, с переменными окружения из `.env.local`:

```bash
set -a && source .env.local && set +a

# 1. Предварительный анализ — ничего не пишет в базу
npx tsx scripts/backfill-visit-times/dry-run.ts

# 2. Резервная копия затрагиваемых визитов (до apply, обязательно)
npx tsx scripts/backfill-visit-times/backup.ts

# 3. Применение — обновляет только строки без конфликтов
npx tsx scripts/backfill-visit-times/apply.ts

# При необходимости — откат к состоянию из конкретного бэкапа
npx tsx scripts/backfill-visit-times/rollback.ts scripts/backfill-visit-times/backups/backup-<...>.json
```

`apply.ts` идемпотентен: повторный запуск не создаёт дублей и не
перезаписывает уже выставленное время (каждое обновление — `updateMany` с
условием `startAt: null` в самом `where`).
