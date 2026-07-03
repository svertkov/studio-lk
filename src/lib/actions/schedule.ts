'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import {
  type ClientConfirmationStatus, type ScheduleEvent, type SubscriptionUsage, type ClientSubscription,
  type EventType, type PaymentMethod,
  Prisma,
} from '@prisma/client'
import {
  computeMaterialsStatus, computeYandexLinkExpiry,
  type ScheduleEventDTO,
} from '@/lib/schedule-model'
import { classifyEventType } from '@/lib/event-type'
import { normalizePhone, normalizeEmail, normalizeTelegram } from '@/lib/import/normalize'

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

async function writeAuditLog(params: {
  userId: string | null
  action: string
  entityId: string
  metadata?: Record<string, unknown>
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entityType: 'ScheduleEvent',
        entityId: params.entityId,
        metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
      },
    })
  } catch {
    // Не блокируем основную операцию если лог не записался
  }
}

// ============================================================
// СЕРИАЛИЗАЦИЯ
// ============================================================

type SubscriptionUsageWithSubscription = SubscriptionUsage & {
  subscription: ClientSubscription & { usages: SubscriptionUsage[] }
}

type ScheduleEventWithClient = ScheduleEvent & {
  client: { name: string } | null
  subscriptionUsage: SubscriptionUsageWithSubscription | null
}

const SCHEDULE_EVENT_INCLUDE = {
  client: { select: { name: true } },
  subscriptionUsage: { include: { subscription: { include: { usages: true } } } },
} as const

function toDTO(row: ScheduleEventWithClient): ScheduleEventDTO {
  const su = row.subscriptionUsage
  return {
    id: row.id,
    calendarEventId: row.calendarEventId,
    title: row.title,
    description: row.description,
    startAt: row.startAt ? row.startAt.toISOString() : null,
    endAt: row.endAt ? row.endAt.toISOString() : null,
    clientId: row.clientId,
    clientName: row.client?.name ?? null,
    clientNameRaw: row.clientNameRaw,
    contactRaw: row.contactRaw,
    companyRaw: row.companyRaw,
    room: row.room,
    format: row.format,
    camerasCount: row.camerasCount,
    estimatedPrice: row.estimatedPrice,
    paymentMethod: row.paymentMethod,
    notes: row.notes,
    yandexDiskUrl: row.yandexDiskUrl,
    yandexDiskUrlAddedAt: row.yandexDiskUrlAddedAt ? row.yandexDiskUrlAddedAt.toISOString() : null,
    yandexDiskUrlExpiresAt: row.yandexDiskUrlExpiresAt ? row.yandexDiskUrlExpiresAt.toISOString() : null,
    nasBackupUrl: row.nasBackupUrl,
    materialsComment: row.materialsComment,
    materialsStatus: row.materialsStatus,
    clientConfirmationStatus: row.clientConfirmationStatus,
    eventType: row.eventType,
    subscriptionUsage: su ? {
      subscriptionId: su.subscriptionId,
      usedHours: su.usedHours,
      purchasedAt: su.subscription.purchasedAt.toISOString(),
      packageHours: su.subscription.packageHours,
      remainingHours: su.subscription.packageHours - su.subscription.openingUsedHours - su.subscription.usages.reduce((sum, u) => sum + u.usedHours, 0),
    } : null,
  }
}

// ============================================================
// АННОТАЦИИ ДЛЯ ОТОБРАЖАЕМЫХ СОБЫТИЙ КАЛЕНДАРЯ
// ============================================================

export async function getScheduleAnnotations(
  calendarEventIds: string[]
): Promise<{ ok: true; data: Record<string, ScheduleEventDTO> } | { ok: false; error: string; data: Record<string, ScheduleEventDTO> }> {
  if (calendarEventIds.length === 0) return { ok: true, data: {} }

  try {
    const rows = await prisma.scheduleEvent.findMany({
      where: { calendarEventId: { in: calendarEventIds } },
      include: SCHEDULE_EVENT_INCLUDE,
    })

    const data: Record<string, ScheduleEventDTO> = {}
    for (const row of rows) {
      if (row.calendarEventId) data[row.calendarEventId] = toDTO(row)
    }
    return { ok: true, data }
  } catch (e) {
    console.error('[getScheduleAnnotations]', e)
    return { ok: false, error: 'Не удалось загрузить аннотации расписания', data: {} }
  }
}

