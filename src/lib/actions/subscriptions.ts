'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import type { ClientSubscription, SubscriptionStatus, SubscriptionUsage, Prisma } from '@prisma/client'
import { canAutoRecomputeStatus, displayRemainingHours } from '@/lib/subscription-model'

// ============================================================
// АВТОРИЗАЦИЯ
// ============================================================

async function requireStaffSession(): Promise<{ ok: true; userId: string | null } | { ok: false; error: string }> {
  try {
    const session = await auth()
    if (!session?.user) return { ok: false, error: 'Требуется авторизация' }
    return { ok: true, userId: session.user.id ?? null }
  } catch {
    return { ok: false, error: 'Требуется авторизация' }
  }
}

async function writeAuditLog(params: { userId: string | null; action: string; entityId: string; metadata?: Record<string, unknown> }) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entityType: 'ClientSubscription',
        entityId: params.entityId,
        metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
      },
    })
  } catch {
    // Не блокируем основную операцию, если лог не записался
  }
}

// Ревалидация всех разделов, где отображается этот же абонемент — единая
// точка, чтобы не забывать какой-то из путей при добавлении нового потребителя
// (см. ТЗ: "не должно быть отдельных копий абонемента в разных разделах").
function revalidateSubscriptionConsumers(clientId: string) {
  revalidatePath(`/admin/clients/${clientId}`)
  revalidatePath('/admin/finance/subscriptions')
  revalidatePath('/admin/schedule')
  revalidatePath('/admin/crm')
  revalidatePath('/admin/orders')
}

// ============================================================
// СЕРИАЛИЗАЦИЯ
// ============================================================

type UsageWithEvent = SubscriptionUsage & { scheduleEvent: { title: string | null } }
type SubscriptionWithUsages = ClientSubscription & { usages: UsageWithEvent[] }

export interface SubscriptionUsageDTO {
  id: string
  scheduleEventId: string
  usedHours: number
  usedAt: string
  updatedAt: string
  comment: string | null
  eventTitle: string | null
}

export interface ClientSubscriptionDTO {
  id: string
  clientId: string
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
  usages: SubscriptionUsageDTO[]
}

function toDTO(row: SubscriptionWithUsages): ClientSubscriptionDTO {
  const usedHours = row.openingUsedHours + row.usages.reduce((sum, u) => sum + u.usedHours, 0)
  return {
    id: row.id,
    clientId: row.clientId,
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
    usages: row.usages
      .slice()
      .sort((a, b) => b.usedAt.getTime() - a.usedAt.getTime())
      .map(u => ({
        id: u.id,
        scheduleEventId: u.scheduleEventId,
        usedHours: u.usedHours,
        usedAt: u.usedAt.toISOString(),
        updatedAt: u.updatedAt.toISOString(),
        comment: u.comment,
        eventTitle: u.scheduleEvent?.title ?? null,
      })),
  }
}

const USAGE_INCLUDE = { usages: { include: { scheduleEvent: { select: { title: true } } } } } as const

// ============================================================
// СПИСОК АБОНЕМЕНТОВ КЛИЕНТА
// ============================================================

export async function getClientSubscriptions(
  clientId: string
): Promise<{ ok: true; data: ClientSubscriptionDTO[] } | { ok: false; data: ClientSubscriptionDTO[]; error: string }> {
  try {
    const rows = await prisma.clientSubscription.findMany({
      where: { clientId },
      orderBy: { purchasedAt: 'asc' },
      include: USAGE_INCLUDE,
    })
    return { ok: true, data: rows.map(toDTO) }
  } catch (e) {
    console.error('[getClientSubscriptions]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить абонементы' }
  }
}

// ============================================================
// СОЗДАТЬ АБОНЕМЕНТ
// ============================================================

export interface CreateSubscriptionInput {
  clientId: string
  packageHours: number
  paidAmount?: number | null
  purchasedAt?: string
  notes?: string
}

export async function createSubscription(
  input: CreateSubscriptionInput
): Promise<{ ok: true; data: ClientSubscriptionDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  if (!Number.isFinite(input.packageHours) || input.packageHours <= 0) {
    return { ok: false, error: 'Некорректный размер абонемента' }
  }

  try {
    const row = await prisma.clientSubscription.create({
      data: {
        clientId: input.clientId,
        packageHours: input.packageHours,
        paidAmount: input.paidAmount ?? null,
        purchasedAt: input.purchasedAt ? new Date(input.purchasedAt) : new Date(),
        notes: input.notes?.trim() || null,
      },
      include: USAGE_INCLUDE,
    })
    revalidateSubscriptionConsumers(input.clientId)
    return { ok: true, data: toDTO(row) }
  } catch (e) {
    console.error('[createSubscription]', e)
    return { ok: false, error: 'Не удалось создать абонемент' }
  }
}

