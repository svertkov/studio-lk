// Категории и статусы расходов + формулы план/факт — общие для actions-слоя и UI.

export type PlanFactStatus = 'fully_paid' | 'partially_paid' | 'unpaid' | 'overpaid'

export const PLAN_FACT_STATUS_LABELS: Record<PlanFactStatus, string> = {
  fully_paid:     'Оплачено полностью',
  partially_paid: 'Оплачено частично',
  unpaid:         'Не оплачено',
  overpaid:       'Переплата (проверить)',
}

export const PLAN_FACT_STATUS_COLORS: Record<PlanFactStatus, string> = {
  fully_paid:     'border-green-700 text-green-400',
  partially_paid: 'border-amber-700 text-amber-400',
  unpaid:         'border-zinc-600 text-zinc-400',
  overpaid:       'border-red-700 text-red-400',
}

export interface ExpenseDerived {
  remainingAmount: number
  paymentProgress: number // 0..100 (может быть >100 при переплате)
  planFactStatus: PlanFactStatus
}

// Единая точка расчёта план/факт — используется и при синхронизации (для
// определения статуса), и в actions-слое при чтении (ничего не хранится
// в БД производным, чтобы не рассинхронизироваться).
export function computeExpenseDerived(plannedAmount: number | null, actualAmount: number | null): ExpenseDerived {
  const planned = plannedAmount ?? actualAmount ?? 0
  const actual = actualAmount ?? 0
  const remainingAmount = planned - actual

  let paymentProgress: number
  if (planned <= 0) paymentProgress = actual > 0 ? 100 : 0
  else paymentProgress = (actual / planned) * 100

  let planFactStatus: PlanFactStatus
  if (actual > planned) planFactStatus = 'overpaid'
  else if (planned > 0 && actual >= planned) planFactStatus = 'fully_paid'
  else if (actual > 0) planFactStatus = 'partially_paid'
  else planFactStatus = 'unpaid'

  return { remainingAmount, paymentProgress, planFactStatus }
}

// Категории, реально встречающиеся в таблице расходов студии (см. заметку в
// памяти проекта) — цвета подобраны в той же палитре, что графики выручки.
export const EXPENSE_CATEGORY_DICTIONARY: { name: string; color: string; sortOrder: number }[] = [
  { name: 'Оборудование',         color: '#00c26b', sortOrder: 1 },
  { name: 'Ремонт',                color: '#3b82f6', sortOrder: 2 },
  { name: 'Подрядчики и аренда',  color: '#f59e0b', sortOrder: 3 },
  { name: 'Маркетинг',            color: '#a855f7', sortOrder: 4 },
  { name: 'Расходные материалы',  color: '#ef4444', sortOrder: 5 },
  { name: 'База помещения',       color: '#14b8a6', sortOrder: 6 },
  { name: 'Фиксированный платёж', color: '#6366f1', sortOrder: 7 },
  { name: 'Прочее',                color: '#71717a', sortOrder: 8 },
]

// ё/е в реальной таблице пишут вперемешку (например "платеж" вместо "платёж") —
// сравниваем без этой буквы, чтобы такие расходы не улетали в "Прочее".
function foldYo(s: string): string {
  return s.replace(/ё/g, 'е')
}

// Сырое значение категории из таблицы → каноническое имя из словаря выше.
// Пустая/нераспознанная категория уходит в "Прочее" — ничего не выдумываем.
export function normalizeExpenseCategory(raw: string | undefined | null): string {
  const v = foldYo((raw ?? '').trim().toLowerCase())
  if (!v) return 'Прочее'
  const found = EXPENSE_CATEGORY_DICTIONARY.find(c => foldYo(c.name.toLowerCase()) === v)
  return found ? found.name : 'Прочее'
}
