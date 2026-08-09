// SMM Excel migration — DRY RUN (ТЗ п.28/48). Читает ВСЕ .xlsx из указанной
// папки (по умолчанию ~/Desktop/Таблицы), полностью прогоняет audit + match +
// dedup + build, печатает отчёт. НИЧЕГО не пишет в БД — только читает
// Client/SmmProject/EditorProfile для сопоставления (ТЗ: "нельзя начинать с
// прямой записи в БД").
//
// Запуск:
//   set -a && source .env.local && set +a
//   npx tsx scripts/smm-import/dry-run.ts [--dir "/путь/к/папке"] [--json out.json]

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { prisma } from '@/lib/prisma'
import { readWorkbookGrids, type RawGrid } from './xlsx-read'
import { classifySheet, detectSheetDrift, detectWorkbookDrift, hintClientForWorkbook } from './classify'
import { extractContentRows, extractWorkPaymentRows, extractTeamPayoutRows } from './extract'
import { matchClient, matchEditor, type ExistingClient, type ExistingEditor, type ExistingSmmProject } from './match'
import { dedupContentRows } from './dedup'
import { buildContentEntities, buildWorkItemCandidates, buildRecurringPayoutCandidates } from './build'
import { renderTextReport } from './report'
import type {
  ClientMatch, DriftIssue, DryRunResult, EditorMatch, MigrationException, SheetClassification,
  SourceContentRow, SourceTeamPayoutRow, SourceWorkPaymentRow,
} from './types'

function parseArgs(argv: string[]): { dir: string; jsonOut: string | null } {
  let dir = path.join(os.homedir(), 'Desktop', 'Таблицы')
  let jsonOut: string | null = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir' && argv[i + 1]) dir = argv[++i]
    if (argv[i] === '--json' && argv[i + 1]) jsonOut = argv[++i]
  }
  return { dir, jsonOut }
}

async function fetchMatchContext() {
  const [clients, projects, editors] = await Promise.all([
    prisma.client.findMany({ select: { id: true, name: true } }),
    prisma.smmProject.findMany({ select: { id: true, clientId: true, projectCode: true } }),
    prisma.editorProfile.findMany({ select: { id: true, displayName: true, editorCode: true } }),
  ])
  return {
    clients: clients as ExistingClient[],
    projects: projects as ExistingSmmProject[],
    editors: editors as ExistingEditor[],
  }
}