// ============================================================
// СОЗДАТЬ/ОБНОВИТЬ АННОТАЦИЮ СОБЫТИЯ
// ============================================================

export interface UpsertScheduleEventInput {
  calendarEventId: string
  title?: string
  description?: string
  startAt?: string
  endAt?: string
  clientId?: string | null
  clientNameRaw?: string
  contactRaw?: string
  companyRaw?: string
  room?: string
  format?: string
  camerasCount?: number | null
  estimatedPrice?: number | null
  paymentMethod?: PaymentMethod | null
  notes?: string
  yandexDiskUrl?: string | null
  nasBackupUrl?: string | null
  materialsComment?: string
  clientConfirmationStatus?: ClientConfirmationStatus
  eventType?: EventType
}

export async function upsertScheduleEvent(
  input: UpsertScheduleEventInput
): Promise<{ ok: true; data: ScheduleEventDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  try {
    const existing = await prisma.scheduleEvent.findUnique({ where: { calendarEventId: input.calendarEventId } })

    // Ссылку на Яндекс.Диск и её "возраст" сервер решает сам — не доверяем
    // клиенту дату добавления. Новая/изменённая ссылка -> дата = сейчас.
    // Ссылку очистили -> дата тоже очищается.
    const existingUrl = existing?.yandexDiskUrl ?? null
    const nextYandexUrl = input.yandexDiskUrl === undefined ? existingUrl : (input.yandexDiskUrl?.trim() || null)
    const yandexDiskUrlAddedAt = nextYandexUrl === null
      ? null
      : nextYandexUrl !== existingUrl
        ? new Date()
        : (existing?.yandexDiskUrlAddedAt ?? new Date())

    const nextNasUrl = input.nasBackupUrl === undefined
      ? (existing?.nasBackupUrl ?? null)
      : (input.nasBackupUrl?.trim() || null)

    const materialsStatus = computeMaterialsStatus({
      yandexDiskUrl: nextYandexUrl,
      yandexDiskUrlAddedAt,
      nasBackupUrl: nextNasUrl,
    })
    const yandexDiskUrlExpiresAt = yandexDiskUrlAddedAt ? computeYandexLinkExpiry(yandexDiskUrlAddedAt) : null

    const row = await prisma.scheduleEvent.upsert({
      where: { calendarEventId: input.calendarEventId },
      create: {
        calendarEventId: input.calendarEventId,
        title: input.title ?? null,
        description: input.description ?? null,
        startAt: input.startAt ? new Date(input.startAt) : null,
        endAt: input.endAt ? new Date(input.endAt) : null,
        clientId: input.clientId ?? null,
        clientNameRaw: input.clientNameRaw?.trim() || null,
        contactRaw: input.contactRaw?.trim() || null,
        companyRaw: input.companyRaw?.trim() || null,
        room: input.room?.trim() || null,
        format: input.format?.trim() || null,
        camerasCount: input.camerasCount ?? null,
        estimatedPrice: input.estimatedPrice ?? null,
        paymentMethod: input.paymentMethod ?? null,
        notes: input.notes?.trim() || null,
        yandexDiskUrl: nextYandexUrl,
        yandexDiskUrlAddedAt,
        yandexDiskUrlExpiresAt,
        nasBackupUrl: nextNasUrl,
        materialsComment: input.materialsComment?.trim() || null,
        materialsStatus,
        clientConfirmationStatus: input.clientConfirmationStatus ?? 'NOT_REQUIRED',
        eventType: input.eventType ?? classifyEventType(input.title ?? ''),
      },
      update: {
        ...(input.title !== undefined && { title: input.title || null }),
        ...(input.description !== undefined && { description: input.description || null }),
        ...(input.startAt !== undefined && { startAt: input.startAt ? new Date(input.startAt) : null }),
        ...(input.endAt !== undefined && { endAt: input.endAt ? new Date(input.endAt) : null }),
        ...(input.clientId !== undefined && { clientId: input.clientId }),
        ...(input.clientNameRaw !== undefined && { clientNameRaw: input.clientNameRaw?.trim() || null }),
        ...(input.contactRaw !== undefined && { contactRaw: input.contactRaw?.trim() || null }),
        ...(input.companyRaw !== undefined && { companyRaw: input.companyRaw?.trim() || null }),
        ...(input.room !== undefined && { room: input.room?.trim() || null }),
        ...(input.format !== undefined && { format: input.format?.trim() || null }),
        ...(input.camerasCount !== undefined && { camerasCount: input.camerasCount }),
        ...(input.estimatedPrice !== undefined && { estimatedPrice: input.estimatedPrice }),
        ...(input.paymentMethod !== undefined && { paymentMethod: input.paymentMethod }),
        ...(input.notes !== undefined && { notes: input.notes?.trim() || null }),
        yandexDiskUrl: nextYandexUrl,
        yandexDiskUrlAddedAt,
        yandexDiskUrlExpiresAt,
        nasBackupUrl: nextNasUrl,
        ...(input.materialsComment !== undefined && { materialsComment: input.materialsComment?.trim() || null }),
        materialsStatus,
        ...(input.clientConfirmationStatus !== undefined && { clientConfirmationStatus: input.clientConfirmationStatus }),
        ...(input.eventType !== undefined && { eventType: input.eventType }),
      },
      include: SCHEDULE_EVENT_INCLUDE,
    })

    revalidatePath('/admin/schedule')
    if (input.clientConfirmationStatus !== undefined || input.clientId !== undefined) {
      revalidatePath('/admin/clients')
    }

    return { ok: true, data: toDTO(row) }
  } catch (e) {
    console.error('[upsertScheduleEvent]', e)
    return { ok: false, error: 'Не удалось сохранить событие' }
  }
}

