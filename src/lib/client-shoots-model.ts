// Единая модель "Съёмки" в карточке клиента — объединяет исторические визиты
// (ClientVisit, импорт из Google-таблиц) и живые записи расписания
// (ScheduleEvent) в один список без дублей. Чистые функции без обращения к
// Prisma/БД — вся выборка данных живёт в src/lib/actions/client-shoots.ts,
// здесь только детерминированная логика слияния и подсчётов, чтобы её можно
// было покрыть модульными тестами (см. client-shoots-model.test.ts).

import type { PaymentMethod } from '@prisma/client'

export type { PaymentMethod }

export type ShootAmountKind = 'amount' | 'subscription' | 'free' | 'unpaid' | 'unknown'

export interface ShootAmount {
  kind: ShootAmountKind
  // Заполнено только для kind === 'amount' (и 'free', где всегда 0) —
  // для 'subscription'/'unpaid'/'unknown' сумма неизвестна или неприменима,
  // отображается текстовым статусом, а не числом (см. ТЗ, часть 4).
  amount: number | null
  subscriptionHours?: number | null
}

export type ShootSource = 'schedule' | 'visit'

export interface ShootRow {
  id: string
  source: ShootSource
  scheduleEventId: string | null
  calendarEventId: string | null
  visitId: string | null
  date: Date | null
  startAt: Date | null
  endAt: Date | null
  room: string | null
  format: string | null
  durationHours: number | null
  amount: ShootAmount
  // Способ оплаты — только для отображения ("Картой"/"Наличными"...) в списке
  // оплат вкладки «Финансы» (ТЗ, часть 7); категоризация суммы (amount.kind)
  // не зависит от этого поля напрямую, см. categorizeShootAmount.
  paymentMethod: PaymentMethod | null
  yandexDiskUrl: string | null
  // Момент, до которого ссылка на Яндекс.Диск считается действующей — уже
  // хранится на ScheduleEvent (computeYandexLinkExpiry, schedule-model.ts),
  // пересчитывается там же при каждом сохранении ссылки. Здесь только
  // прокидывается, чтобы капсула "Материалы" могла показать актуальное
  // активна/истекла состояние без повторного вычисления даты истечения.
  yandexDiskUrlExpiresAt: Date | null
  nasBackupUrl: string | null
  // См. ScheduleEvent.yandexLinkRequired/nasLinkRequired — исторические визиты
  // (source: 'visit', без связанного ScheduleEvent) не имеют этого понятия,
  // всегда true (то же значение по умолчанию, что и у самого поля).
  yandexLinkRequired: boolean
  nasLinkRequired: boolean
  comment: string | null
  isCancelled: boolean
  isFuture: boolean
  // Предварительное бронирование гримёра перед этой съёмкой, в минутах — null,
  // если не указано (ClientVisit-only строки тоже всегда null, у исторических
  // визитов такого понятия не было). Источник — ScheduleEvent.makeupDurationMinutes,
  // не отдельно хранимое время (см. computeMakeupInterval, schedule-model.ts).
  makeupDurationMinutes: number | null
}

export interface ShootVisitInput {
  id: string
  date: Date | null
  // Восстановлены backfill-скриптом для старых визитов (или сразу заполнены
  // при импорте, см. extractTimeRange) — могут быть null, если время в
  // исходной таблице объективно не выделяется однозначно.
  startAt: Date | null
  endAt: Date | null
  room: string | null
  format: string | null
  durationHours: number | null
  grossAmount: number | null
  netAmount: number | null
  comment: string | null
}

