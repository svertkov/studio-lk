// SMM Excel migration — CONTROLLED APPLY (ТЗ п.6 «Обязательный порядок» /
// п.33 «Apply по клиентам» / pre-apply hardening ТЗ п.36-41). НЕ ЗАПУСКАТЬ
// без отдельного подтверждения владельца после просмотра dry-run отчёта —
// этот файл сознательно не выполнялся ни разу.
//
// Запуск (когда будет разрешено):
//   set -a && source .env.local && set +a
//   npx tsx scripts/smm-import/apply.ts --project DIA --max-confidence HIGH
//
// Scope первого apply (ТЗ hardening п.37): ТОЛЬКО SmmContentItem +
// SmmPublication + SmmPublicationMetric + SmmMaterialLink + SmmMigrationRecord.
// WorkItems/Payments/RecurringPayouts сознательно НЕ включены (Phase B/C).
//
// Идемпотентность — двухуровневая (ТЗ hardening п.7/11), персистентная
// (SmmMigrationRecord, не natural key):
//   entityKey совпал + fingerprint совпал  → ALREADY_APPLIED, пропуск
//   entityKey совпал + fingerprint другой  → SOURCE_CHANGED_AFTER_APPLY,
//                                             бизнес-данные НЕ трогаются
//   entityKey не найден                    → NEW, создаётся business entity
//                                             + SmmMigrationRecord в одной
//                                             транзакции (ТЗ п.38)
//
// batchId — "smm-excel-2026-08-<project>-vN", вычисляется от уже
// существующих batchId той же migrationName+project (ТЗ п.41).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { prisma } from '@/lib/prisma'
import { readWorkbookGrids, type RawGrid } from './xlsx-read'
import { classifySheet, hintClientForWorkbook } from './classify'
import { extractContentRows } from './extract'
import { matchClient, type ExistingClient, type ExistingSmmProject } from './match'
import { dedupContentRows } from './dedup'
import { buildContentEntities } from './build'
import { decideMigrationStatus, meetsConfidenceThreshold, computeNextBatchId } from './migration-status'
import type { Confidence, ManifestEntry, ProposedContentItem, ProposedMaterial, ProposedMetric, ProposedPublication } from './types'

const MIGRATION_NAME = 'smm-excel-2026-08'

function parseArgs(argv: string[]): { dir: string; project: string | null; maxConfidence: Confidence } {
  let dir = path.join(os.homedir(), 'Desktop', 'Таблицы')
  let project: string | null = null
  let maxConfidence: Confidence = 'HIGH'
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir' && argv[i + 1]) dir = argv[++i]
    if (argv[i] === '--project' && argv[i + 1]) project = argv[++i]
    if (argv[i] === '--max-confidence' && argv[i + 1]) maxConfidence = argv[++i] as Confidence
  }
  return { dir, project, maxConfidence }
}

