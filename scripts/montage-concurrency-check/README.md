# Проверка гонки ensureMontageProjectForOrder

Не автоматический тест (в проекте нет тестовой БД, см. `vitest.config.ts`) — ручной скрипт-доказательство, проверяющий конкурентное поведение `ensureMontageProjectForOrder` (`src/lib/actions/montage.ts`) на реальном Postgres. Создаёт временный заказ (`ТЕСТ Concurrency Check ...`), запускает несколько раундов по-настоящему параллельных вызовов (`Promise.all`) для одного и того же `orderId`, проверяет, что каждый раз создаётся ровно один `MontageProject`, затем удаляет за собой тестовые данные (с проверкой имени перед удалением).

## Запуск

```
npx tsx scripts/montage-concurrency-check/check.ts
```

Использует `DATABASE_URL` из окружения — как и остальные скрипты в `scripts/`, требует `.env.local` (`set -a && source .env.local && set +a`).

## Когда перезапускать

После любого изменения `ensureMontageProjectForOrder` или связанной с ней логики создания `MontageProject` — регрессия здесь не поймается юнит-тестами (гонка воспроизводится только на реальном движке БД).
