'use server'

import { prisma } from '@/lib/prisma'
import { computeVisitStats, type VisitStats } from '@/lib/visit-stats'
import type { SubscriptionStatus } from '@prisma/client'
import { SUBSCRIPTION_LOW_HOURS_THRESHOLD, displayRemainingHours } from '@/lib/subscription-model'

// ============================================================
// СВОДКА ПО ВЫРУЧКЕ (управленческая, не бухгалтерская)
// Считается на лету по всей истории ClientVisit — той же таблице, куда уже
// импортирована реальная выручка студии из Google-таблицы. netAmount берётся
// из таблицы как есть (источник истины), без пересчёта налогов/эквайринга.
// ============================================================

export async function getFinanceSummary(): Promise<
  { ok: true; data: VisitStats } | { ok: false; data: VisitStats; error: string }
> {
  const empty: VisitStats = {
    totalVisits: 0, totalHours: 0, grossTotal: null, netTotal: null,
    avgCheck: null, avgDurationHours: null, firstVisit: null, lastVisit: null,
    byRoom: [], byFormat: [],
  }
  try {
    const visits = await prisma.clientVisit.findMany({
      select: { date: true, room: true, format: true, durationHours: true, grossAmount: true, netAmount: true },
    })
    return { ok: true, data: computeVisitStats(visits) }
  } catch (e) {
    console.error('[getFinanceSummary]', e)
    return { ok: false, data: empty, error: 'Не удалось загрузить сводку по выручке' }
  }
}

// ============================================================
// СВОДКА ПО АБОНЕМЕНТАМ (все клиенты) — активные абонементы и суммарный остаток часов
// ============================================================

export interface SubscriptionsSummary {
  activeCount: number
  remainingHoursTotal: number
  soonToExpireCount: number // осталось ≤ 2 часов — стоит предупредить клиента заранее
}

export async function getSubscriptionsSummary(): Promise<
  { ok: true; data: SubscriptionsSummary } | { ok: false; data: SubscriptionsSummary; error: string }
> {
  const empty: SubscriptionsSummary = { activeCount: 0, remainingHoursTotal: 0, soonToExpireCount: 0 }
  try {
    // isArchived: false — заархивированный ACTIVE-абонемент (архивация не
    // трогает status, см. subscription-model.ts) не должен ни считаться в
    // сводке, ни триггерить предупреждение "скоро закончится": он уже скрыт
    // из активных списков, к нему нет смысла привлекать внимание.
    const rows = await prisma.clientSubscription.findMany({
      where: { status: 'ACTIVE', isArchived: false },
      include: { usages: true },
    })

    let remainingHoursTotal = 0
    let soonToExpireCount = 0
    for (const row of rows) {
      const used = row.openingUsedHours + row.usages.reduce((sum, u) => sum + u.usedHours, 0)
      const remaining = row.packageHours - used
      remainingHoursTotal += remaining
      if (remaining <= SUBSCRIPTION_LOW_HOURS_THRESHOLD) soonToExpireCount++
    }

    return { ok: true, data: { activeCount: rows.length, remainingHoursTotal, soonToExpireCount } }
  } catch (e) {
    console.error('[getSubscriptionsSummary]', e)
    return { ok: false, data: empty, error: 'Не удалось загрузить сводку по абонементам' }
  }
}

// ============================================================
// ВИЗИТЫ — короткая лента для раздела "Финансы" и полный отчёт по клику
// ============================================================

export interface RecentVisitDTO {
  id: string
  clientId: string
  clientName: string
  date: string | null
  room: string | null
  format: string | null
  durationHours: number | null
  grossAmount: number | null
  netAmount: number | null
  comment: string | null
}

function toRecentVisitDTO(r: {
  id: string; clientId: string; date: Date | null; room: string | null; format: string | null
  durationHours: number | null; grossAmount: number | null; netAmount: number | null; comment: string | null
  client: { name: string }
}): RecentVisitDTO {
  return {
    id: r.id,
    clientId: r.clientId,
    clientName: r.client.name,
    date: r.date ? r.date.toISOString() : null,
    room: r.room,
    format: r.format,
    durationHours: r.durationHours,
    grossAmount: r.grossAmount,
    netAmount: r.netAmount,
    comment: r.comment,
  }
}

export async function getRecentVisits(limit = 10): Promise<
  { ok: true; data: RecentVisitDTO[] } | { ok: false; data: RecentVisitDTO[]; error: string }
> {
  try {
    const rows = await prisma.clientVisit.findMany({
      orderBy: { date: 'desc' },
      take: limit,
      include: { client: { select: { name: true } } },
    })
    return { ok: true, data: rows.map(toRecentVisitDTO) }
  } catch (e) {
    console.error('[getRecentVisits]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить последние визиты' }
  }
}

