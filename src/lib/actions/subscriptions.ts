'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import type { ClientSubscription, SubscriptionStatus, SubscriptionUsage } from '@prisma/client'

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
// СЕРИАЛИЗАЦИЯ
// ============================================================

type UsageWithEvent = SubscriptionUsage & { scheduleEvent: { title: string | null } }
type SubscriptionWithUsages = ClientSubscription & { usages: UsageWithEvent[] }

export interface SubscriptionUsageDTO {
  id: string
  scheduleEventId: string
  usedHours: number
  usedAt: string
  eventTitle: string | null
}

export interface ClientSubscriptionDTO {
  id: string
  clientId: string
  packageHours: number
  paidAmount: number | null
  purchasedAt: string
  status: SubscriptionStatus
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
    notes: row.notes,
    usedHours,
    remainingHours: row.packageHours - usedHours,
    usages: row.usages
      .slice()
      .sort((a, b) => b.usedAt.getTime() - a.usedAt.getTime())
      .map(u => ({
        id: u.id,
        scheduleEventId: u.scheduleEventId,
        usedHours: u.usedHours,
        usedAt: u.usedAt.toISOString(),
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
    revalidatePath(`/admin/clients/${input.clientId}`)
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
}

function isCancellable(status: SubscriptionStatus) {
  return status !== 'CANCELLED'
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
        },
      })

      if (isCancellable(subscription.status)) {
        const newStatus: SubscriptionStatus = alreadyUsed + input.usedHours >= subscription.packageHours ? 'USED_UP' : 'ACTIVE'
        if (newStatus !== subscription.status) {
          await tx.clientSubscription.update({ where: { id: subscription.id }, data: { status: newStatus } })
        }
      }

      // Если освобождённое списание было с ДРУГОГО абонемента — пересчитать и его статус
      if (existing && existing.subscriptionId !== input.subscriptionId) {
        const otherSub = await tx.clientSubscription.findUnique({
          where: { id: existing.subscriptionId },
          include: { usages: true },
        })
        if (otherSub && isCancellable(otherSub.status)) {
          const otherUsed = otherSub.openingUsedHours + otherSub.usages.reduce((sum, u) => sum + u.usedHours, 0)
          const otherStatus: SubscriptionStatus = otherUsed >= otherSub.packageHours ? 'USED_UP' : 'ACTIVE'
          if (otherStatus !== otherSub.status) {
            await tx.clientSubscription.update({ where: { id: otherSub.id }, data: { status: otherStatus } })
          }
        }
      }

      return tx.clientSubscription.findUniqueOrThrow({
        where: { id: input.subscriptionId },
        include: USAGE_INCLUDE,
      })
    })

    revalidatePath(`/admin/clients/${result.clientId}`)
    revalidatePath('/admin/schedule')
    return { ok: true, data: toDTO(result) }
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

    await prisma.$transaction(async tx => {
      await tx.subscriptionUsage.delete({ where: { id: existing.id } })

      const sub = await tx.clientSubscription.findUnique({
        where: { id: existing.subscriptionId },
        include: { usages: true },
      })
      if (sub && isCancellable(sub.status)) {
        const used = sub.openingUsedHours + sub.usages.reduce((sum, u) => sum + u.usedHours, 0)
        const status: SubscriptionStatus = used >= sub.packageHours ? 'USED_UP' : 'ACTIVE'
        if (status !== sub.status) {
          await tx.clientSubscription.update({ where: { id: sub.id }, data: { status } })
        }
      }
    })

    revalidatePath('/admin/schedule')
    return { ok: true }
  } catch (e) {
    console.error('[removeEventSubscriptionCharge]', e)
    return { ok: false, error: 'Не удалось отвязать абонемент от записи' }
  }
}