// ============================================================
// СПИСАТЬ ЧАСЫ ЗАПИСИ С АБОНЕМЕНТА
// (переносит списание, если событие уже было привязано к другому абонементу;
// на сервере блокирует перерасход — это авторитетная проверка)
// ============================================================

export interface ChargeEventInput {
  scheduleEventId: string
  subscriptionId: string
  usedHours: number
  comment?: string | null
}

// Пересчёт status после изменения списаний (списание/освобождение часов) —
// единственное место, где статус меняется АВТОМАТИЧЕСКИ, без участия
// администратора. canAutoRecomputeStatus (subscription-model.ts) не даёт
// этому тронуть CANCELLED/REFUNDED — они меняются только вручную через
// updateSubscriptionStatus ниже. usedAt проставляется/очищается вместе со
// статусом: абонемент либо "использован сейчас", либо нет.
async function applyAutoStatus(
  tx: Prisma.TransactionClient,
  subscription: ClientSubscription & { usages: { usedHours: number }[] },
): Promise<void> {
  if (!canAutoRecomputeStatus(subscription.status)) return
  const used = subscription.openingUsedHours + subscription.usages.reduce((sum, u) => sum + u.usedHours, 0)
  const newStatus: SubscriptionStatus = used >= subscription.packageHours ? 'USED_UP' : 'ACTIVE'
  if (newStatus === subscription.status) return
  await tx.clientSubscription.update({
    where: { id: subscription.id },
    data: {
      status: newStatus,
      statusUpdatedAt: new Date(),
      usedAt: newStatus === 'USED_UP' ? (subscription.usedAt ?? new Date()) : null,
    },
  })
}

export async function chargeEventToSubscription(
  input: ChargeEventInput
): Promise<{ ok: true; data: ClientSubscriptionDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  if (!Number.isFinite(input.usedHours) || input.usedHours <= 0) {
    return { ok: false, error: 'Количество списываемых часов должно быть больше нуля' }
  }

  try {
    const result = await prisma.$transaction(async tx => {
      // Освобождаем предыдущее списание этого события (если оно было — в т.ч. на другой абонемент)
      const existing = await tx.subscriptionUsage.findUnique({ where: { scheduleEventId: input.scheduleEventId } })
      if (existing) {
        await tx.subscriptionUsage.delete({ where: { id: existing.id } })
      }

      const subscription = await tx.clientSubscription.findUnique({
        where: { id: input.subscriptionId },
        include: { usages: true },
      })
      if (!subscription) throw new Error('NOT_FOUND')

      const alreadyUsed = subscription.openingUsedHours + subscription.usages.reduce((sum, u) => sum + u.usedHours, 0)
      const remaining = subscription.packageHours - alreadyUsed
      if (input.usedHours > remaining) {
        throw new Error(`OVERSPEND:${remaining}`)
      }

      await tx.subscriptionUsage.create({
        data: {
          subscriptionId: input.subscriptionId,
          scheduleEventId: input.scheduleEventId,
          usedHours: input.usedHours,
          comment: input.comment?.trim() || null,
        },
      })

      await applyAutoStatus(tx, { ...subscription, usages: [...subscription.usages, { usedHours: input.usedHours }] })

      // Если освобождённое списание было с ДРУГОГО абонемента — пересчитать
      // его статус (часы вернулись) и записать это как перенос оплаты в
      // "Историю корректировок" обоих абонементов (ТЗ, Часть 4/9, пример
      // "Перенесено списание на другой абонемент") — единственный случай,
      // когда chargeEventToSubscription пишет в AuditLog: обычное первое
      // списание — это просто нормальная оплата, не "корректировка".
      let transferredFromSubscriptionId: string | null = null
      if (existing && existing.subscriptionId !== input.subscriptionId) {
        const otherSub = await tx.clientSubscription.findUnique({
          where: { id: existing.subscriptionId },
          include: { usages: true },
        })
        if (otherSub) {
          await applyAutoStatus(tx, otherSub)
          transferredFromSubscriptionId = otherSub.id
        }
      }

      return {
        subscription: await tx.clientSubscription.findUniqueOrThrow({
          where: { id: input.subscriptionId },
          include: USAGE_INCLUDE,
        }),
        transferredFromSubscriptionId,
      }
    })

    if (result.transferredFromSubscriptionId) {
      const transferMeta = {
        scheduleEventId: input.scheduleEventId,
        hours: input.usedHours,
        manual: true as const,
      }
      await writeAuditLog({
        userId: authResult.userId,
        action: 'SUBSCRIPTION_HOURS_TRANSFERRED_OUT',
        entityId: result.transferredFromSubscriptionId,
        metadata: { ...transferMeta, toSubscriptionId: input.subscriptionId },
      })
      await writeAuditLog({
        userId: authResult.userId,
        action: 'SUBSCRIPTION_HOURS_TRANSFERRED_IN',
        entityId: input.subscriptionId,
        metadata: { ...transferMeta, fromSubscriptionId: result.transferredFromSubscriptionId },
      })
    }

    revalidateSubscriptionConsumers(result.subscription.clientId)
    return { ok: true, data: toDTO(result.subscription) }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('OVERSPEND:')) {
      const remaining = e.message.split(':')[1]
      return {
        ok: false,
        error: `В абонементе осталось только ${remaining} ч. Уменьшите количество списываемых часов или выберите другой абонемент.`,
      }
    }
    console.error('[chargeEventToSubscription]', e)
    return { ok: false, error: 'Не удалось списать часы абонемента' }
  }
}

