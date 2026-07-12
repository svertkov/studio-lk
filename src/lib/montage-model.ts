// Единый сервисный слой раздела «Монтаж» — по тому же принципу, что
// order-model.ts для заказов: статус-конфиг/лейблы, расчёт прибыли, дедлайна,
// просрочки и причин «Требует внимания» живут здесь ОДИН раз и переиспользуются
// дашбордом, таблицей проектов, карточкой проекта, карточкой монтажёра и
// карточкой клиента — а не копируются по компонентам (см. AGENTS.md, п.4).

import type { MontageStatus, MontageClientPaymentStatus, MontageEditorPaymentStatus, MontageDeadlineType, OrderStatus } from '@prisma/client'
import { monthKey } from '@/lib/order-model'

export type { MontageStatus, MontageClientPaymentStatus, MontageEditorPaymentStatus, MontageDeadlineType }

// ============================================================
// СТАТУСЫ ПРОЕКТА МОНТАЖА — единственный источник лейбла/порядка/цвета,
// тот же принцип, что ORDER_STATUS_CONFIG (order-model.ts). Цвет здесь —
// готовый Tailwind-класс (text-*), а не CSS-токен: раздел "Монтаж" не
// использует drag&drop-канбан с glow-колонками, как CRM, только таблицу и
// компактные статус-плашки — усложнять до уровня ORDER_STATUS_CONFIG незачем.
// ============================================================

export interface MontageStatusConfig {
  label: string
  order: number
  color: string
}

const MONTAGE_STATUS_CONFIG: Record<MontageStatus, MontageStatusConfig> = {
  NEW:                  { label: 'Новый',              order: 1,  color: 'text-blue-400' },
  NEEDS_INFO:           { label: 'Требует заполнения',  order: 2,  color: 'text-amber-400' },
  AWAITING_SOURCE:      { label: 'Ожидает исходники',   order: 3,  color: 'text-amber-400' },
  READY_FOR_ASSIGNMENT: { label: 'Готов к назначению',  order: 4,  color: 'text-cyan-400' },
  ASSIGNED:             { label: 'Назначен',            order: 5,  color: 'text-cyan-400' },
  IN_PROGRESS:          { label: 'В работе',            order: 6,  color: 'text-yellow-400' },
  IN_REVIEW:            { label: 'На проверке',         order: 7,  color: 'text-yellow-400' },
  AWAITING_REVISIONS:   { label: 'Ожидает правки',      order: 8,  color: 'text-orange-400' },
  REVISIONS:            { label: 'Правки',              order: 9,  color: 'text-orange-400' },
  READY:                { label: 'Готов',               order: 10, color: 'text-lime-400' },
  DELIVERED:            { label: 'Сдан',                order: 11, color: 'text-green-500' },
  ON_HOLD:              { label: 'Приостановлен',       order: 12, color: 'text-zinc-400' },
  CANCELLED:            { label: 'Отменён',             order: 13, color: 'text-red-400' },
  ARCHIVED:             { label: 'Архив',                order: 14, color: 'text-zinc-500' },
}

export function getMontageStatusConfig(status: MontageStatus): MontageStatusConfig {
  return MONTAGE_STATUS_CONFIG[status]
}

export const MONTAGE_STATUS_LABELS: Record<MontageStatus, string> = Object.fromEntries(
  (Object.keys(MONTAGE_STATUS_CONFIG) as MontageStatus[]).map(s => [s, MONTAGE_STATUS_CONFIG[s].label]),
) as Record<MontageStatus, string>

export const MONTAGE_STATUS_ORDER: MontageStatus[] = (Object.keys(MONTAGE_STATUS_CONFIG) as MontageStatus[])
  .sort((a, b) => MONTAGE_STATUS_CONFIG[a].order - MONTAGE_STATUS_CONFIG[b].order)

// Статусы, которые считаются "активной работой" (для KPI "В работе" на
// дашборде и фильтра "Активные проекты" в карточке клиента/монтажёра) —
// всё, что уже назначено и не является финальным/приостановленным состоянием.
export const MONTAGE_ACTIVE_STATUSES: MontageStatus[] = [
  'ASSIGNED', 'IN_PROGRESS', 'IN_REVIEW', 'AWAITING_REVISIONS', 'REVISIONS', 'READY',
]

