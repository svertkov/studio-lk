// Разбор вкладки "Расходы" Google-таблицы студии — колонки идут в фиксированном
// порядке (сама таблица называет колонку категории просто "Столбец 3", поэтому
// сопоставление по названию заголовка, как в обычном импорте клиентов, здесь не
// подходит — разбираем по позиции; порядок подтверждён на реальных данных):
//   0 Дата, 1 Название, 2 Категория, 3 Стоимость единицы (план), 4 План/Факт,
//   5 Затраты итог факт, 6 Статус, 7 Кто заказал, 8 Кто оплатил, 9 Кто получил
import { createHash } from 'crypto'
import { parseAmount, parseFlexibleDate } from '@/lib/import/normalize'
import { normalizeExpenseCategory } from '@/lib/expense-model'

export interface ParsedExpenseRow {
  externalId: string
  date: Date | null
  title: string
  category: string
  plannedAmount: number | null
  actualAmount: number | null
  rawStatus: string | null
  orderedBy: string | null
  paidBy: string | null
  receivedBy: string | null
}

const COL = {
  date: 0, title: 1, category: 2, plannedAmount: 3, planFactMarker: 4,
  actualAmount: 5, status: 6, orderedBy: 7, paidBy: 8, receivedBy: 9,
} as const

// Идентичность обязательства — только поля, которые НЕ меняются по мере частичной
// оплаты (дата+название+СЫРАЯ категория+план). Специально сырая категория из
// таблицы, а не нормализованное каноническое имя — если словарь категорий
// когда-нибудь поправится (опечатка, новая запись в словаре и т.п., как уже
// было с "платеж"/"платёж"), это не должно менять личность уже загруженного
// расхода и плодить дубликат; меняться должно только содержимое самой ячейки.
// Если план когда-то поменяют в таблице задним числом, строка будет воспринята
// как новая — принятый компромисс, тот же подход, что и с внешним ключом для
// расходов, предложенным в спецификации.
// occurrence — на случай двух ПОЛНОСТЬЮ идентичных строк (реальный случай в этой
// таблице: одну и ту же позицию оборудования купили дважды в один день по одной
// цене) — без этого второй такой расход задавил бы первый вместо создания
// отдельной записи.
function computeExternalId(dateRaw: string, title: string, categoryRaw: string, plannedAmount: number | null, occurrence: number): string {
  const parts = [dateRaw.trim(), title.trim().toLowerCase(), categoryRaw.trim().toLowerCase(), (plannedAmount ?? '').toString(), String(occurrence)]
  return createHash('sha256').update(parts.join('|')).digest('hex')
}

export function parseExpensesTable(table: string[][]): ParsedExpenseRow[] {
  const dataRows = table.slice(1) // первая строка — заголовки
  const rows: ParsedExpenseRow[] = []
  const occurrenceByKey = new Map<string, number>()

  for (const r of dataRows) {
    if (r.every(c => !c?.trim())) continue // пустая строка-шаблон

    const title = (r[COL.title] ?? '').trim()
    if (!title) continue // строка без названия расхода — не расход, пропускаем

    const dateRaw = (r[COL.date] ?? '').trim()
    const categoryRaw = (r[COL.category] ?? '').trim()
    const category = normalizeExpenseCategory(categoryRaw)
    const plannedAmount = parseAmount(r[COL.plannedAmount] ?? '') ?? null
    const actualAmount = parseAmount(r[COL.actualAmount] ?? '') ?? null
    const rawStatus = (r[COL.status] ?? '').trim() || null
    const orderedBy = (r[COL.orderedBy] ?? '').trim() || null
    const paidBy = (r[COL.paidBy] ?? '').trim() || null
    const receivedBy = (r[COL.receivedBy] ?? '').trim() || null

    const dedupKey = [dateRaw, title.toLowerCase(), categoryRaw.toLowerCase(), plannedAmount ?? ''].join('|')
    const occurrence = occurrenceByKey.get(dedupKey) ?? 0
    occurrenceByKey.set(dedupKey, occurrence + 1)

    rows.push({
      externalId: computeExternalId(dateRaw, title, categoryRaw, plannedAmount, occurrence),
      date: dateRaw ? (parseFlexibleDate(dateRaw) ?? null) : null,
      title,
      category,
      plannedAmount,
      actualAmount,
      rawStatus,
      orderedBy,
      paidBy,
      receivedBy,
    })
  }

  return rows
}
