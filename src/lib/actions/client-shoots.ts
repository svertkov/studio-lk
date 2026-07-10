'use server'

import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import type { PaymentMethod } from '@prisma/client'
import {
  mergeShoots, computeShootsSummary, computeFinanceOverview,
  type ShootVisitInput, type ShootEventInput, type ShootRow, type ShootAmount,
  type ShootsSummaryDTO, type FinanceOverviewDTO,
} from '@/lib/client-shoots-model'

// ============================================================
// АВТОРИЗАЦИЯ
// ============================================================

async function requireStaffSession(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await auth()
    if (!session?.user) return { ok: false, error: 'Требуется авторизация' }
    return { ok: true }
  } catch {
    return { ok: false, error: 'Требуется авторизация' }
  }
}

// ============================================================
// ЕДИНЫЙ СПИСОК «СЪЁМКИ» — слияние ClientVisit (импорт) и ScheduleEvent (живые
// записи) в одну историю без дублей (см. src/lib/client-shoots-model.ts).
// Два запроса к БД (визиты + события), без N+1 — вся дедупликация и подсчёты
// считаются один раз здесь и переиспользуются и вкладкой «Съёмки», и
// вкладкой «Финансы», и заголовком карточки клиента.
// ============================================================

export interface ShootRowDTO {
  id: string
  source: 'schedule' | 'visit'
  scheduleEventId: string | null
  calendarEventId: string | null
  date: string | null
  startAt: string | null
  endAt: string | null
  room: string | null
  format: string | null
  durationHours: number | null
  amount: ShootAmount
  paymentMethod: PaymentMethod | null
  yandexDiskUrl: string | null
  yandexDiskUrlExpiresAt: string | null
  nasBackupUrl: string | null
  comment: string | null
  isCancelled: boolean
  isFuture: boolean
}

export interface ShootsSummaryOutDTO {
  totalShoots: number
  totalHours: number
  lastShootDate: string | null
  avgCheck: number | null
}

function toShootRowDTO(r: ShootRow): ShootRowDTO {
  return {
    id: r.id,
    source: r.source,
    scheduleEventId: r.scheduleEventId,
    calendarEventId: r.calendarEventId,
    date: r.date ? r.date.toISOString() : null,
    startAt: r.startAt ? r.startAt.toISOString() : null,
    endAt: r.endAt ? r.endAt.toISOString() : null,
    room: r.room,
    format: r.format,
    durationHours: r.durationHours,
    amount: r.amount,
    paymentMethod: r.paymentMethod,
    yandexDiskUrl: r.yandexDiskUrl,
    yandexDiskUrlExpiresAt: r.yandexDiskUrlExpiresAt ? r.yandexDiskUrlExpiresAt.toISOString() : null,
    nasBackupUrl: r.nasBackupUrl,
    comment: r.comment,
    isCancelled: r.isCancelled,
    isFuture: r.isFuture,
  }
}

function toSummaryDTO(s: ShootsSummaryDTO): ShootsSummaryOutDTO {
  return {
    totalShoots: s.totalShoots,
    totalHours: s.totalHours,
    lastShootDate: s.lastShootDate ? s.lastShootDate.toISOString() : null,
    avgCheck: s.avgCheck,
  }
}