// ============================================================
// ОТВЯЗАТЬ ЗАПИСЬ ОТ АБОНЕМЕНТА (переход обратно на разовую оплату)
// ============================================================

export async function removeEventSubscriptionCharge(
  scheduleEventId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  try {
    const existing = await prisma.subscriptionUsage.findUnique({ where: { scheduleEventId } })
    if (!existing) return { ok: true }

    let clientId: string | null = null
    await prisma.$transaction(async tx => {
      await tx.subscriptionUsage.delete({ where: { id: existing.id } })

      const sub = await tx.clientSubscription.findUnique({
        where: { id: existing.subscriptionId },
        include: { usages: true },
      })
      if (sub) {
        clientId = sub.clientId
        await applyAutoStatus(tx, sub)
      }
    })

    if (clientId) revalidateSubscriptionConsumers(clientId)
    else revalidatePath('/admin/schedule')
    return { ok: true }
  } catch (e) {
    console.error('[removeEventSubscriptionCharge]', e)
    return { ok: false, error: 'Не удалось отвязать абонемент от записи' }
  }
}

// ============================================================
// ЕДИНЫЙ ХЕЛПЕР ОБНОВЛЕНИЯ СТАТУСА — единственная точка входа для всех
// ручных действий над абонементом (отметить использованным, аннулировать,
// оформить возврат, архивировать/разархивировать, обновить комментарий).
// Используется из Финансов, карточки клиента и карточки заказа — везде один
// и тот же вызов, поэтому статус не может разъехаться между разделами (см.
// ТЗ: "не нужно писать отдельные независимые функции").
// ============================================================

export interface UpdateSubscriptionStatusInput {
  // Отсутствует — статус не меняется (например, чистое архивирование:
  // isArchived меняется, а used/cancelled/refunded остаётся как было).
  status?: SubscriptionStatus
  isArchived?: boolean
  cancellationReason?: string | null
  refundAmount?: number | null
  refundReason?: string | null
  adminComment?: string | null
}