// Статусы, которые считаются "смонтировано" (KPI "Смонтировано проектов" на
// дашборде, п.10 ТЗ) — только реально сданные клиенту.
export const MONTAGE_DELIVERED_STATUSES: MontageStatus[] = ['DELIVERED']

export const MONTAGE_CLIENT_PAYMENT_STATUS_LABELS: Record<MontageClientPaymentStatus, string> = {
  NOT_SPECIFIED:  'Не указана',
  PENDING:        'Ожидается',
  PARTIALLY_PAID: 'Частично оплачено',
  PAID:           'Оплачено',
  CANCELLED:      'Отменено',
  NOT_REQUIRED:   'Не требуется',
}

export const MONTAGE_EDITOR_PAYMENT_STATUS_LABELS: Record<MontageEditorPaymentStatus, string> = {
  NOT_CALCULATED: 'Не рассчитана',
  PENDING:        'Ожидает выплаты',
  PARTIALLY_PAID: 'Частично выплачено',
  PAID:           'Выплачено',
  NOT_REQUIRED:   'Не требуется',
}

// ============================================================
// ФИНАНСЫ — единая формула прибыли, чтобы дашборд/таблица/карточка
// монтажёра/карточка проекта никогда не считали её по-разному (ТЗ п.2).
// null — прибыль не может быть достоверно посчитана (одна из сумм неизвестна),
// это НЕ то же самое, что 0 — "Нет данных" в UI должно отличаться от "0 ₽".
// ============================================================

export function computeMontageProfit(clientAmount: number | null, editorAmount: number | null): number | null {
  if (clientAmount == null || editorAmount == null) return null
  return clientAmount - editorAmount
}

export function computeMontageMargin(clientAmount: number | null, editorAmount: number | null): number | null {
  const profit = computeMontageProfit(clientAmount, editorAmount)
  if (profit == null || clientAmount == null || clientAmount === 0) return null
  return profit / clientAmount
}

// ============================================================
// ДЕДЛАЙН — вычисляется ОДИН раз при сохранении карточки (см.
// src/lib/actions/montage.ts) и хранится готовым значением в
// MontageProject.deadlineDate, эта функция — единственное место, где решается
// "какая дата дедлайна", дальше везде читается уже готовое поле.
//
// Только календарные дни (не рабочие) — в проекте нет ни одного существующего
// механизма расчёта рабочих дней/праздников, вводить его ради одного поля
// одной новой фичи было бы преждевременным усложнением (ТЗ явно предупреждал
// не добавлять поля/логику вслепую); при необходимости расширяется позже без
// изменения формы хранения (deadlineType остаётся enum).
// ============================================================

export interface MontageDeadlineInput {
  sourceReceivedAt: string | Date | null
  deadlineType: MontageDeadlineType | null
  deadlineDate: string | Date | null | undefined
  turnaroundDays: number | null | undefined
}

export function computeMontageDeadline(input: MontageDeadlineInput): Date | null {
  if (input.deadlineType === 'FIXED_DATE') {
    return input.deadlineDate ? new Date(input.deadlineDate) : null
  }
  if (input.deadlineType === 'DURATION_DAYS') {
    if (!input.sourceReceivedAt || input.turnaroundDays == null) return null
    const d = new Date(input.sourceReceivedAt)
    d.setDate(d.getDate() + input.turnaroundDays)
    return d
  }
  return null
}

function pluralizeDays(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'день'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дня'
  return 'дней'
}

// Статусы, для которых просрочка/обратный отсчёт больше не имеют смысла —
// проект либо уже сдан, либо снят с производства (ТЗ п.20: просрочен, если
// deadlineDate < now И статус не «Сдан»/«Отменён»/«Архив»).
const MONTAGE_DEADLINE_INACTIVE_STATUSES: MontageStatus[] = ['DELIVERED', 'CANCELLED', 'ARCHIVED']

export interface MontageDeadlineStateInput {
  deadlineDate: string | Date | null
  status: MontageStatus
  deliveredAt: string | Date | null
}

// Разница в календарных днях (не часах) между двумя датами — дедлайн это
// дата, а не момент времени, поэтому "Дедлайн сегодня" должен срабатывать
// весь день, а не только если текущее время раньше конкретного часа дедлайна.
function calendarDaysBetween(a: Date, b: Date): number {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((utcA - utcB) / 86_400_000)
}

