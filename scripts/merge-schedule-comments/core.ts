// Одноразовая миграция под объединение карточки заказа: раньше EventCardModal.tsx
// показывал ДВА отдельных блока — нередактируемое description (описание события
// Google Calendar на момент последнего сохранения) и редактируемый notes
// ("Комментарий / нюансы"). Теперь в UI осталось только одно поле notes —
// эта миграция переносит уже накопленный в description текст в notes для
// существующих записей, чтобы при открытии старой карточки администратор не
// увидел вдруг "исчезнувший" текст.
//
// Правила объединения (см. постановку задачи):
//   - notes пуст, description заполнен      → notes = description
//   - description пуст                      → notes не трогаем (уже единственный источник)
//   - оба заполнены и совпадают/description уже
//     содержится в notes текстом            → не трогаем (уже объединено/дублей нет)
//   - оба заполнены и различаются           → notes = notes + "\n\n" + description
//
// Идемпотентно: buildPlan() каждый раз считает план от текущего состояния
// базы — после первого успешного apply.ts все строки попадают в skip при
// повторном запуске (см. planRow: если description уже содержится в notes —
// skip 'already_merged'; если notes был пуст — на предыдущем прогоне он уже
// стал равен description, следующий прогон увидит notes непустым и его
// содержащим description → тоже skip).

import { prisma } from '@/lib/prisma'

export interface SourceRow {
  id: string
  description: string | null
  notes: string | null
}

export type SkipReason = 'no_description' | 'already_merged' | 'identical'

export interface MigrationRowPlan {
  id: string
  previousNotes: string | null
  description: string
  proposedNotes: string
  action: 'set_from_description' | 'append_description' | 'skip'
  skipReason: SkipReason | null
}

export function planRow(row: SourceRow): MigrationRowPlan {
  const description = (row.description ?? '').trim()
  const notes = (row.notes ?? '').trim()

  if (!description) {
    return { id: row.id, previousNotes: row.notes, description: '', proposedNotes: row.notes ?? '', action: 'skip', skipReason: 'no_description' }
  }

  if (!notes) {
    return { id: row.id, previousNotes: row.notes, description, proposedNotes: description, action: 'set_from_description', skipReason: null }
  }

  if (notes === description || notes.includes(description)) {
    return { id: row.id, previousNotes: row.notes, description, proposedNotes: row.notes ?? '', action: 'skip', skipReason: notes === description ? 'identical' : 'already_merged' }
  }

  return {
    id: row.id,
    previousNotes: row.notes,
    description,
    proposedNotes: `${notes}\n\n${description}`,
    action: 'append_description',
    skipReason: null,
  }
}

export interface Plan {
  totalRows: number
  rows: MigrationRowPlan[]
}

export async function buildPlan(): Promise<Plan> {
  const rows = await prisma.scheduleEvent.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, description: true, notes: true },
  })
  return {
    totalRows: rows.length,
    rows: rows.map(planRow),
  }
}

export function summarizePlan(plan: Plan) {
  return {
    totalRows: plan.totalRows,
    setFromDescription: plan.rows.filter(r => r.action === 'set_from_description').length,
    appendDescription: plan.rows.filter(r => r.action === 'append_description').length,
    skippedNoDescription: plan.rows.filter(r => r.skipReason === 'no_description').length,
    skippedAlreadyMerged: plan.rows.filter(r => r.skipReason === 'already_merged').length,
    skippedIdentical: plan.rows.filter(r => r.skipReason === 'identical').length,
  }
}