async function main() {
  const { dir, project, maxConfidence } = parseArgs(process.argv.slice(2))
  if (!project) {
    console.error('Обязателен флаг --project <projectCode> — apply выполняется по одному клиенту за раз (ТЗ п.33).')
    process.exit(1)
  }
  if (!['HIGH', 'MEDIUM', 'LOW'].includes(maxConfidence)) {
    console.error('--max-confidence должен быть HIGH, MEDIUM или LOW.')
    process.exit(1)
  }

  console.log('='.repeat(78))
  console.log(`CONTROLLED APPLY — клиент: ${project}, confidence >= ${maxConfidence}`)
  console.log('='.repeat(78))
  console.log('!!! Этот скрипт НЕ должен запускаться без отдельного подтверждения владельца')
  console.log('!!! после просмотра dry-run отчёта. Если вы видите это сообщение случайно —')
  console.log('!!! прервите выполнение (Ctrl+C) и вернитесь к dry-run.ts.')
  console.log('='.repeat(78))

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'))
  const [clients, projects, existingBatches] = await Promise.all([
    prisma.client.findMany({ select: { id: true, name: true } }) as Promise<ExistingClient[]>,
    prisma.smmProject.findMany({ select: { id: true, clientId: true, projectCode: true } }) as Promise<ExistingSmmProject[]>,
    prisma.smmMigrationRecord.findMany({ where: { migrationName: MIGRATION_NAME }, select: { batchId: true }, distinct: ['batchId'] }),
  ])

  const targetProject = projects.find(p => p.projectCode === project)
  if (!targetProject) {
    console.error(`SmmProject с projectCode="${project}" не найден — apply останавливается (ТЗ п.41: не выдумывать связь).`)
    process.exit(1)
  }
  const batchId = computeNextBatchId(MIGRATION_NAME, project, existingBatches.map(b => b.batchId))
  console.log(`batchId: ${batchId}`)

  const contentRowsAll = [] as ReturnType<typeof extractContentRows>['rows']
  for (const file of files) {
    const workbookHint = hintClientForWorkbook(file)
    if (!workbookHint) continue
    let grids: RawGrid[]
    try {
      grids = await readWorkbookGrids(path.join(dir, file))
    } catch {
      continue
    }
    for (const grid of grids) {
      const cls = classifySheet(grid)
      const types = [cls.type, ...cls.secondaryTypes]
      if (!types.includes('PRODUCTION') && !types.includes('CONTENT_PLAN') && !types.includes('ANALYTICS')) continue
      const { rows } = extractContentRows(grid, workbookHint)
      contentRowsAll.push(...rows)
    }
  }

  const clientMatch = matchClient(project, project, clients, projects)
  const groups = dedupContentRows(contentRowsAll).filter(g => g.rows[0]?.clientHint && clientMatch.clientHint === g.rows[0].clientHint)
  const built = buildContentEntities(groups, new Map([[clientMatch.clientHint, { ...clientMatch, proposedSmmProjectId: targetProject.id }]]))

  const eligible = built.contentItems.filter(ci => ci.smmProjectId && meetsConfidenceThreshold(ci.dedupConfidence, maxConfidence))
  const belowThreshold = built.contentItems.length - eligible.length
  console.log(`Подходит по confidence>=${maxConfidence} и определённому проекту: ${eligible.length} ContentItem.`)
  console.log(`Ниже порога / без проекта (не трогаются этим прогоном): ${belowThreshold}.`)

  const counts = { created: 0, alreadyApplied: 0, sourceChanged: 0 }
  for (const ci of eligible) {
    try {
      const status = await applyOneContentItem(ci, built.publications, built.metrics, built.materials, built.manifest, batchId, targetProject.id)
      if (status === 'NEW') counts.created++
      else if (status === 'ALREADY_APPLIED') counts.alreadyApplied++
      else counts.sourceChanged++
    } catch (e) {
      console.error(`ОСТАНОВКА: ошибка при применении "${ci.title}" (legacyCode=${ci.legacyCode}, tempId=${ci.tempId}):`, e)
      console.error(`Уже применено до сбоя: ${counts.created} создано, ${counts.alreadyApplied} уже были применены, ${counts.sourceChanged} с изменённым источником.`)
      process.exit(1)
    }
  }

  console.log('='.repeat(78))
  console.log(`APPLY ЗАВЕРШЁН (batch ${batchId}): создано ${counts.created}, уже были применены ${counts.alreadyApplied}, SOURCE_CHANGED_AFTER_APPLY ${counts.sourceChanged}.`)
  console.log('='.repeat(78))
}