export function isMontageOverdue(project: MontageDeadlineStateInput, now: Date = new Date()): boolean {
  if (!project.deadlineDate) return false
  if (MONTAGE_DEADLINE_INACTIVE_STATUSES.includes(project.status)) return false
  return calendarDaysBetween(new Date(project.deadlineDate), now) < 0
}

// Готовая строка для колонки "Дедлайн" (ТЗ п.14/20): "Осталось N дней" /
// "Дедлайн сегодня" / "Просрочено на N дней" / "Сдано вовремя" / "Сдано с
// опозданием на N дней" — единственное место, формирующее этот текст.
export function montageDeadlineLabel(project: MontageDeadlineStateInput, now: Date = new Date()): string | null {
  if (!project.deadlineDate) return null
  const deadline = new Date(project.deadlineDate)

  if (project.status === 'DELIVERED' && project.deliveredAt) {
    const delivered = new Date(project.deliveredAt)
    const diffDays = calendarDaysBetween(delivered, deadline)
    if (diffDays <= 0) return 'Сдано вовремя'
    return `Сдано с опозданием на ${diffDays} ${pluralizeDays(diffDays)}`
  }
  if (MONTAGE_DEADLINE_INACTIVE_STATUSES.includes(project.status)) return null

  const diffDays = calendarDaysBetween(deadline, now)
  if (diffDays < 0) return `Просрочено на ${Math.abs(diffDays)} ${pluralizeDays(Math.abs(diffDays))}`
  if (diffDays === 0) return 'Дедлайн сегодня'
  return `Осталось ${diffDays} ${pluralizeDays(diffDays)}`
}

// ============================================================
// МАТЕРИАЛЫ — исходники и NAS, не дублируем существующие поля ScheduleEvent
// (см. схему: MontageProject.sourceMaterialsUrl — только переопределение).
// ============================================================

// Эффективная ссылка на исходники: собственное поле проекта побеждает, если
// задано (нужно для самостоятельных проектов или когда монтажёру передали
// другую ссылку, отличную от исходной съёмочной), иначе — ссылка со связанного
// заказа (order.yandexDiskUrl из OrderDTO), иначе — ничего.
export function getMontageSourceMaterialsUrl(
  project: { sourceMaterialsUrl: string | null },
  orderYandexDiskUrl: string | null,
): string | null {
  return project.sourceMaterialsUrl ?? orderYandexDiskUrl ?? null
}

const MONTAGE_COMPLETE_STATUSES: MontageStatus[] = ['READY', 'DELIVERED']

export function isMontageMissingNas(project: { status: MontageStatus; mountedMaterialNasUrl: string | null }): boolean {
  return MONTAGE_COMPLETE_STATUSES.includes(project.status) && !project.mountedMaterialNasUrl
}

// ============================================================
// «ТРЕБУЮТ ВНИМАНИЯ» (ТЗ п.10/12) — единый источник причин для KPI-карточки
// дашборда и её раскрытия; та же функция должна фильтровать список за карточкой,
// чтобы счётчик и список никогда не расходились.
// ============================================================

export type MontageAttentionReason =
  | 'NO_EDITOR' | 'OVERDUE' | 'NO_SOURCE' | 'NO_NAS_AFTER_DELIVERY' | 'PAYMENT_UNDEFINED' | 'INCOMPLETE_CARD'

export const MONTAGE_ATTENTION_LABELS: Record<MontageAttentionReason, string> = {
  NO_EDITOR:              'Без монтажёра',
  OVERDUE:                'Просрочен дедлайн',
  NO_SOURCE:               'Нет исходников',
  NO_NAS_AFTER_DELIVERY:   'Нет NAS после сдачи',
  PAYMENT_UNDEFINED:       'Оплата не определена',
  INCOMPLETE_CARD:         'Незаполненная карточка',
}

export interface MontageAttentionInput {
  status: MontageStatus
  editorId: string | null
  deadlineDate: string | Date | null
  deliveredAt: string | Date | null
  // Уже РЕЗОЛВЛЕННАЯ ссылка на исходники (см. getMontageSourceMaterialsUrl) —
  // эта функция не знает про Order/ScheduleEvent, только про готовое значение.
  effectiveSourceMaterialsUrl: string | null
  mountedMaterialNasUrl: string | null
  clientAmount: number | null
  clientPaymentStatus: MontageClientPaymentStatus
  title: string | null
  description: string | null
}

