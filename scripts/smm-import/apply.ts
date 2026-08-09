// SMM Excel migration — CONTROLLED APPLY (ТЗ п.6 «Обязательный порядок» /
// п.33 «Apply по клиентам»). НЕ ЗАПУСКАТЬ без отдельного подтверждения
// владельца после просмотра dry-run отчёта (ТЗ п.48/49) — этот файл
// сознательно не выполнялся ни разу в рамках первой фазы задачи.
//
// Запуск (когда будет разрешено):
//   set -a && source .env.local && set +a
//   npx tsx scripts/smm-import/apply.ts --project DIA   # один клиент за раз (ТЗ п.33)
//
// Идемпотентность (ТЗ п.31/32) — ТЕКУЩАЯ реализация: natural-key проверка
// по (smmProjectId, title, plannedPublishDate) существующего SmmContentItem
// перед созданием — работает на существующих полях схемы, ничего нового не
// требует. РЕКОМЕНДАЦИЯ для первого реального крупного apply: добавить
// нормальный manifest-механизм — nullable `SmmContentItem.legacyImportCode`
// (составной unique с smmProjectId) — устойчивее natural-key к переименованию
// заголовка в источнике. Поле НЕ добавлено в эту схему сейчас: пробная
// попытка добавить его и сразу `prisma generate` в этой же сессии показала
// реальный риск — уже работающие `include`-запросos (без явного `select`)
// в actions/smm.ts начали бы требовать колонку, которой ещё нет в реальной
// БД, до отдельного `prisma db push`. Разумнее вводить поле и push вместе с
// первым согласованным apply, не раньше.
//
// Транзакционная стратегия (ТЗ п.33/34): один клиент = один вызов процесса;
// внутри — пакетами по контенту (не одна гигантская транзакция на тысячи
// строк), каждый ContentItem + его Publications/Metrics/Materials — одна
// prisma.$transaction. Если один ContentItem падает — весь процесс
// останавливается (fail fast) с чётким указанием, на каком tempId/legacyCode
// это произошло, а не продолжает молча с половиной сущностей.

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
import type { ProposedContentItem, ProposedMaterial, ProposedMetric, ProposedPublication } from './types'

function parseArgs(argv: string[]): { dir: string; project: string | null } {
  let dir = path.join(os.homedir(), 'Desktop', 'Таблицы')
  let project: string | null = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir' && argv[i + 1]) dir = argv[++i]
    if (argv[i] === '--project' && argv[i + 1]) project = argv[++i]
  }
  return { dir, project }
}

async function main() {
  const { dir, project } = parseArgs(process.argv.slice(2))
  if (!project) {
    console.error('Обязателен флаг --project <projectCode или подсказка клиента> — apply выполняется по одному клиенту за раз (ТЗ п.33).')
    process.exit(1)
  }

  console.log('='.repeat(78))
  console.log(`CONTROLLED APPLY — клиент: ${project}`)
  console.log('='.repeat(78))
  console.log('!!! Этот скрипт НЕ должен запускаться без отдельного подтверждения владельца')
  console.log('!!! после просмотра dry-run отчёта. Если вы видите это сообщение случайно —')
  console.log('!!! прервите выполнение (Ctrl+C) и вернитесь к dry-run.ts.')
  console.log('='.repeat(78))

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'))
  const [clients, projects] = await Promise.all([
    prisma.client.findMany({ select: { id: true, name: true } }) as Promise<ExistingClient[]>,
    prisma.smmProject.findMany({ select: { id: true, clientId: true, projectCode: true } }) as Promise<ExistingSmmProject[]>,
  ])

  const targetProject = projects.find(p => p.projectCode === project)
  if (!targetProject) {
    console.error(`SmmProject с projectCode="${project}" не найден — apply останавливается (ТЗ п.41: не выдумывать связь).`)
    process.exit(1)
  }

  // Пересобираем контент только для нужного клиента (та же логика, что
  // dry-run.ts, но не через общий Map всех клиентов — apply.ts обрабатывает
  // ровно одного).
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
  // Фильтруем на клиента ПОСЛЕ dedup — dedup должен видеть все строки,
  // группировка по clientHint внутри dedupContentRows уже не пускает разных
  // клиентов в одну группу.
  const groups = dedupContentRows(contentRowsAll).filter(g => g.rows[0]?.clientHint && clientMatch.clientHint === g.rows[0].clientHint)
  const built = buildContentEntities(groups, new Map([[clientMatch.clientHint, { ...clientMatch, proposedSmmProjectId: targetProject.id }]]))

  const highConfidence = built.contentItems.filter(ci => ci.dedupConfidence === 'HIGH' && ci.smmProjectId)
  const skipped = built.contentItems.length - highConfidence.length
  console.log(`Готово к apply: ${highConfidence.length} ContentItem (HIGH confidence, проект определён).`)
  console.log(`Пропущено (MEDIUM/LOW confidence или нет проекта — требуют ручного решения): ${skipped}.`)

  let created = 0
  let skippedExisting = 0
  for (const ci of highConfidence) {
    try {
      const idempotencyResult = await applyOneContentItem(ci, built.publications, built.metrics, built.materials)
      if (idempotencyResult === 'created') created++
      else skippedExisting++
    } catch (e) {
      console.error(`ОСТАНОВКА: ошибка при применении "${ci.title}" (legacyCode=${ci.legacyCode}, tempId=${ci.tempId}):`, e)
      console.error(`Уже применено до сбоя: ${created} создано, ${skippedExisting} пропущено как уже существующие.`)
      process.exit(1)
    }
  }

  console.log('='.repeat(78))
  console.log(`APPLY ЗАВЕРШЁН для клиента "${project}": создано ${created}, пропущено как уже существующие ${skippedExisting}.`)
  console.log('='.repeat(78))
}