async function applyOneContentItem(
  ci: ProposedContentItem,
  allPublications: ProposedPublication[],
  allMetrics: ProposedMetric[],
  allMaterials: ProposedMaterial[],
  manifest: ManifestEntry[],
  batchId: string,
  smmProjectId: string,
): Promise<'NEW' | 'ALREADY_APPLIED' | 'SOURCE_CHANGED_AFTER_APPLY'> {
  const contentManifestEntry = manifest.find(m => m.entityType === 'ContentItem' && m.tempId === ci.tempId)
  if (!contentManifestEntry) throw new Error(`manifest entry для ${ci.tempId} не найден — внутренняя ошибка сборки`)

  const existing = await prisma.smmMigrationRecord.findUnique({
    where: { entityKey_entityType: { entityKey: contentManifestEntry.entityKey, entityType: 'ContentItem' } },
  })
  const status = decideMigrationStatus(existing, contentManifestEntry.fingerprint)
  if (status !== 'NEW') return status

  const publications = allPublications.filter(p => p.contentTempId === ci.tempId)
  const metrics = allMetrics.filter(m => m.contentTempId === ci.tempId)
  const materials = allMaterials.filter(m => m.contentTempId === ci.tempId)

  await prisma.$transaction(async tx => {
    const created = await tx.smmContentItem.create({
      data: {
        smmProjectId,
        serviceType: 'OTHER', // формат уточняется вручную после импорта — источник этого не даёт однозначно
        title: ci.title,
        description: ci.description,
        plannedPublishDate: ci.plannedPublishDate ? new Date(ci.plannedPublishDate) : null,
        status: 'IDEA',
        notes: ci.legacyCode ? `Импортировано из Excel, legacy-код: ${ci.legacyCode}` : 'Импортировано из Excel',
      },
    })
    await tx.smmMigrationRecord.create({
      data: {
        migrationName: MIGRATION_NAME, batchId, sourceFile: contentManifestEntry.sourceFile, sourceSheet: contentManifestEntry.sourceSheet,
        sourceRow: contentManifestEntry.sourceRow, entityKey: contentManifestEntry.entityKey, fingerprint: contentManifestEntry.fingerprint,
        entityType: 'ContentItem', entityId: created.id, projectId: smmProjectId,
      },
    })

    for (const pub of publications) {
      const pubManifest = manifest.find(m => m.entityType === 'Publication' && m.tempId === `${ci.tempId}:${pub.platform}`)
      const createdPub = await tx.smmPublication.create({
        data: {
          contentItemId: created.id, platform: pub.platform, status: pub.status,
          plannedPublishAt: pub.plannedPublishAt ? new Date(pub.plannedPublishAt) : null,
          publishedAt: pub.publishedAt ? new Date(pub.publishedAt) : null, url: pub.url,
        },
      })
      if (pubManifest) {
        await tx.smmMigrationRecord.create({
          data: {
            migrationName: MIGRATION_NAME, batchId, sourceFile: pubManifest.sourceFile, sourceSheet: pubManifest.sourceSheet,
            sourceRow: pubManifest.sourceRow, entityKey: pubManifest.entityKey, fingerprint: pubManifest.fingerprint,
            entityType: 'Publication', entityId: createdPub.id, projectId: smmProjectId,
          },
        })
      }
      for (const metric of metrics.filter(m => m.platform === pub.platform)) {
        const metricManifest = manifest.find(m => m.entityType === 'Metric' && m.tempId === `${ci.tempId}:${pub.platform}:${metric.metricType}:${metric.capturedAt}`)
        const createdMetric = await tx.smmPublicationMetric.create({
          data: { publicationId: createdPub.id, metricType: metric.metricType, value: metric.value, capturedAt: new Date(metric.capturedAt), source: 'IMPORT' },
        })
        if (metricManifest) {
          await tx.smmMigrationRecord.create({
            data: {
              migrationName: MIGRATION_NAME, batchId, sourceFile: metricManifest.sourceFile, sourceSheet: metricManifest.sourceSheet,
              sourceRow: metricManifest.sourceRow, entityKey: metricManifest.entityKey, fingerprint: metricManifest.fingerprint,
              entityType: 'Metric', entityId: createdMetric.id, projectId: smmProjectId,
            },
          })
        }
      }
    }

    for (const mat of materials) {
      const matManifest = manifest.find(m => m.entityType === 'Material' && m.tempId === `${ci.tempId}:${mat.materialType === 'SOURCE_VIDEO' ? 'src' : 'master'}:${mat.url}`)
      const createdMat = await tx.smmMaterialLink.create({
        data: { smmProjectId, category: 'SOURCE', materialType: mat.materialType, title: ci.title, url: mat.url, relatedContentId: created.id },
      })
      if (matManifest) {
        await tx.smmMigrationRecord.create({
          data: {
            migrationName: MIGRATION_NAME, batchId, sourceFile: matManifest.sourceFile, sourceSheet: matManifest.sourceSheet,
            sourceRow: matManifest.sourceRow, entityKey: matManifest.entityKey, fingerprint: matManifest.fingerprint,
            entityType: 'Material', entityId: createdMat.id, projectId: smmProjectId,
          },
        })
      }
    }
  })
  return 'NEW'
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1) })