export async function updateSubscriptionStatus(
  subscriptionId: string, input: UpdateSubscriptionStatusInput
): Promise<{ ok: true; data: ClientSubscriptionDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  try {
    const existing = await prisma.clientSubscription.findUnique({ where: { id: subscriptionId } })
    if (!existing) return { ok: false, error: 'Абонемент не найден' }

    const now = new Date()
    const data: Prisma.ClientSubscriptionUpdateInput = {}
    let auditAction = 'SUBSCRIPTION_UPDATED'

    if (input.status !== undefined && input.status !== existing.status) {
      data.status = input.status
      data.statusUpdatedAt = now
      if (input.status === 'USED_UP') {
        data.usedAt = existing.usedAt ?? now
        auditAction = 'SUBSCRIPTION_MARKED_USED'
      } else if (input.status === 'CANCELLED') {
        data.cancelledAt = existing.cancelledAt ?? now
        auditAction = 'SUBSCRIPTION_CANCELLED'
      } else if (input.status === 'REFUNDED') {
        data.refundedAt = existing.refundedAt ?? now
        auditAction = 'SUBSCRIPTION_REFUNDED'
      } else if (input.status === 'ACTIVE') {
        auditAction = 'SUBSCRIPTION_REACTIVATED'
      }
    }
    if (input.cancellationReason !== undefined) data.cancellationReason = input.cancellationReason?.trim() || null
    if (input.refundAmount !== undefined) data.refundAmount = input.refundAmount
    if (input.refundReason !== undefined) data.refundReason = input.refundReason?.trim() || null
    if (input.adminComment !== undefined) data.adminComment = input.adminComment?.trim() || null
    if (input.isArchived !== undefined && input.isArchived !== existing.isArchived) {
      data.isArchived = input.isArchived
      data.archivedAt = input.isArchived ? now : null
      auditAction = input.isArchived ? 'SUBSCRIPTION_ARCHIVED' : 'SUBSCRIPTION_UNARCHIVED'
    }

    if (Object.keys(data).length === 0) {
      // Нечего менять — но всё равно вернуть актуальные данные вызывающей стороне.
      const row = await prisma.clientSubscription.findUniqueOrThrow({ where: { id: subscriptionId }, include: USAGE_INCLUDE })
      return { ok: true, data: toDTO(row) }
    }

    const updated = await prisma.clientSubscription.update({
      where: { id: subscriptionId },
      data,
      include: USAGE_INCLUDE,
    })

    await writeAuditLog({
      userId: authResult.userId,
      action: auditAction,
      entityId: subscriptionId,
      metadata: { ...input },
    })

    revalidateSubscriptionConsumers(updated.clientId)
    return { ok: true, data: toDTO(updated) }
  } catch (e) {
    console.error('[updateSubscriptionStatus]', e)
    return { ok: false, error: 'Не удалось обновить статус абонемента' }
  }
}

// ============================================================
// РУЧНАЯ КОРРЕКТИРОВКА ЧАСОВ — единственная точка входа для правки "Куплено"/
// "Использовано" (см. ТЗ, Части 5-9). Правит packageHours напрямую и
// openingUsedHours КОСВЕННО (через желаемую итоговую сумму использованных
// часов минус сумма реальных SubscriptionUsage) — реальные списания по
// конкретным записям расписания этой функцией никогда не трогаются и не
// теряются, меняется только "стартовый остаток" до них (тот же смысл, что и
// у openingUsedHours при обычном импорте — см. комментарий в schema.prisma).
// ============================================================

export interface UpdateSubscriptionHoursInput {
  packageHours: number
  // Желаемое ИТОГОВОЕ использованное количество часов (не только openingUsedHours)
  usedHours: number
  adjustmentComment?: string
  adjustmentReason?: string
}

export async function updateSubscriptionHours(
  subscriptionId: string, input: UpdateSubscriptionHoursInput
): Promise<{ ok: true; data: ClientSubscriptionDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  if (!Number.isFinite(input.packageHours) || input.packageHours < 0) {
    return { ok: false, error: 'Куплено часов не может быть отрицательным' }
  }
  if (!Number.isFinite(input.usedHours) || input.usedHours < 0) {
    return { ok: false, error: 'Использовано часов не может быть отрицательным' }
  }
  if (input.usedHours > input.packageHours) {
    return { ok: false, error: 'Использовано часов не может быть больше купленных' }
  }

  try {
    const existing = await prisma.clientSubscription.findUnique({ where: { id: subscriptionId }, include: { usages: true } })
    if (!existing) return { ok: false, error: 'Абонемент не найден' }

    // Реальные списания по конкретным записям — неприкосновенны, корректировка
    // ложится только на "стартовый" остаток (openingUsedHours).
    const realUsagesSum = existing.usages.reduce((sum, u) => sum + u.usedHours, 0)
    const newOpeningUsedHours = input.usedHours - realUsagesSum
    if (newOpeningUsedHours < 0) {
      return {
        ok: false,
        error: `Нельзя указать использованных часов меньше суммы реальных списаний по записям (${realUsagesSum} ч). Сначала измените или отвяжите отдельные списания в самих записях.`,
      }
    }

    const oldUsedHours = existing.openingUsedHours + realUsagesSum
    const oldTotalHours = existing.packageHours
    const oldRemainingHours = oldTotalHours - oldUsedHours
    const newRemainingHours = input.packageHours - input.usedHours

    const now = new Date()
    const data: Prisma.ClientSubscriptionUpdateInput = {
      packageHours: input.packageHours,
      openingUsedHours: newOpeningUsedHours,
    }

    // Тот же принцип, что и в applyAutoStatus: ручная корректировка может
    // подвинуть статус между ACTIVE/USED_UP, но никогда не трогает
    // CANCELLED/REFUNDED без явного отдельного действия администратора.
    if (canAutoRecomputeStatus(existing.status)) {
      const newStatus: SubscriptionStatus = newRemainingHours <= 0 ? 'USED_UP' : 'ACTIVE'
      if (newStatus !== existing.status) {
        data.status = newStatus
        data.statusUpdatedAt = now
        data.usedAt = newStatus === 'USED_UP' ? (existing.usedAt ?? now) : null
      }
    }

    const updated = await prisma.clientSubscription.update({ where: { id: subscriptionId }, data, include: USAGE_INCLUDE })

    await writeAuditLog({
      userId: authResult.userId,
      action: 'SUBSCRIPTION_HOURS_ADJUSTED',
      entityId: subscriptionId,
      metadata: {
        oldTotalHours, newTotalHours: input.packageHours,
        oldUsedHours, newUsedHours: input.usedHours,
        oldRemainingHours, newRemainingHours,
        comment: input.adjustmentComment?.trim() || null,
        reason: input.adjustmentReason?.trim() || null,
        manual: true,
      },
    })

    revalidateSubscriptionConsumers(updated.clientId)
    return { ok: true, data: toDTO(updated) }
  } catch (e) {
    console.error('[updateSubscriptionHours]', e)
    return { ok: false, error: 'Не удалось изменить часы абонемента' }
  }
}