// ============================================================
// СОБЫТИЯ, ОЖИДАЮЩИЕ ПОДТВЕРЖДЕНИЯ КЛИЕНТА
// ============================================================

export interface PendingScheduleEventDTO {
  id: string
  calendarEventId: string | null
  title: string | null
  startAt: string | null
  endAt: string | null
  clientNameRaw: string | null
  contactRaw: string | null
  companyRaw: string | null
  room: string | null
  format: string | null
  estimatedPrice: number | null
}

export async function getPendingScheduleClients(): Promise<
  { ok: true; data: PendingScheduleEventDTO[] } | { ok: false; data: PendingScheduleEventDTO[]; error: string }
> {
  try {
    const rows = await prisma.scheduleEvent.findMany({
      where: { clientConfirmationStatus: 'PENDING' },
      orderBy: { startAt: 'asc' },
    })
    return {
      ok: true,
      data: rows.map(r => ({
        id: r.id,
        calendarEventId: r.calendarEventId,
        title: r.title,
        startAt: r.startAt ? r.startAt.toISOString() : null,
        endAt: r.endAt ? r.endAt.toISOString() : null,
        clientNameRaw: r.clientNameRaw,
        contactRaw: r.contactRaw,
        companyRaw: r.companyRaw,
        room: r.room,
        format: r.format,
        estimatedPrice: r.estimatedPrice,
      })),
    }
  } catch (e) {
    console.error('[getPendingScheduleClients]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить неподтверждённых клиентов' }
  }
}

// ============================================================
// ПОХОЖИЕ КЛИЕНТЫ — для выбора "привязать" vs "создать нового"
// ============================================================

const PHONE_RE = /(\+?\d[\d\s\-()]{7,}\d)/
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/
const TELEGRAM_RE = /@[a-zA-Z0-9_]{4,}/