const MONTAGE_ATTENTION_EXEMPT_STATUSES: MontageStatus[] = ['CANCELLED', 'ARCHIVED', 'NEW', 'NEEDS_INFO']

export function getMontageAttentionReasons(project: MontageAttentionInput, now: Date = new Date()): MontageAttentionReason[] {
  if (project.status === 'CANCELLED' || project.status === 'ARCHIVED') return []
  const reasons: MontageAttentionReason[] = []

  if (!project.editorId && !MONTAGE_ATTENTION_EXEMPT_STATUSES.includes(project.status)) reasons.push('NO_EDITOR')
  if (isMontageOverdue({ deadlineDate: project.deadlineDate, status: project.status, deliveredAt: project.deliveredAt }, now)) {
    reasons.push('OVERDUE')
  }
  if (!project.effectiveSourceMaterialsUrl && !MONTAGE_ATTENTION_EXEMPT_STATUSES.includes(project.status)) reasons.push('NO_SOURCE')
  if (isMontageMissingNas({ status: project.status, mountedMaterialNasUrl: project.mountedMaterialNasUrl })) reasons.push('NO_NAS_AFTER_DELIVERY')
  if (project.clientAmount != null && project.clientPaymentStatus === 'NOT_SPECIFIED') reasons.push('PAYMENT_UNDEFINED')
  if (!project.title && !project.description) reasons.push('INCOMPLETE_CARD')

  return reasons
}

// ============================================================
// СВЯЗЬ СО СТАТУСОМ ЗАКАЗА (CRM) — ТЗ п.23: "может коррелировать", НЕ жёстко
// связаны, без циклов. Однонаправленно: смена статуса ПРОЕКТА МОНТАЖА может
// подвинуть статус ЗАКАЗА вперёд по воронке; обратного маппинга нет — смена
// статуса заказа (ручной канбан CRM) никогда не переписывает статус проекта
// монтажа, поэтому цикл в принципе невозможен. Возвращает null, если менять
// ничего не нужно (заказ уже не в «Монтаж»/«Правки» — значит, продвинут
// вручную дальше, автоматика его больше не трогает — тот же принцип, что и
// автопереход editingRequired в src/lib/actions/schedule.ts).
// ============================================================

export function mapMontageStatusToOrderStatus(
  montageStatus: MontageStatus, currentOrderStatus: OrderStatus,
): OrderStatus | null {
  if (currentOrderStatus !== 'EDITING' && currentOrderStatus !== 'REVISIONS') return null
  if ((montageStatus === 'AWAITING_REVISIONS' || montageStatus === 'REVISIONS') && currentOrderStatus !== 'REVISIONS') {
    return 'REVISIONS'
  }
  if (montageStatus === 'DELIVERED') return 'COMPLETED'
  return null
}

// ============================================================
// ДАШБОРД (ТЗ п.10) — KPI считаются ОДИН раз здесь из полного списка
// проектов, а не отдельно в каждой карточке/детальном экране (п.32: "не
// создавай montageDashboardCopy/editorIncomeCopy... все показатели
// рассчитываются из проектов"). Раскрытие каждого KPI (п.12) должно
// фильтровать тот же список этими же предикатами, а не считать заново.
// ============================================================

export interface MontageStatsInput {
  status: MontageStatus
  sourceReceivedAt: string | Date | null
  clientAmount: number | null
  editorAmount: number | null
  clientPaymentStatus: MontageClientPaymentStatus
  editorPaymentStatus: MontageEditorPaymentStatus
  editorId: string | null
  deadlineDate: string | Date | null
  deliveredAt: string | Date | null
  effectiveSourceMaterialsUrl: string | null
  mountedMaterialNasUrl: string | null
  title: string | null
  description: string | null
}