// ============================================================
// ИСТОРИЯ КОРРЕКТИРОВОК — и ручные правки часов (updateSubscriptionHours), и
// переносы оплаты между абонементами (chargeEventToSubscription) — то же
// AuditLog, что и у смены статуса, просто другой набор action. Единая
// таблица истории для "Истории корректировок" в карточке абонемента.
// ============================================================

export interface SubscriptionAdjustmentDTO {
  id: string
  createdAt: string
  action: string
  oldTotalHours: number | null
  newTotalHours: number | null
  oldUsedHours: number | null
  newUsedHours: number | null
  oldRemainingHours: number | null
  newRemainingHours: number | null
  comment: string | null
  reason: string | null
  hours: number | null
  relatedScheduleEventDate: string | null
}

const ADJUSTMENT_ACTIONS = ['SUBSCRIPTION_HOURS_ADJUSTED', 'SUBSCRIPTION_HOURS_TRANSFERRED_OUT', 'SUBSCRIPTION_HOURS_TRANSFERRED_IN']

export async function getSubscriptionAdjustmentHistory(subscriptionId: string): Promise<
  { ok: true; data: SubscriptionAdjustmentDTO[] } | { ok: false; data: SubscriptionAdjustmentDTO[]; error: string }
> {
  try {
    const rows = await prisma.auditLog.findMany({
      where: { entityType: 'ClientSubscription', entityId: subscriptionId, action: { in: ADJUSTMENT_ACTIONS } },
      orderBy: { createdAt: 'desc' },
    })

    const scheduleEventIds = Array.from(new Set(
      rows.map(r => (r.metadata as Record<string, unknown> | null)?.scheduleEventId).filter((v): v is string => typeof v === 'string'),
    ))
    const events = scheduleEventIds.length > 0
      ? await prisma.scheduleEvent.findMany({ where: { id: { in: scheduleEventIds } }, select: { id: true, startAt: true } })
      : []
    const eventDateById = new Map(events.map(e => [e.id, e.startAt ? e.startAt.toISOString() : null]))

    const data: SubscriptionAdjustmentDTO[] = rows.map(r => {
      const m = (r.metadata ?? {}) as Record<string, unknown>
      const num = (key: string) => (typeof m[key] === 'number' ? m[key] as number : null)
      const str = (key: string) => (typeof m[key] === 'string' ? m[key] as string : null)
      const scheduleEventId = str('scheduleEventId')
      return {
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        action: r.action,
        oldTotalHours: num('oldTotalHours'),
        newTotalHours: num('newTotalHours'),
        oldUsedHours: num('oldUsedHours'),
        newUsedHours: num('newUsedHours'),
        oldRemainingHours: num('oldRemainingHours'),
        newRemainingHours: num('newRemainingHours'),
        comment: str('comment'),
        reason: str('reason'),
        hours: num('hours'),
        relatedScheduleEventDate: scheduleEventId ? (eventDateById.get(scheduleEventId) ?? null) : null,
      }
    })

    return { ok: true, data }
  } catch (e) {
    console.error('[getSubscriptionAdjustmentHistory]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить историю корректировок' }
  }
}