export interface SimilarClientMatch {
  id: string
  name: string
  phone: string | null
  email: string | null
  matchedBy: 'phone' | 'email' | 'telegram' | 'company' | 'name'
}

export async function findSimilarClientsForEvent(input: {
  name?: string
  contact?: string
  company?: string
}): Promise<{ ok: true; data: SimilarClientMatch[] } | { ok: false; data: SimilarClientMatch[]; error: string }> {
  try {
    const contact = input.contact?.trim() ?? ''
    const phoneMatch = contact.match(PHONE_RE)
    const emailMatch = contact.match(EMAIL_RE)
    const telegramMatch = contact.match(TELEGRAM_RE)

    const phone = phoneMatch ? normalizePhone(phoneMatch[0]) : undefined
    const email = emailMatch ? normalizeEmail(emailMatch[0]) : undefined
    const telegram = telegramMatch ? normalizeTelegram(telegramMatch[0]) : undefined
    const name = input.name?.trim()
    const company = input.company?.trim()

    const or: Prisma.ClientWhereInput[] = []
    if (phone?.valid) or.push({ phone: phone.value })
    if (email) or.push({ email })
    if (telegram) or.push({ telegram })
    if (company) or.push({ companyName: { equals: company, mode: 'insensitive' } })
    // contains, а не equals — из календаря часто известна только фамилия/часть
    // имени ("Соломатин"), а в базе клиент хранится под полным именем
    // ("Соломатин Иван") — точное совпадение почти никогда не сработает и
    // приведёт к случайным дублям вместо привязки к уже существующему клиенту.
    if (name) or.push({ name: { contains: name, mode: 'insensitive' } })

    if (or.length === 0) return { ok: true, data: [] }

    const clients = await prisma.client.findMany({
      where: { deletedAt: null, OR: or },
      select: { id: true, name: true, phone: true, email: true, telegram: true, companyName: true },
      take: 5,
    })

    const data: SimilarClientMatch[] = clients.map(c => {
      let matchedBy: SimilarClientMatch['matchedBy'] = 'name'
      if (phone?.valid && c.phone === phone.value) matchedBy = 'phone'
      else if (email && c.email === email) matchedBy = 'email'
      else if (telegram && c.telegram === telegram) matchedBy = 'telegram'
      else if (company && c.companyName?.toLowerCase() === company.toLowerCase()) matchedBy = 'company'
      return { id: c.id, name: c.name, phone: c.phone, email: c.email, matchedBy }
    })

    return { ok: true, data }
  } catch (e) {
    console.error('[findSimilarClientsForEvent]', e)
    return { ok: false, data: [], error: 'Не удалось выполнить поиск похожих клиентов' }
  }
}

// ============================================================
// ПОДТВЕРДИТЬ / ИГНОРИРОВАТЬ
// ============================================================

export async function confirmScheduleClient(
  eventId: string, clientId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  try {
    await prisma.scheduleEvent.update({
      where: { id: eventId },
      data: { clientId, clientConfirmationStatus: 'CONFIRMED' },
    })

    await writeAuditLog({
      userId: authResult.userId,
      action: 'SCHEDULE_CLIENT_CONFIRMED',
      entityId: eventId,
      metadata: { clientId },
    })

    revalidatePath('/admin/clients')
    revalidatePath('/admin/schedule')
    return { ok: true }
  } catch (e) {
    console.error('[confirmScheduleClient]', e)
    return { ok: false, error: 'Не удалось подтвердить клиента' }
  }
}

export async function ignoreScheduleClient(
  eventId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  try {
    await prisma.scheduleEvent.update({
      where: { id: eventId },
      data: { clientConfirmationStatus: 'IGNORED' },
    })

    revalidatePath('/admin/clients')
    revalidatePath('/admin/schedule')
    return { ok: true }
  } catch (e) {
    console.error('[ignoreScheduleClient]', e)
    return { ok: false, error: 'Не удалось проигнорировать событие' }
  }
}