export interface ShootEventInput {
  id: string
  calendarEventId: string | null
  startAt: Date | null
  endAt: Date | null
  room: string | null
  format: string | null
  estimatedPrice: number | null
  paymentMethod: PaymentMethod | null
  yandexDiskUrl: string | null
  yandexDiskUrlExpiresAt: Date | null
  nasBackupUrl: string | null
  yandexLinkRequired: boolean
  nasLinkRequired: boolean
  notes: string | null
  makeupDurationMinutes: number | null
  subscriptionUsedHours: number | null
  // Статус связанного заказа (Order.status), если запись была создана из
  // заказа — единственный существующий в схеме сигнал "эта съёмка отменена"
  // (у самого ScheduleEvent нет отдельного статуса отмены). null — заказа нет.
  orderStatus: string | null
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function computeEventDuration(e: ShootEventInput): number | null {
  if (e.startAt && e.endAt) {
    const ms = e.endAt.getTime() - e.startAt.getTime()
    return ms > 0 ? ms / 3_600_000 : null
  }
  return null
}

// Та же эвристика, что и раньше в ClientTabs.tsx (matchBookingForVisit), но
// теперь исключает уже занятые события — иначе два визита в один день на два
// разных зала могли бы оба "прилипнуть" к единственному реальному событию.
function findMatchingEvent(
  visit: ShootVisitInput, events: ShootEventInput[], usedEventIds: Set<string>
): ShootEventInput | null {
  if (!visit.date) return null
  const key = dayKey(visit.date)
  const candidates = events.filter(e => !usedEventIds.has(e.id) && e.startAt && dayKey(e.startAt) === key)
  if (candidates.length <= 1) return candidates[0] ?? null
  const refined = candidates.filter(e => (!visit.room || e.room === visit.room) && (!visit.format || e.format === visit.format))
  return refined[0] ?? candidates[0]
}

export function categorizeShootAmount(input: {
  hasSubscriptionUsage: boolean
  subscriptionUsedHours: number | null
  paymentMethod: PaymentMethod | null
  estimatedPrice: number | null
  visitGrossAmount: number | null
}): ShootAmount {
  if (input.hasSubscriptionUsage) {
    return { kind: 'subscription', amount: null, subscriptionHours: input.subscriptionUsedHours }
  }
  if (input.paymentMethod === 'FREE') {
    return { kind: 'free', amount: 0 }
  }
  if (input.paymentMethod === 'UNPAID') {
    return { kind: 'unpaid', amount: null }
  }
  if (input.estimatedPrice != null) {
    return { kind: 'amount', amount: input.estimatedPrice }
  }
  if (input.visitGrossAmount != null) {
    return { kind: 'amount', amount: input.visitGrossAmount }
  }
  return { kind: 'unknown', amount: null }
}

// Слияние истории визитов и живых записей расписания в один список без
// дублей (ТЗ, часть 1). Правило: у каждого ScheduleEvent — ровно одна строка;
// визит, сопоставленный с событием по дню (+залу/формату при неоднозначности),
// дополняет эту же строку (резервные поля + добавление старого комментария),
// а не создаёт вторую. Несопоставленный визит — отдельная строка без
// внутренней ссылки (ТЗ, часть 10: такие строки нельзя скрывать).
export function mergeShoots(
  visits: ShootVisitInput[], events: ShootEventInput[], now: Date = new Date()
): ShootRow[] {
  const usedEventIds = new Set<string>()
  const eventRowById = new Map<string, ShootRow>()

  for (const e of events) {
    const isCancelled = e.orderStatus === 'CANCELLED'
    const isFuture = e.startAt != null && e.startAt.getTime() > now.getTime()
    eventRowById.set(e.id, {
      id: `event:${e.id}`,
      source: 'schedule',
      scheduleEventId: e.id,
      calendarEventId: e.calendarEventId,
      visitId: null,
      date: e.startAt,
      startAt: e.startAt,
      endAt: e.endAt,
      room: e.room,
      format: e.format,
      durationHours: computeEventDuration(e),
      amount: categorizeShootAmount({
        hasSubscriptionUsage: e.subscriptionUsedHours != null,
        subscriptionUsedHours: e.subscriptionUsedHours,
        paymentMethod: e.paymentMethod,
        estimatedPrice: e.estimatedPrice,
        visitGrossAmount: null,
      }),
      paymentMethod: e.paymentMethod,
      yandexDiskUrl: e.yandexDiskUrl,
      yandexDiskUrlExpiresAt: e.yandexDiskUrlExpiresAt,
      nasBackupUrl: e.nasBackupUrl,
      yandexLinkRequired: e.yandexLinkRequired,
      nasLinkRequired: e.nasLinkRequired,
      comment: e.notes,
      isCancelled,
      isFuture,
      makeupDurationMinutes: e.makeupDurationMinutes,
    })
  }

  const standaloneVisitRows: ShootRow[] = []

  for (const v of visits) {
    const matched = findMatchingEvent(v, events, usedEventIds)
    if (matched) {
      usedEventIds.add(matched.id)
      const row = eventRowById.get(matched.id)!
      row.visitId = v.id
      if (row.durationHours == null) row.durationHours = v.durationHours
      // ScheduleEvent — источник правды по времени (реальный календарь), визит
      // используется только как резерв, если у события своего времени почему-то нет.
      if (row.startAt == null) row.startAt = v.startAt
      if (row.endAt == null) row.endAt = v.endAt
      if (row.amount.kind === 'unknown' && v.grossAmount != null) {
        row.amount = { kind: 'amount', amount: v.grossAmount }
      }
      if (v.comment && v.comment !== row.comment) {
        row.comment = [row.comment, v.comment].filter(Boolean).join(' · ')
      }
    } else {
      standaloneVisitRows.push({
        id: `visit:${v.id}`,
        source: 'visit',
        scheduleEventId: null,
        calendarEventId: null,
        visitId: v.id,
        date: v.date,
        startAt: v.startAt,
        endAt: v.endAt,
        room: v.room,
        format: v.format,
        durationHours: v.durationHours,
        amount: categorizeShootAmount({
          hasSubscriptionUsage: false,
          subscriptionUsedHours: null,
          paymentMethod: null,
          estimatedPrice: null,
          visitGrossAmount: v.grossAmount,
        }),
        paymentMethod: null,
        yandexDiskUrl: null,
        yandexDiskUrlExpiresAt: null,
        nasBackupUrl: null,
        yandexLinkRequired: true,
        nasLinkRequired: true,
        comment: v.comment,
        isCancelled: false,
        isFuture: false,
        makeupDurationMinutes: null,
      })
    }
  }

  const rows = [...eventRowById.values(), ...standaloneVisitRows]
  return rows.sort((a, b) => {
    const ta = (a.date ?? a.startAt)?.getTime() ?? 0
    const tb = (b.date ?? b.startAt)?.getTime() ?? 0
    return tb - ta
  })
}

// ============================================================
// КОЛОНКА "МАТЕРИАЛЫ" — активна/истекла/отсутствует, без завязки на React.
// Проверка валидности самого значения URL (isValidHttpUrl) — забота UI-слоя;
// сюда должны приходить уже проверенные значения (null, если ссылка битая).
// ============================================================

export type MaterialsLinkState = 'active' | 'expired' | null

export interface MaterialsCapsulesState {
  yandex: MaterialsLinkState
  nas: 'active' | null
}

export function computeMaterialsCapsules(
  input: { yandexDiskUrl: string | null; yandexDiskUrlExpiresAt: Date | null; nasBackupUrl: string | null },
  now: Date = new Date()
): MaterialsCapsulesState {
  const yandex: MaterialsLinkState = input.yandexDiskUrl
    ? (input.yandexDiskUrlExpiresAt && input.yandexDiskUrlExpiresAt.getTime() <= now.getTime() ? 'expired' : 'active')
    : null
  const nas: 'active' | null = input.nasBackupUrl ? 'active' : null
  return { yandex, nas }
}

// ============================================================
// "ПОКАЗАТЬ 5 / ПОКАЗАТЬ ВСЕ" — сколько строк таблицы рендерить по умолчанию.
// ============================================================

export const SHOOTS_TABLE_DEFAULT_LIMIT = 5

export function getVisibleShoots<T>(shoots: T[], expanded: boolean, limit: number = SHOOTS_TABLE_DEFAULT_LIMIT): T[] {
  return expanded ? shoots : shoots.slice(0, limit)
}

export function getHiddenShootsCount(total: number, limit: number = SHOOTS_TABLE_DEFAULT_LIMIT): number {
  return Math.max(0, total - limit)
}

export interface ShootsSummaryDTO {
  totalShoots: number
  totalHours: number
  lastShootDate: Date | null
  avgCheck: number | null
  // Суммарное время гримёра по всем фактическим съёмкам клиента, в минутах —
  // отдельный показатель, никогда не прибавляется к totalHours (ТЗ: "основные
  // часы съёмки и время гримёра должны оставаться разными показателями").
  totalMakeupMinutes: number
}

// Показатели считаются только по фактически состоявшимся съёмкам: без
// отменённых (связанный заказ в статусе CANCELLED) и без будущих (ТЗ, часть 8).
export function computeShootsSummary(rows: ShootRow[]): ShootsSummaryDTO {
  const actual = rows.filter(r => !r.isCancelled && !r.isFuture)
  const totalHours = actual.reduce((s, r) => s + (r.durationHours ?? 0), 0)
  const totalMakeupMinutes = actual.reduce((s, r) => s + (r.makeupDurationMinutes ?? 0), 0)
  const knownAmounts = actual
    .map(r => (r.amount.kind === 'amount' ? r.amount.amount : null))
    .filter((v): v is number => v != null)
  const avgCheck = knownAmounts.length > 0
    ? knownAmounts.reduce((s, v) => s + v, 0) / knownAmounts.length
    : null
  const dates = actual
    .map(r => r.date)
    .filter((d): d is Date => d != null)
    .sort((a, b) => b.getTime() - a.getTime())

  return {
    totalShoots: actual.length,
    totalHours,
    lastShootDate: dates[0] ?? null,
    avgCheck,
    totalMakeupMinutes,
  }
}

export interface SubscriptionPurchaseInput {
  id: string
  paidAmount: number | null
  status: string
  refundAmount: number | null
}

export interface FinanceSegment {
  label: string
  value: number
  date?: Date | null
}

export interface FinanceOverviewDTO {
  subscriptionPurchasesTotal: number
  oneTimePaymentsTotal: number
  refundsTotal: number
  totalReceived: number
  netReceived: number
  segments: FinanceSegment[]
}

// Сколько отдельных разовых оплат показывать сегментами кольцевой диаграммы
// по отдельности, прежде чем сворачивать их в одну категорию "Разовые оплаты"
// (ТЗ, часть 7: "не делай диаграмму из десятков нечитаемых сегментов").
const SEGMENT_DETAIL_THRESHOLD = 6

// Деньги, полученные от клиента — единый расчёт без двойного учёта (ТЗ, часть
// 7/9): покупка абонемента учитывается ОДИН раз в момент покупки
// (ClientSubscription.paidAmount), а не на каждой съёмке, оплаченной из него
// (такие съёмки в shoots помечены kind:'subscription' и не несут суммы).
export function computeFinanceOverview(
  subscriptions: SubscriptionPurchaseInput[], shoots: ShootRow[]
): FinanceOverviewDTO {
  const subscriptionPurchasesTotal = subscriptions.reduce((s, sub) => s + (sub.paidAmount ?? 0), 0)
  const refundsTotal = subscriptions.reduce(
    (s, sub) => s + (sub.status === 'REFUNDED' ? (sub.refundAmount ?? 0) : 0), 0
  )

  // Только фактически состоявшиеся съёмки — так же, как в computeShootsSummary:
  // отменённая или ещё не состоявшаяся съёмка не должна прибавлять деньги
  // к "Получено всего", даже если у неё почему-то указана сумма.
  const oneTimeRows = shoots.filter(r => !r.isCancelled && !r.isFuture && (r.amount.kind === 'amount' || r.amount.kind === 'free'))
  const oneTimePaymentsTotal = oneTimeRows.reduce((s, r) => s + (r.amount.amount ?? 0), 0)

  const totalReceived = subscriptionPurchasesTotal + oneTimePaymentsTotal
  const netReceived = totalReceived - refundsTotal

  const segments: FinanceSegment[] = []
  if (subscriptionPurchasesTotal > 0) segments.push({ label: 'Абонементы', value: subscriptionPurchasesTotal })

  const paidOneTimeRows = oneTimeRows.filter(r => (r.amount.amount ?? 0) > 0)
  if (paidOneTimeRows.length > 0 && paidOneTimeRows.length <= SEGMENT_DETAIL_THRESHOLD) {
    for (const r of paidOneTimeRows) {
      segments.push({ label: r.format ?? 'Съёмка', value: r.amount.amount ?? 0, date: r.date })
    }
  } else if (paidOneTimeRows.length > 0) {
    const total = paidOneTimeRows.reduce((s, r) => s + (r.amount.amount ?? 0), 0)
    segments.push({ label: 'Разовые оплаты', value: total })
  }

  return { subscriptionPurchasesTotal, oneTimePaymentsTotal, refundsTotal, totalReceived, netReceived, segments }
}
