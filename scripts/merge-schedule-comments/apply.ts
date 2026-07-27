// Применяет план из core.ts: переносит description (описание события Google
// Calendar) в notes ("Комментарий / нюансы") для существующих ScheduleEvent,
// где notes ещё не содержит этот текст. description НЕ трогаем — остаётся
// техническим снэпшотом (см. комментарий в prisma/schema.prisma). Запуск:
//   set -a && source .env.local && set +a
//   npx tsx scripts/merge-schedule-comments/apply.ts
//
// Идемпотентность: buildPlan() считает план заново от текущего состояния
// базы (см. core.ts) — уже перенесённые записи при повторном запуске
// попадают в skip.
//
// Перед реальным запуском на проде — npm run db:backup (см. AGENTS.md, Data
// Safety and Audit Integrity), это единственная база (dev=prod).

import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { prisma } from '@/lib/prisma'
import { buildPlan } from './core'

interface ChangedRecord {
  id: string
  previousNotes: string | null
  newNotes: string
  action: 'set_from_description' | 'append_description'
}

async function main() {
  const plan = await buildPlan()
  const toChange = plan.rows.filter(r => r.action !== 'skip')

  if (toChange.length === 0) {
    console.log('Нечего применять — все записи уже объединены. Запустите dry-run.ts для отчёта.')
    return
  }

  console.log(`Будет изменено записей: ${toChange.length}`)
  console.log()

  const changed: ChangedRecord[] = []
  let failed = 0

  for (const r of toChange) {
    try {
      // findFirst перед update — сверяем, что запись всё ещё существует и её
      // notes не изменились с момента построения плана (защита от гонки с
      // администратором, который мог сохранить карточку прямо сейчас).
      const existing = await prisma.scheduleEvent.findFirst({ where: { id: r.id } })
      if (!existing || existing.notes !== r.previousNotes) {
        console.log(`  · пропущено (изменилось за время миграции): ${r.id}`)
        continue
      }
      await prisma.scheduleEvent.update({ where: { id: existing.id }, data: { notes: r.proposedNotes } })
      changed.push({ id: r.id, previousNotes: r.previousNotes, newNotes: r.proposedNotes, action: r.action as 'set_from_description' | 'append_description' })
    } catch (e) {
      failed++
      console.error(`Ошибка для записи ${r.id}:`, e)
    }
  }

  const dir = join(__dirname, 'backups')
  mkdirSync(dir, { recursive: true })
  const filename = `apply-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  const filepath = join(dir, filename)
  writeFileSync(filepath, JSON.stringify({
    createdAt: new Date().toISOString(),
    note: 'ScheduleEvent.notes, изменённые merge-schedule-comments/apply.ts. Для отката — rollback.ts с этим файлом (восстанавливает previousNotes).',
    count: changed.length,
    records: changed,
  }, null, 2))

  console.log(`Изменено записей: ${changed.length}`)
  if (failed > 0) console.log(`Ошибок: ${failed} (см. вывод выше)`)
  console.log(`Манифест для отката сохранён: ${filepath}`)

  await prisma.auditLog.create({
    data: {
      userId: null,
      action: 'SCHEDULE_EVENT_COMMENTS_MERGED',
      entityType: 'ScheduleEvent',
      entityId: 'bulk',
      metadata: { changed: changed.length, failed, totalPlanned: toChange.length },
    },
  })
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
