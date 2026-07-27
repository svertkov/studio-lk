# merge-schedule-comments

Одноразовая миграция данных под объединение карточки заказа (EventCardModal.tsx):
раньше в UI было два блока — нередактируемое `ScheduleEvent.description` (описание
события Google Calendar) и редактируемое `ScheduleEvent.notes` ("Комментарий /
нюансы"). Теперь остаётся одно поле — `notes`. Эта миграция переносит уже
накопленный текст `description` в `notes` для существующих записей, чтобы
администратор не потерял видимость этого текста после того, как отдельный блок
убрали из интерфейса.

`description` не удаляется и не очищается — остаётся техническим снэпшотом
(на случай если понадобится сверка), но больше нигде не отображается в UI.

## Правила объединения

- `notes` пуст, `description` заполнен → `notes = description`
- `description` пуст → `notes` не трогаем
- оба заполнены и совпадают, либо `description` уже текстом содержится внутри
  `notes` → не трогаем (уже объединено, дублей не создаём)
- оба заполнены и различаются → `notes = notes + "\n\n" + description`

Идемпотентно: `buildPlan()` (`core.ts`) каждый раз считает план заново от
текущего состояния базы, повторный запуск `apply.ts` не создаёт дублей.

## Запуск

```bash
set -a && source .env.local && set +a

# 1. Сначала отчёт, ничего не пишет в базу
npx tsx scripts/merge-schedule-comments/dry-run.ts

# 2. Применить (перед этим — npm run db:backup)
npx tsx scripts/merge-schedule-comments/apply.ts

# 3. При необходимости откатить конкретный прогон
npx tsx scripts/merge-schedule-comments/rollback.ts scripts/merge-schedule-comments/backups/apply-....json
```