async function loadShootRows(clientId: string): Promise<ShootRow[]> {
  const [visits, events] = await Promise.all([
    prisma.clientVisit.findMany({
      where: { clientId },
      select: { id: true, date: true, startAt: true, endAt: true, room: true, format: true, durationHours: true, grossAmount: true, netAmount: true, comment: true },
    }),
    prisma.scheduleEvent.findMany({
      where: { clientId, eventType: 'STUDIO_BOOKING' },
      select: {
        id: true, calendarEventId: true, startAt: true, endAt: true, room: true, format: true,
        estimatedPrice: true, paymentMethod: true, yandexDiskUrl: true, yandexDiskUrlExpiresAt: true,
        nasBackupUrl: true, notes: true,
        subscriptionUsage: { select: { usedHours: true } },
        order: { select: { status: true } },
      },
    }),
  ])

  const visitInputs: ShootVisitInput[] = visits
  const eventInputs: ShootEventInput[] = events.map(e => ({
    id: e.id,
    calendarEventId: e.calendarEventId,
    startAt: e.startAt,
    endAt: e.endAt,
    room: e.room,
    format: e.format,
    estimatedPrice: e.estimatedPrice,
    paymentMethod: e.paymentMethod,
    yandexDiskUrl: e.yandexDiskUrl,
    yandexDiskUrlExpiresAt: e.yandexDiskUrlExpiresAt,
    nasBackupUrl: e.nasBackupUrl,
    notes: e.notes,
    subscriptionUsedHours: e.subscriptionUsage?.usedHours ?? null,
    orderStatus: e.order?.status ?? null,
  }))

  return mergeShoots(visitInputs, eventInputs)
}

export async function getClientShootsData(clientId: string): Promise<
  { ok: true; data: { shoots: ShootRowDTO[]; summary: ShootsSummaryOutDTO } }
  | { ok: false; data: { shoots: ShootRowDTO[]; summary: ShootsSummaryOutDTO }; error: string }
> {
  const authResult = await requireStaffSession()
  const empty = { shoots: [], summary: { totalShoots: 0, totalHours: 0, lastShootDate: null, avgCheck: null } }
  if (!authResult.ok) return { ok: false, data: empty, error: authResult.error }

  try {
    const rows = await loadShootRows(clientId)
    return {
      ok: true,
      data: { shoots: rows.map(toShootRowDTO), summary: toSummaryDTO(computeShootsSummary(rows)) },
    }
  } catch (e) {
    console.error('[getClientShootsData]', e)
    return { ok: false, data: empty, error: 'Не удалось загрузить историю съёмок клиента' }
  }
}

// ============================================================
// ФИНАНСОВЫЙ ОБЗОР КЛИЕНТА — деньги, полученные от клиента, без двойного
// учёта покупки абонемента (см. computeFinanceOverview). Переиспользует тот
// же единый список съёмок, что и getClientShootsData.
// ============================================================

export interface FinanceOverviewOutDTO {
  subscriptionPurchasesTotal: number
  oneTimePaymentsTotal: number
  refundsTotal: number
  totalReceived: number
  netReceived: number
  segments: { label: string; value: number; date: string | null }[]
}

function toFinanceOverviewDTO(o: FinanceOverviewDTO): FinanceOverviewOutDTO {
  return {
    ...o,
    segments: o.segments.map(s => ({ label: s.label, value: s.value, date: s.date ? s.date.toISOString() : null })),
  }
}

export async function getClientFinanceOverview(clientId: string): Promise<
  { ok: true; data: FinanceOverviewOutDTO } | { ok: false; data: FinanceOverviewOutDTO; error: string }
> {
  const authResult = await requireStaffSession()
  const empty: FinanceOverviewOutDTO = {
    subscriptionPurchasesTotal: 0, oneTimePaymentsTotal: 0, refundsTotal: 0, totalReceived: 0, netReceived: 0, segments: [],
  }
  if (!authResult.ok) return { ok: false, data: empty, error: authResult.error }

  try {
    const [rows, subscriptions] = await Promise.all([
      loadShootRows(clientId),
      prisma.clientSubscription.findMany({
        where: { clientId },
        select: { id: true, paidAmount: true, status: true, refundAmount: true },
      }),
    ])

    return { ok: true, data: toFinanceOverviewDTO(computeFinanceOverview(subscriptions, rows)) }
  } catch (e) {
    console.error('[getClientFinanceOverview]', e)
    return { ok: false, data: empty, error: 'Не удалось загрузить финансовый обзор клиента' }
  }
}