async function applyOneContentItem(
  ci: ProposedContentItem,
  allPublications: ProposedPublication[],
  allMetrics: ProposedMetric[],
  allMaterials: ProposedMaterial[],
): Promise<'created' | 'existing'> {
  if (!ci.smmProjectId) throw new Error('smmProjectId отсутствует — не должно было дойти до сюда')

  // Идемпотентность (см. комментарий вверху файла про будущий legacyImportCode).
  const existing = await prisma.smmContentItem.findFirst({
    where: { smmProjectId: ci.smmProjectId, title: ci.title, plannedPublishDate: ci.plannedPublishDate ? new Date(ci.plannedPublishDate) : null },
    select: { id: true },
  })
  if (existing) return 'existing'

  const publications = allPublications.filter(p => p.contentTempId === ci.tempId)
  const metrics = allMetrics.filter(m => m.contentTempId === ci.tempId)
  const materials = allMaterials.filter(m => m.contentTempId === ci.tempId)

  await prisma.$transaction(async tx => {
    const created = await tx.smmContentItem.create({
      data: {
        smmProjectId: ci.smmProjectId!,
        serviceType: 'OTHER', // ТЗ не запрашивал вывод формата из источника — уточняется вручную после импорта
        title: ci.title,
        description: ci.description,
        plannedPublishDate: ci.plannedPublishDate ? new Date(ci.plannedPublishDate) : null,
        status: 'IDEA',
        notes: ci.legacyCode ? `Импортировано из Excel, legacy-код: ${ci.legacyCode}` : 'Импортировано из Excel',
      },
    })
    for (const pub of publications) {
      await tx.smmPublication.create({
        data: {
          contentItemId: created.id,
          platform: pub.platform,
          status: pub.status,
          plannedPublishAt: pub.plannedPublishAt ? new Date(pub.plannedPublishAt) : null,
          publishedAt: pub.publishedAt ? new Date(pub.publishedAt) : null,
          url: pub.url,
        },
      })
    }
    for (const mat of materials) {
      await tx.smmMaterialLink.create({
        data: { smmProjectId: ci.smmProjectId!, category: 'SOURCE', materialType: mat.materialType, title: ci.title, url: mat.url, relatedContentId: created.id },
      })
    }
    // Метрики создаются ПОСЛЕ публикаций в той же транзакции — нужен id
    // конкретной Publication по площадке, не только ContentItem.
    for (const metric of metrics) {
      const pub = await tx.smmPublication.findFirst({ where: { contentItemId: created.id, platform: metric.platform } })
      if (!pub) continue
      await tx.smmPublicationMetric.create({
        data: { publicationId: pub.id, metricType: metric.metricType, value: metric.value, capturedAt: new Date(metric.capturedAt), source: 'IMPORT' },
      })
    }
  })
  return 'created'
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1) })