async function main() {
  const { dir, jsonOut } = parseArgs(process.argv.slice(2))
  if (!fs.existsSync(dir)) {
    console.error(`Папка не найдена: ${dir}`)
    process.exit(1)
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'))
  if (files.length === 0) {
    console.error(`В папке ${dir} нет .xlsx файлов`)
    process.exit(1)
  }

  const sheetClassifications: SheetClassification[] = []
  const driftIssues: DriftIssue[] = []
  const warnings: string[] = []
  const contentRows: SourceContentRow[] = []
  const workPaymentRows: SourceWorkPaymentRow[] = []
  const teamPayoutRows: SourceTeamPayoutRow[] = []
  const exceptions: MigrationException[] = []
  let skippedServiceRows = 0
  let scriptLibrarySheets = 0
  const clientHintToFiles = new Map<string, Set<string>>()
  const performerHints = new Set<string>()

  for (const file of files) {
    const filePath = path.join(dir, file)
    let grids: RawGrid[]
    try {
      grids = await readWorkbookGrids(filePath)
    } catch (e) {
      warnings.push(`не удалось прочитать "${file}": ${e instanceof Error ? e.message : String(e)}`)
      continue
    }

    const classifications = grids.map(classifySheet)
    sheetClassifications.push(...classifications)
    grids.forEach((g, i) => driftIssues.push(...detectSheetDrift(g, classifications[i].type)))
    driftIssues.push(...detectWorkbookDrift(grids))

    const workbookClientHint = hintClientForWorkbook(file)

    grids.forEach((grid, i) => {
      const cls = classifications[i]
      const allTypes = [cls.type, ...cls.secondaryTypes]

      if (cls.type === 'SCRIPT_LIBRARY') {
        scriptLibrarySheets++
        exceptions.push({
          category: 'UNSUPPORTED_SCRIPT_LIBRARY',
          message: `лист "${grid.sheet}" (${file}) — библиотека сценариев/идей, вне модели SmmContentItem, намеренно не мигрируется в этом этапе`,
          trace: { file, sheet: grid.sheet, row: 0 },
        })
        return
      }

      if (allTypes.includes('PRODUCTION') || allTypes.includes('CONTENT_PLAN') || allTypes.includes('ANALYTICS')) {
        const clientHint = workbookClientHint ?? 'неизвестный клиент'
        if (!clientHintToFiles.has(clientHint)) clientHintToFiles.set(clientHint, new Set())
        clientHintToFiles.get(clientHint)!.add(file)
        const { rows, skippedServiceRows: skipped } = extractContentRows(grid, clientHint)
        contentRows.push(...rows)
        skippedServiceRows += skipped
        return
      }

      if (cls.type === 'WORK_PAYMENTS') {
        const rows = extractWorkPaymentRows(grid)
        for (const r of rows) {
          if (!clientHintToFiles.has(r.clientHint)) clientHintToFiles.set(r.clientHint, new Set())
          clientHintToFiles.get(r.clientHint)!.add(file)
        }
        workPaymentRows.push(...rows)
        return
      }

      if (cls.type === 'TEAM_PAYOUTS') {
        const rows = extractTeamPayoutRows(grid)
        for (const r of rows) {
          performerHints.add(r.performerHint)
          if (r.clientHint) {
            if (!clientHintToFiles.has(r.clientHint)) clientHintToFiles.set(r.clientHint, new Set())
            clientHintToFiles.get(r.clientHint)!.add(file)
          }
        }
        teamPayoutRows.push(...rows)
        return
      }

      warnings.push(`лист "${grid.sheet}" (${file}) не удалось классифицировать (UNKNOWN) — пропущен, требуется ручная разметка`)
    })
  }

  const { clients, projects, editors } = await fetchMatchContext()

  const clientMatches = new Map<string, ClientMatch>()
  for (const [hint, filesUsing] of clientHintToFiles) {
    clientMatches.set(hint, matchClient([...filesUsing].join(', '), hint, clients, projects))
  }
  const editorMatches = new Map<string, EditorMatch>()
  for (const hint of performerHints) {
    editorMatches.set(hint, matchEditor(hint, editors))
  }

  const dedupGroups = dedupContentRows(contentRows)
  const contentResult = buildContentEntities(dedupGroups, clientMatches)
  const workItemResult = buildWorkItemCandidates(workPaymentRows, contentResult.contentItems, clientMatches)
  const recurringResult = buildRecurringPayoutCandidates(teamPayoutRows, editorMatches, clientMatches)

  const result: DryRunResult = {
    sheetClassifications,
    driftIssues,
    clientMatches: [...clientMatches.values()],
    editorMatches: [...editorMatches.values()],
    contentDedupGroups: dedupGroups,
    skippedServiceRows,
    proposedContentItems: contentResult.contentItems,
    proposedPublications: contentResult.publications,
    proposedMetrics: contentResult.metrics,
    proposedMaterials: contentResult.materials,
    proposedWorkItems: workItemResult.workItems,
    proposedRecurringPayouts: recurringResult.proposals,
    exceptions: [...exceptions, ...contentResult.exceptions, ...workItemResult.exceptions, ...recurringResult.exceptions],
    manifest: contentResult.manifest,
    warnings: [...warnings, scriptLibrarySheets > 0 ? `${scriptLibrarySheets} лист(ов) отнесены к SCRIPT_LIBRARY и не обрабатывались как контент` : ''].filter(Boolean),
  }

  console.log(renderTextReport(result))

  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify(result, null, 1), 'utf-8')
    console.log(`\nJSON-отчёт сохранён: ${jsonOut}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1) })