// Полный список визитов (без ограничения) — для страницы подробного отчёта,
// куда ведут клики с агрегированных карточек на главной странице "Финансы".
export async function getAllVisits(): Promise<
  { ok: true; data: RecentVisitDTO[] } | { ok: false; data: RecentVisitDTO[]; error: string }
> {
  try {
    const rows = await prisma.clientVisit.findMany({
      orderBy: { date: 'desc' },
      include: { client: { select: { name: true } } },
    })
    return { ok: true, data: rows.map(toRecentVisitDTO) }
  } catch (e) {
    console.error('[getAllVisits]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить визиты' }
  }
}

// ============================================================
// ВСЕ АБОНЕМЕНТЫ (все клиенты) — для страницы подробной аналитики
// ============================================================

export interface SubscriptionRow {
  id: string
  clientId: string
  clientName: string
  packageHours: number
  paidAmount: number | null
  purchasedAt: string
  status: SubscriptionStatus
  statusUpdatedAt: string
  usedAt: string | null
  cancelledAt: string | null
  refundedAt: string | null
  cancellationReason: string | null
  refundAmount: number | null
  refundReason: string | null
  adminComment: string | null
  isArchived: boolean
  archivedAt: string | null
  usedHours: number
  remainingHours: number
  usagesCount: number
}

export async function getAllSubscriptions(): Promise<
  { ok: true; data: SubscriptionRow[] } | { ok: false; data: SubscriptionRow[]; error: string }
> {
  try {
    const rows = await prisma.clientSubscription.findMany({
      orderBy: { purchasedAt: 'desc' },
      include: { usages: true, client: { select: { name: true } } },
    })
    return { ok: true, data: rows.map(toSubscriptionRow) }
  } catch (e) {
    console.error('[getAllSubscriptions]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить абонементы' }
  }
}

function toSubscriptionRow(r: {
  id: string; clientId: string; packageHours: number; openingUsedHours: number; paidAmount: number | null
  purchasedAt: Date; status: SubscriptionStatus; statusUpdatedAt: Date
  usedAt: Date | null; cancelledAt: Date | null; refundedAt: Date | null
  cancellationReason: string | null; refundAmount: number | null; refundReason: string | null
  adminComment: string | null; isArchived: boolean; archivedAt: Date | null
  usages: { usedHours: number }[]; client: { name: string }
}): SubscriptionRow {
  const usedHours = r.openingUsedHours + r.usages.reduce((sum, u) => sum + u.usedHours, 0)
  return {
    id: r.id,
    clientId: r.clientId,
    clientName: r.client.name,
    packageHours: r.packageHours,
    paidAmount: r.paidAmount,
    purchasedAt: r.purchasedAt.toISOString(),
    status: r.status,
    statusUpdatedAt: r.statusUpdatedAt.toISOString(),
    usedAt: r.usedAt ? r.usedAt.toISOString() : null,
    cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
    refundedAt: r.refundedAt ? r.refundedAt.toISOString() : null,
    cancellationReason: r.cancellationReason,
    refundAmount: r.refundAmount,
    refundReason: r.refundReason,
    adminComment: r.adminComment,
    isArchived: r.isArchived,
    archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
    usedHours,
    remainingHours: displayRemainingHours(r.status, r.packageHours - usedHours),
    usagesCount: r.usages.length,
  }
}

// ============================================================
// АНАЛИТИКА АБОНЕМЕНТОВ — сводные показатели + список для страницы
// "Аналитика абонементов" (детальный экран по клику на карточку/warning на дашборде)
// ============================================================

export interface SubscriptionsAnalytics {
  activeCount: number // ACTIVE и не в архиве — реально доступные для выбора
  usedUpCount: number
  cancelledCount: number
  refundedCount: number
  archivedCount: number // isArchived, независимо от status
  totalCount: number
  hoursSoldTotal: number
  hoursUsedTotal: number
  hoursRemainingTotal: number // только у активных (не архивных)
  paidTotal: number
  avgRemainingActive: number | null
}

export async function getSubscriptionsAnalytics(): Promise<
  { ok: true; data: { summary: SubscriptionsAnalytics; rows: SubscriptionRow[] } }
  | { ok: false; data: { summary: SubscriptionsAnalytics; rows: SubscriptionRow[] }; error: string }