export interface MontageDashboardStats {
  deliveredCount: number
  // ISO-дата самого раннего sourceReceivedAt среди ВСЕХ проектов — "отчётность
  // с..." (ТЗ п.10) вычисляется от реальных данных после импорта, не задаётся
  // вручную. null, если проектов с известной датой поступления ещё нет.
  reportingSince: string | null
  revenueTotal: number
  revenuePaid: number
  expensesTotal: number
  expensesPaid: number
  profit: number
  margin: number | null
  activeCount: number
  attentionCount: number
  clientDebt: number
  studioDebt: number
}

// PARTIALLY_PAID считается "в долгу" целиком (а не остатком) — в схеме
// сознательно нет отдельного поля "сколько уже оплачено частично" (ТЗ не
// запрашивал его, только статус), тот же компромисс уже принят в проекте для
// Order.paymentStatus = PARTIALLY_PAID (тоже без отдельной суммы остатка).
const DEBT_CLIENT_STATUSES: MontageClientPaymentStatus[] = ['PENDING', 'PARTIALLY_PAID']
const DEBT_EDITOR_STATUSES: MontageEditorPaymentStatus[] = ['PENDING', 'PARTIALLY_PAID']

export function computeMontageDashboardStats(projects: MontageStatsInput[], now: Date = new Date()): MontageDashboardStats {
  let deliveredCount = 0
  let reportingSince: string | null = null
  let revenueTotal = 0, revenuePaid = 0
  let expensesTotal = 0, expensesPaid = 0
  let activeCount = 0, attentionCount = 0
  let clientDebt = 0, studioDebt = 0

  for (const p of projects) {
    if (MONTAGE_DELIVERED_STATUSES.includes(p.status)) deliveredCount += 1

    if (p.sourceReceivedAt) {
      const iso = new Date(p.sourceReceivedAt).toISOString()
      if (!reportingSince || iso < reportingSince) reportingSince = iso
    }

    if (p.clientAmount != null) {
      revenueTotal += p.clientAmount
      if (p.clientPaymentStatus === 'PAID') revenuePaid += p.clientAmount
      if (DEBT_CLIENT_STATUSES.includes(p.clientPaymentStatus)) clientDebt += p.clientAmount
    }
    if (p.editorAmount != null) {
      expensesTotal += p.editorAmount
      if (p.editorPaymentStatus === 'PAID') expensesPaid += p.editorAmount
      if (DEBT_EDITOR_STATUSES.includes(p.editorPaymentStatus)) studioDebt += p.editorAmount
    }

    if (MONTAGE_ACTIVE_STATUSES.includes(p.status)) activeCount += 1

    const attention = getMontageAttentionReasons({
      status: p.status, editorId: p.editorId, deadlineDate: p.deadlineDate, deliveredAt: p.deliveredAt,
      effectiveSourceMaterialsUrl: p.effectiveSourceMaterialsUrl, mountedMaterialNasUrl: p.mountedMaterialNasUrl,
      clientAmount: p.clientAmount, clientPaymentStatus: p.clientPaymentStatus, title: p.title, description: p.description,
    }, now)
    if (attention.length > 0) attentionCount += 1
  }

  const profit = revenueTotal - expensesTotal
  const margin = revenueTotal > 0 ? profit / revenueTotal : null

  return {
    deliveredCount, reportingSince, revenueTotal, revenuePaid, expensesTotal, expensesPaid,
    profit, margin, activeCount, attentionCount, clientDebt, studioDebt,
  }
}

// ============================================================
// КАРТОЧКА МОНТАЖЁРА (ТЗ п.9) — "верхние показатели" за всё время и
// помесячная аналитика считаются одними и теми же чистыми функциями из
// списка проектов ЭТОГО монтажёра (см. getMontageProjectsForEditor,
// actions/montage.ts) — тот же принцип единого источника, что и
// computeMontageDashboardStats для общего дашборда.
// ============================================================

export interface EditorProjectStatsInput {
  status: MontageStatus
  clientAmount: number | null
  editorAmount: number | null
  editorPaymentStatus: MontageEditorPaymentStatus
  sourceReceivedAt: string | Date | null
  deliveredAt: string | Date | null
  deadlineDate: string | Date | null
}

export interface EditorAllTimeSummary {
  totalProjects: number
  deliveredProjects: number
  activeProjects: number
  // Начислено монтажёру (сумма editorAmount по всем его проектам, независимо
  // от статуса оплаты) — "заработал" в ТЗ понимается как объём выполненной
  // работы, факт выплаты отражён отдельно (paidEarned).
  totalEarned: number
  paidEarned: number
  studioProfit: number
  avgProjectAmount: number | null
  avgTurnaroundDays: number | null
}

