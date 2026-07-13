// Применяет план из core.ts: создаёт EditorProfile (по одному на нормализованное
// имя, переиспользуя уже существующие при повторном запуске) и MontageProject
// для каждой строки со статусом 'create'. Запуск:
//   set -a && source .env.local && set +a
//   npx tsx scripts/import-montage-projects/apply.ts
//
// Идемпотентность: каждый MontageProject получает importExternalId (fingerprint
// строки, см. core.ts) — buildPlan() помечает уже импортированные строки как
// 'skip_already_imported' по этому же полю, повторный запуск не создаёт дублей.
// Монтажёры сопоставляются по нормализованному имени с уже существующими
// EditorProfile ПЕРЕД созданием — повторный запуск не плодит вторые профили.
//
// Каждый проект создаётся в своей отдельной транзакции (как в
// scripts/promote-visits-to-orders/apply.ts) — прерывание посередине не
// оставляет частично созданных записей и не мешает следующему запуску.

import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { prisma } from '@/lib/prisma'
import { buildPlan, collectDistinctEditors, IMPORT_SOURCE } from './core'

interface CreatedRecord {
  sheetRow: number
  montageProjectId: string
  fingerprint: string
}

async function resolveOrCreateEditors(rows: ReturnType<typeof collectDistinctEditors>): Promise<Map<string, string>> {
  const existing = await prisma.editorProfile.findMany({ select: { id: true, displayName: true } })
  const byKey = new Map<string, string>()
  for (const e of existing) {
    const key = e.displayName.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')
    if (!byKey.has(key)) byKey.set(key, e.id)
  }

  const keyToId = new Map<string, string>()
  for (const r of rows) {
    const existingId = byKey.get(r.key)
    if (existingId) { keyToId.set(r.key, existingId); continue }
    const created = await prisma.editorProfile.create({ data: { displayName: r.displayName } })
    keyToId.set(r.key, created.id)
    byKey.set(r.key, created.id)
  }
  return keyToId
}

async function main() {
  const plan = await buildPlan()
  const toCreate = plan.rows.filter(r => r.action === 'create')

  if (toCreate.length === 0) {
    console.log('Нечего применять — нет строк со статусом "create". Запустите dry-run.ts, чтобы посмотреть текущий план.')
    return
  }

  const distinctEditors = collectDistinctEditors(toCreate)
  console.log(`Будет создано проектов: ${toCreate.length}`)
  console.log(`Будет создано/переиспользовано монтажёров: ${distinctEditors.length}`)
  console.log()

  const editorIdByKey = await resolveOrCreateEditors(distinctEditors)

  const created: CreatedRecord[] = []
  let failed = 0

  for (const r of toCreate) {
    try {
      const editorId = r.executorKey ? (editorIdByKey.get(r.executorKey) ?? null) : null
      const internalCommentParts = [
        r.terms ? `Условия (из таблицы): ${r.terms}` : null,
        r.executorExtraRaw.length > 0 ? `Со-исполнители (из таблицы, не структурированы): ${r.executorExtraRaw.join(', ')}` : null,
      ].filter((s): s is string => !!s)

      const project = await prisma.montageProject.create({
        data: {
          clientId: r.clientMatch.clientId,
          title: r.title || null,
          status: r.status ?? 'NEW',
          editorId,
          assignedAt: editorId ? r.sourceReceivedAt : null,
          sourceReceivedAt: r.sourceReceivedAt,
          deadlineType: r.deadlineDate ? 'FIXED_DATE' : null,
          deadlineDate: r.deadlineDate,
          clientAmount: r.clientAmount,
          editorAmount: r.editorAmount,
          clientPaymentStatus: r.clientPaymentStatus,
          editorPaymentStatus: r.editorPaymentStatus,
          sourceMaterialsUrl: r.sourceUrl || null,
          revisionsUsed: r.revisions ? (Number(r.revisions) || 0) : 0,
          internalComment: internalCommentParts.length > 0 ? internalCommentParts.join('\n') : null,
          importSource: IMPORT_SOURCE,
          importExternalId: r.fingerprint,
        },
      })

      created.push({ sheetRow: r.sheetRow, montageProjectId: project.id, fingerprint: r.fingerprint })
    } catch (e) {
      failed++
      console.error(`Ошибка для строки ${r.sheetRow}:`, e)
    }
  }

  const dir = join(__dirname, 'backups')
  mkdirSync(dir, { recursive: true })
  const filename = `apply-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  const filepath = join(dir, filename)
  writeFileSync(filepath, JSON.stringify({
    createdAt: new Date().toISOString(),
    note: 'Проекты монтажа, созданные import-montage-projects/apply.ts. Для отката — rollback.ts с этим файлом. Монтажёры (EditorProfile) НЕ удаляются откатом — см. README.md.',
    count: created.length,
    records: created,
  }, null, 2))

  console.log(`Создано проектов: ${created.length}`)
  if (failed > 0) console.log(`Ошибок: ${failed} (см. вывод выше)`)
  console.log(`Манифест для отката сохранён: ${filepath}`)

  await prisma.auditLog.create({
    data: {
      userId: null,
      action: 'MONTAGE_PROJECTS_IMPORTED',
      entityType: 'MontageProject',
      entityId: 'bulk',
      metadata: { created: created.length, failed, totalPlanned: toCreate.length, editorsResolved: distinctEditors.length, manifestFile: filename },
    },
  })
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