// ============================================================
// АВТОМАТИЧЕСКОЕ ОБНАРУЖЕНИЕ ЧЕРНОВИКОВ КЛИЕНТОВ
// Вызывается клиентским компонентом ("Клиенты из расписания") для каждого
// studio_booking события, у которого распознано имя клиента в названии/
// описании (parseEventTitle), но оно не совпало ни с одним существующим
// клиентом (findSimilarClientsForEvent). НЕ трогает событие, если по нему уже
// есть решение (PENDING/CONFIRMED/IGNORED) — не перезаписывает ручной выбор
// администратора и не плодит повторные черновики после игнорирования.
// ============================================================

export interface FlagPendingClientInput {
  calendarEventId: string
  title: string
  description: string
  startAt: string
  endAt: string
  clientNameRaw: string
}

export async function flagPendingClientFromEvent(
  input: FlagPendingClientInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const existing = await prisma.scheduleEvent.findUnique({ where: { calendarEventId: input.calendarEventId } })
    if (existing && existing.clientConfirmationStatus !== 'NOT_REQUIRED') return { ok: true }
    if (existing?.clientId) return { ok: true }

    await prisma.scheduleEvent.upsert({
      where: { calendarEventId: input.calendarEventId },
      create: {
        calendarEventId: input.calendarEventId,
        title: input.title,
        description: input.description,
        startAt: new Date(input.startAt),
        endAt: new Date(input.endAt),
        eventType: 'STUDIO_BOOKING',
        clientNameRaw: input.clientNameRaw.trim(),
        clientConfirmationStatus: 'PENDING',
      },
      update: {
        title: input.title,
        description: input.description,
        startAt: new Date(input.startAt),
        endAt: new Date(input.endAt),
        clientNameRaw: input.clientNameRaw.trim(),
        clientConfirmationStatus: 'PENDING',
      },
    })

    revalidatePath('/admin/clients')
    return { ok: true }
  } catch (e) {
    console.error('[flagPendingClientFromEvent]', e)
    return { ok: false, error: 'Не удалось создать черновик клиента' }
  }
}

// ============================================================
// ЗАПИСИ РАСПИСАНИЯ ДЛЯ КАРТОЧКИ КЛИЕНТА
// (снэпшот-поля аннотации, без обращения к живому Google Calendar — та же
// логика, что и в "Клиентах из расписания": для карточки клиента этого достаточно)
// ============================================================

export interface ClientBookingDTO {
  id: string
  calendarEventId: string | null
  title: string | null
  startAt: string | null
  endAt: string | null
  room: string | null
  format: string | null
  estimatedPrice: number | null
  paymentMethod: PaymentMethod | null
  subscriptionUsedHours: number | null
  subscriptionPurchasedAt: string | null
}

export async function getClientScheduleBookings(clientId: string): Promise<
  { ok: true; data: ClientBookingDTO[] } | { ok: false; data: ClientBookingDTO[]; error: string }
> {
  try {
    const rows = await prisma.scheduleEvent.findMany({
      where: { clientId, eventType: 'STUDIO_BOOKING' },
      orderBy: { startAt: 'desc' },
      include: { subscriptionUsage: { include: { subscription: true } } },
    })

    const data: ClientBookingDTO[] = rows.map(r => ({
      id: r.id,
      calendarEventId: r.calendarEventId,
      title: r.title,
      startAt: r.startAt ? r.startAt.toISOString() : null,
      endAt: r.endAt ? r.endAt.toISOString() : null,
      room: r.room,
      format: r.format,
      estimatedPrice: r.estimatedPrice,
      paymentMethod: r.paymentMethod,
      subscriptionUsedHours: r.subscriptionUsage?.usedHours ?? null,
      subscriptionPurchasedAt: r.subscriptionUsage?.subscription.purchasedAt.toISOString() ?? null,
    }))

    return { ok: true, data }
  } catch (e) {
    console.error('[getClientScheduleBookings]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить записи расписания клиента' }
  }
}