function averageTurnaroundDays(projects: Pick<EditorProjectStatsInput, 'sourceReceivedAt' | 'deliveredAt'>[]): number | null {
  const durations = projects
    .filter(p => p.sourceReceivedAt && p.deliveredAt)
    .map(p => (new Date(p.deliveredAt!).getTime() - new Date(p.sourceReceivedAt!).getTime()) / 86_400_000)
  if (durations.length === 0) return null
  return durations.reduce((sum, d) => sum + d, 0) / durations.length
}

export function computeEditorAllTimeSummary(projects: EditorProjectStatsInput[]): EditorAllTimeSummary {
  let deliveredProjects = 0, activeProjects = 0
  let totalEarned = 0, paidEarned = 0, studioProfit = 0
  let amountsKnownCount = 0

  for (const p of projects) {
    if (MONTAGE_DELIVERED_STATUSES.includes(p.status)) deliveredProjects += 1
    if (MONTAGE_ACTIVE_STATUSES.includes(p.status)) activeProjects += 1
    if (p.editorAmount != null) {
      totalEarned += p.editorAmount
      amountsKnownCount += 1
      if (p.editorPaymentStatus === 'PAID') paidEarned += p.editorAmount
    }
    const profit = computeMontageProfit(p.clientAmount, p.editorAmount)
    if (profit != null) studioProfit += profit
  }

  return {
    totalProjects: projects.length,
    deliveredProjects,
    activeProjects,
    totalEarned,
    paidEarned,
    studioProfit,
    avgProjectAmount: amountsKnownCount > 0 ? totalEarned / amountsKnownCount : null,
    avgTurnaroundDays: averageTurnaroundDays(projects),
  }
}

export interface EditorMonthlyStats {
  projectsCount: number
  editorEarned: number
  clientRevenue: number
  studioProfit: number
  deliveredCount: number
  activeCount: number
  avgTurnaroundDays: number | null
  overdueCount: number
}

// monthKey — "YYYY-MM" по sourceReceivedAt проекта (та же дата, что и везде
// в разделе "Монтаж" считается "поступлением в работу"). Проекты без
// sourceReceivedAt не попадают ни в один месяц — как и заказы без даты не
// попадают в группировку по месяцам в order-model.ts.
export function computeEditorMonthlyStats(projects: EditorProjectStatsInput[], selectedMonthKey: string, now: Date = new Date()): EditorMonthlyStats {
  const inMonth = projects.filter(p => p.sourceReceivedAt && monthKey(new Date(p.sourceReceivedAt)) === selectedMonthKey)

  let editorEarned = 0, clientRevenue = 0, studioProfit = 0
  let deliveredCount = 0, activeCount = 0, overdueCount = 0

  for (const p of inMonth) {
    if (p.editorAmount != null) editorEarned += p.editorAmount
    if (p.clientAmount != null) clientRevenue += p.clientAmount
    const profit = computeMontageProfit(p.clientAmount, p.editorAmount)
    if (profit != null) studioProfit += profit
    if (MONTAGE_DELIVERED_STATUSES.includes(p.status)) deliveredCount += 1
    if (MONTAGE_ACTIVE_STATUSES.includes(p.status)) activeCount += 1
    if (isMontageOverdue({ deadlineDate: p.deadlineDate, status: p.status, deliveredAt: p.deliveredAt }, now)) overdueCount += 1
  }

  return {
    projectsCount: inMonth.length,
    editorEarned,
    clientRevenue,
    studioProfit,
    deliveredCount,
    activeCount,
    avgTurnaroundDays: averageTurnaroundDays(inMonth),
    overdueCount,
  }
}

// "1 проект" / "2 проекта" / "5 проектов" — по аналогии с pluralizeOrdersCount
// (order-model.ts), но не переиспользует её напрямую: разные существительные
// с разными формами множественного числа не сводятся к общей функции без
// передачи самого слова, что усложнило бы вызовы больше, чем экономит.
export function pluralizeProjectsCount(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} проект`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} проекта`
  return `${n} проектов`
}