> {
  const emptySummary: SubscriptionsAnalytics = {
    activeCount: 0, usedUpCount: 0, cancelledCount: 0, refundedCount: 0, archivedCount: 0, totalCount: 0,
    hoursSoldTotal: 0, hoursUsedTotal: 0, hoursRemainingTotal: 0, paidTotal: 0, avgRemainingActive: null,
  }
  try {
    const rawRows = await prisma.clientSubscription.findMany({
      orderBy: { purchasedAt: 'desc' },
      include: { usages: true, client: { select: { name: true } } },
    })
    const rows = rawRows.map(toSubscriptionRow)

    const activeRows = rows.filter(r => r.status === 'ACTIVE' && !r.isArchived)
    const summary: SubscriptionsAnalytics = {
      activeCount: activeRows.length,
      usedUpCount: rows.filter(r => r.status === 'USED_UP').length,
      cancelledCount: rows.filter(r => r.status === 'CANCELLED').length,
      refundedCount: rows.filter(r => r.status === 'REFUNDED').length,
      archivedCount: rows.filter(r => r.isArchived).length,
      totalCount: rows.length,
      hoursSoldTotal: rows.reduce((sum, r) => sum + r.packageHours, 0),
      hoursUsedTotal: rows.reduce((sum, r) => sum + r.usedHours, 0),
      hoursRemainingTotal: activeRows.reduce((sum, r) => sum + r.remainingHours, 0),
      paidTotal: rows.reduce((sum, r) => sum + (r.paidAmount ?? 0), 0),
      avgRemainingActive: activeRows.length > 0
        ? activeRows.reduce((sum, r) => sum + r.remainingHours, 0) / activeRows.length
        : null,
    }

    return { ok: true, data: { summary, rows } }
  } catch (e) {
    console.error('[getSubscriptionsAnalytics]', e)
    return { ok: false, data: { summary: emptySummary, rows: [] }, error: 'Не удалось загрузить аналитику абонементов' }
  }
}

// ============================================================
// КАРТОЧКА ОДНОГО АБОНЕМЕНТА — вместе с историей списаний
// ============================================================

export interface SubscriptionUsageDetailDTO {
  id: string
  usedHours: number
  usedAt: string
  createdAt: string
  updatedAt: string
  comment: string | null
  eventTitle: string | null
  eventRoom: string | null
  eventFormat: string | null
  calendarEventId: string | null
}

export interface SubscriptionDetailDTO {
  id: string
  clientId: string
  clientName: string
  packageHours: number
  paidAmount: number | null
  purchasedAt: string
  status: SubscriptionStatus
  statusUpdatedAt: string
  usedAt: string | null
  cancelledAt: string | null
  refundedAt: string | null
  cancellationReason: string | null
  refundAmount: number | null
  refundReason: string | null
  adminComment: string | null
  isArchived: boolean
  archivedAt: string | null
  notes: string | null
  usedHours: number
  remainingHours: number
  usages: SubscriptionUsageDetailDTO[]
}

export async function getSubscriptionDetail(id: string): Promise<
  { ok: true; data: SubscriptionDetailDTO } | { ok: false; data: null; error: string }
> {
  try {
    const row = await prisma.clientSubscription.findUnique({
      where: { id },
      include: {
        client: { select: { name: true } },
        usages: {
          orderBy: { usedAt: 'desc' },
          include: { scheduleEvent: { select: { title: true, room: true, format: true, calendarEventId: true } } },
        },
      },
    })
    if (!row) return { ok: false, data: null, error: 'Абонемент не найден' }

    const usedHours = row.openingUsedHours + row.usages.reduce((sum, u) => sum + u.usedHours, 0)
    return {
      ok: true,
      data: {
        id: row.id,
        clientId: row.clientId,
        clientName: row.client.name,
        packageHours: row.packageHours,
        paidAmount: row.paidAmount,
        purchasedAt: row.purchasedAt.toISOString(),
        status: row.status,
        statusUpdatedAt: row.statusUpdatedAt.toISOString(),
        usedAt: row.usedAt ? row.usedAt.toISOString() : null,
        cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
        refundedAt: row.refundedAt ? row.refundedAt.toISOString() : null,
        cancellationReason: row.cancellationReason,
        refundAmount: row.refundAmount,
        refundReason: row.refundReason,
        adminComment: row.adminComment,
        isArchived: row.isArchived,
        archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
        notes: row.notes,
        usedHours,
        remainingHours: displayRemainingHours(row.status, row.packageHours - usedHours),
        usages: row.usages.map(u => ({
          id: u.id,
          usedHours: u.usedHours,
          usedAt: u.usedAt.toISOString(),
          createdAt: u.createdAt.toISOString(),
          updatedAt: u.updatedAt.toISOString(),
          comment: u.comment,
          eventTitle: u.scheduleEvent?.title ?? null,
          eventRoom: u.scheduleEvent?.room ?? null,
          eventFormat: u.scheduleEvent?.format ?? null,
          calendarEventId: u.scheduleEvent?.calendarEventId ?? null,
        })),
      },
    }
  } catch (e) {
    console.error('[getSubscriptionDetail]', e)
    return { ok: false, data: null, error: 'Не удалось загрузить абонемент' }
  }
}
