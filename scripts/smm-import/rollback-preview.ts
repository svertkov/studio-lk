// SMM Excel migration — ROLLBACK PREVIEW (pre-apply hardening, ТЗ п.40).
// Read-only отчёт: какие entityId относятся к migrationName+batchId/project —
// ничего не удаляет. Полноценный auto-rollback НЕ обязателен по ТЗ; этот
// скрипт — основа для controlled rollback ПОЗЖЕ, вручную, с явным
// подтверждением, если он вообще понадобится.
//
// Запуск:
//   set -a && source .env.local && set +a
//   npx tsx scripts/smm-import/rollback-preview.ts --batch smm-excel-2026-08-dia-v1
//   npx tsx scripts/smm-import/rollback-preview.ts --project DIA

import { prisma } from '@/lib/prisma'

function parseArgs(argv: string[]): { batchId: string | null; project: string | null } {
  let batchId: string | null = null
  let project: string | null = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--batch' && argv[i + 1]) batchId = argv[++i]
    if (argv[i] === '--project' && argv[i + 1]) project = argv[++i]
  }
  return { batchId, project }
}

async function main() {
  const { batchId, project } = parseArgs(process.argv.slice(2))
  if (!batchId && !project) {
    console.error('Укажите --batch <batchId> или --project <projectCode>.')
    process.exit(1)
  }

  const where = batchId
    ? { batchId }
    : { projectId: (await prisma.smmProject.findUnique({ where: { projectCode: project! }, select: { id: true } }))?.id }

  if (!where.batchId && !where.projectId) {
    console.error(`SmmProject с projectCode="${project}" не найден.`)
    process.exit(1)
  }

  const records = await prisma.smmMigrationRecord.findMany({ where, orderBy: [{ entityType: 'asc' }, { appliedAt: 'asc' }] })

  console.log('='.repeat(78))
  console.log(`ROLLBACK PREVIEW — ${batchId ? `batch ${batchId}` : `project ${project}`}`)
  console.log('='.repeat(78))
  console.log(`Найдено записей migration record: ${records.length}`)

  const byType = new Map<string, number>()
  for (const r of records) byType.set(r.entityType, (byType.get(r.entityType) ?? 0) + 1)
  for (const [type, count] of byType) console.log(`  ${type}: ${count} (entityId для удаления при controlled rollback)`)

  const byBatch = new Map<string, number>()
  for (const r of records) byBatch.set(r.batchId, (byBatch.get(r.batchId) ?? 0) + 1)
  console.log('\nПо batchId:')
  for (const [b, count] of byBatch) console.log(`  ${b}: ${count}`)

  console.log('\nНичего не удалено — это read-only предпросмотр.')
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1) })
