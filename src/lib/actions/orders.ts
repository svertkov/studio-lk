'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import type {
  Order, Client, ScheduleEvent,
  OrderStatus, OrderSource, OrderPaymentStatus, PaymentMethod, ClientType,
} from '@prisma/client'
import { computeDurationMinutes } from '@/lib/order-model'
import { parseEventTitle } from '@/lib/event-category'

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

type OrderClient = Pick<Client, 'name' | 'phone' | 'telegram' | 'email' | 'type' | 'companyName'>
type OrderWithRelations = Order & { client: OrderClient | null; scheduleEvent: Pick<ScheduleEvent, 'id'> | null }

const ORDER_INCLUDE = {
  client: { select: { name: true, phone: true, telegram: true, email: true, type: true, companyName: true } },
  scheduleEvent: { select: { id: true } },
} as const

export interface OrderDTO {
  id: string
  status: OrderStatus
  source: OrderSource
  title: string | null
  clientId: string | null
  clientName: string | null
  clientPhone: string | null
  clientTelegram: string | null
  clientEmail: string | null
  clientType: ClientType | null
  companyName: string | null
  serviceType: string | null
  room: string | null
  plannedStartTime: string | null
  plannedEndTime: string | null
  durationMinutes: number | null
  preliminaryAmount: number | null
  paymentStatus: OrderPaymentStatus
  paymentMethod: PaymentMethod | null
  comment: string | null
  googleEventId: string | null
  hasBooking: boolean
  createdAt: string
  updatedAt: string
  statusUpdatedAt: string
  completedAt: string | null
}

function toDTO(row: OrderWithRelations): OrderDTO {
  // Если клиент привязан (client), его актуальные данные побеждают снэпшот на
  // заказе — снэпшот (clientName/clientPhone/...) остаётся только для заявок
  // без привязанного клиента (см. комментарий у Order.clientName в схеме).
  return {
    id: row.id,
    status: row.status,
    source: row.source,
    title: row.title,
    clientId: row.clientId,
    clientName: row.client?.name ?? row.clientName,
    clientPhone: row.client?.phone ?? row.clientPhone,
    clientTelegram: row.client?.telegram ?? row.clientTelegram,
    clientEmail: row.client?.email ?? row.clientEmail,
    clientType: row.client?.type ?? row.clientType,
    companyName: row.client?.companyName ?? row.companyName,
    serviceType: row.serviceType,
    room: row.room,
    plannedStartTime: row.plannedStartTime ? row.plannedStartTime.toISOString() : null,
    plannedEndTime: row.plannedEndTime ? row.plannedEndTime.toISOString() : null,
    durationMinutes: row.durationMinutes,
    preliminaryAmount: row.preliminaryAmount,
    paymentStatus: row.paymentStatus,
    paymentMethod: row.paymentMethod,
    comment: row.comment,
    googleEventId: row.googleEventId,
    hasBooking: !!row.scheduleEvent,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    statusUpdatedAt: row.statusUpdatedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  }
}

// ============================================================
// СПИСОК ЗАКАЗОВ
// ============================================================

export async function getOrders(): Promise<
  { ok: true; data: OrderDTO[] } | { ok: false; data: OrderDTO[]; error: string }
> {
  try {
    // CANCELLED теперь — видимая колонка канбана "Отказы" (см. order-model.ts),
    // поэтому больше не исключается. ARCHIVED по-прежнему скрыт — это не
    // колонка воронки, а отдельный будущий архивный статус.
    const rows = await prisma.order.findMany({
      where: { status: { not: 'ARCHIVED' } },
      orderBy: { createdAt: 'desc' },
      include: ORDER_INCLUDE,
    })
    return { ok: true, data: rows.map(toDTO) }
  } catch (e) {
    console.error('[getOrders]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить заказы' }
  }
}

// ============================================================
// СОЗДАТЬ / ОБНОВИТЬ ЗАКАЗ (вручную, из раздела "Заказы")
// ============================================================

export interface OrderInput {
  title?: string
  clientId?: string | null
  clientName?: string
  clientPhone?: string
  clientTelegram?: string
  clientEmail?: string
  clientType?: ClientType | null
  companyName?: string
  serviceType?: string
  comment?: string
  preliminaryAmount?: number | null
  paymentMethod?: PaymentMethod | null
  paymentStatus?: OrderPaymentStatus
  room?: string
  plannedStartTime?: string | null
  plannedEndTime?: string | null
  // Заполняется только при создании заказа из кнопки "Создать заказ" на
  // странице Telegram-диалога (см. src/lib/actions/telegram.ts) — источник
  // заказа автоматически становится TELEGRAM_BOT, а не MANUAL.
  telegramConversationId?: string | null
}

export async function createOrder(
  input: OrderInput
): Promise<{ ok: true; data: OrderDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  const clientNameTrim = input.clientName?.trim() || ''
  const titleTrim = input.title?.trim() || ''
  if (!input.clientId && !clientNameTrim && !titleTrim) {
    return { ok: false, error: 'Укажите имя клиента или название заявки' }
  }

  const hasBookingTime = !!(input.plannedStartTime && input.plannedEndTime)

  try {
    const order = await prisma.$transaction(async tx => {
      const created = await tx.order.create({
        data: {
          status: hasBookingTime ? 'BOOKED' : 'LEAD',
          source: input.telegramConversationId ? 'TELEGRAM_BOT' : 'MANUAL',
          telegramConversationId: input.telegramConversationId ?? null,
          title: titleTrim || clientNameTrim || null,
          clientId: input.clientId ?? null,
          clientName: clientNameTrim || null,
          clientPhone: input.clientPhone?.trim() || null,
          clientTelegram: input.clientTelegram?.trim() || null,
          clientEmail: input.clientEmail?.trim() || null,
          clientType: input.clientType ?? null,
          companyName: input.companyName?.trim() || null,
          serviceType: input.serviceType?.trim() || null,
          room: input.room?.trim() || null,
          plannedStartTime: input.plannedStartTime ? new Date(input.plannedStartTime) : null,
          plannedEndTime: input.plannedEndTime ? new Date(input.plannedEndTime) : null,
          durationMinutes: computeDurationMinutes(input.plannedStartTime, input.plannedEndTime),
          preliminaryAmount: input.preliminaryAmount ?? null,
          paymentStatus: input.paymentStatus ?? 'NOT_SPECIFIED',
          paymentMethod: input.paymentMethod ?? null,
          comment: input.comment?.trim() || null,
        },
      })

      if (hasBookingTime) {
        await tx.scheduleEvent.create({
          data: {
            orderId: created.id,
            clientId: created.clientId,
            title: created.title,
            startAt: created.plannedStartTime,
            endAt: created.plannedEndTime,
            room: created.room,
            format: created.serviceType,
            notes: created.comment,
            eventType: 'STUDIO_BOOKING',
          },
        })
      }

      return tx.order.findUniqueOrThrow({ where: { id: created.id }, include: ORDER_INCLUDE })
    })

    revalidatePath('/admin/orders')
    return { ok: true, data: toDTO(order) }
  } catch (e) {
    console.error('[createOrder]', e)
    return { ok: false, error: 'Не удалось создать заказ' }
  }
}

export async function updateOrder(
  id: string, input: OrderInput
): Promise<{ ok: true; data: OrderDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  try {
    const existing = await prisma.order.findUnique({ where: { id }, include: { scheduleEvent: true } })
    if (!existing) return { ok: false, error: 'Заказ не найден' }

    const nextClientId = input.clientId !== undefined ? input.clientId : existing.clientId
    const nextTitle = input.title !== undefined ? (input.title?.trim() || null) : existing.title
    const nextRoom = input.room !== undefined ? (input.room?.trim() || null) : existing.room
    const nextServiceType = input.serviceType !== undefined ? (input.serviceType?.trim() || null) : existing.serviceType
    const nextComment = input.comment !== undefined ? (input.comment?.trim() || null) : existing.comment
    const nextStart = input.plannedStartTime !== undefined
      ? (input.plannedStartTime ? new Date(input.plannedStartTime) : null)
      : existing.plannedStartTime
    const nextEnd = input.plannedEndTime !== undefined
      ? (input.plannedEndTime ? new Date(input.plannedEndTime) : null)
      : existing.plannedEndTime
    const hasBookingTimeNow = !!(nextStart && nextEnd)
    const hadBookingBefore = !!existing.scheduleEvent

    const order = await prisma.$transaction(async tx => {
      const updated = await tx.order.update({
        where: { id },
        data: {
          clientId: nextClientId,
          clientName: input.clientName !== undefined ? (input.clientName?.trim() || null) : undefined,
          clientPhone: input.clientPhone !== undefined ? (input.clientPhone?.trim() || null) : undefined,
          clientTelegram: input.clientTelegram !== undefined ? (input.clientTelegram?.trim() || null) : undefined,
          clientEmail: input.clientEmail !== undefined ? (input.clientEmail?.trim() || null) : undefined,
          clientType: input.clientType !== undefined ? input.clientType : undefined,
          companyName: input.companyName !== undefined ? (input.companyName?.trim() || null) : undefined,
          title: nextTitle,
          serviceType: nextServiceType,
          room: nextRoom,
          comment: nextComment,
          plannedStartTime: nextStart,
          plannedEndTime: nextEnd,
          durationMinutes: hasBookingTimeNow
            ? computeDurationMinutes(nextStart!.toISOString(), nextEnd!.toISOString())
            : null,
          preliminaryAmount: input.preliminaryAmount !== undefined ? input.preliminaryAmount : undefined,
          paymentStatus: input.paymentStatus !== undefined ? input.paymentStatus : undefined,
          paymentMethod: input.paymentMethod !== undefined ? input.paymentMethod : undefined,
          // Заказ без своей записи в расписании при добавлении даты/времени
          // переходит в "Записан в студию" — но только из "Заявки", чтобы не
          // откатывать уже продвинутый вручную статус (монтаж/правки/готово).
          ...(!hadBookingBefore && hasBookingTimeNow && existing.status === 'LEAD'
            ? { status: 'BOOKED' as const, statusUpdatedAt: new Date() }
            : {}),
        },
        include: { scheduleEvent: true },
      })

      if (hasBookingTimeNow) {
        if (updated.scheduleEvent) {
          await tx.scheduleEvent.update({
            where: { id: updated.scheduleEvent.id },
            data: {
              clientId: nextClientId,
              title: nextTitle,
              startAt: nextStart,
              endAt: nextEnd,
              room: nextRoom,
              format: nextServiceType,
              notes: nextComment,
            },
          })
        } else {
          await tx.scheduleEvent.create({
            data: {
              orderId: id,
              clientId: nextClientId,
              title: nextTitle,
              startAt: nextStart,
              endAt: nextEnd,
              room: nextRoom,
              format: nextServiceType,
              notes: nextComment,
              eventType: 'STUDIO_BOOKING',
            },
          })
        }
      }
      // Если дату/время очистили у заказа с уже существующей записью в
      // расписании — саму запись в MVP не трогаем (см. п.11 ТЗ): удалять
      // Booking автоматически рискованно, оставляем её как есть.

      return tx.order.findUniqueOrThrow({ where: { id }, include: ORDER_INCLUDE })
    })

    revalidatePath('/admin/orders')
    return { ok: true, data: toDTO(order) }
  } catch (e) {
    console.error('[updateOrder]', e)
    return { ok: false, error: 'Не удалось обновить заказ' }
  }
}

// ============================================================
// СМЕНА СТАТУСА (канбан-колонки)
// ============================================================

export async function updateOrderStatus(
  id: string, status: OrderStatus
): Promise<{ ok: true; data: OrderDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  try {
    const existing = await prisma.order.findUnique({ where: { id } })
    if (!existing) return { ok: false, error: 'Заказ не найден' }

    const completedAt = status === 'COMPLETED' ? (existing.completedAt ?? new Date()) : existing.completedAt

    const updated = await prisma.order.update({
      where: { id },
      data: { status, completedAt, statusUpdatedAt: new Date() },
      include: ORDER_INCLUDE,
    })

    revalidatePath('/admin/orders')
    return { ok: true, data: toDTO(updated) }
  } catch (e) {
    console.error('[updateOrderStatus]', e)
    return { ok: false, error: 'Не удалось изменить статус заказа' }
  }
}

// ============================================================
// ПРИВЯЗАТЬ СУЩЕСТВУЮЩЕГО КЛИЕНТА К ЗАКАЗУ
// ============================================================

export async function linkOrderClient(
  orderId: string, clientId: string
): Promise<{ ok: true; data: OrderDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  try {
    const client = await prisma.client.findUnique({ where: { id: clientId } })
    if (!client) return { ok: false, error: 'Клиент не найден' }

    const order = await prisma.$transaction(async tx => {
      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          clientId,
          clientName: client.name,
          clientPhone: client.phone,
          clientTelegram: client.telegram,
          clientEmail: client.email,
          clientType: client.type,
          companyName: client.companyName,
        },
        include: { scheduleEvent: true },
      })
      if (updated.scheduleEvent) {
        await tx.scheduleEvent.update({ where: { id: updated.scheduleEvent.id }, data: { clientId } })
      }
      return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: ORDER_INCLUDE })
    })

    revalidatePath('/admin/orders')
    return { ok: true, data: toDTO(order) }
  } catch (e) {
    console.error('[linkOrderClient]', e)
    return { ok: false, error: 'Не удалось привязать клиента к заказу' }
  }
}

// ============================================================
// ИМПОРТ ИЗ GOOGLE CALENDAR — создать Order по новой студийной записи
// Вызывается из upsertScheduleEvent (schedule.ts) ТОЛЬКО в момент первого
// создания ScheduleEvent для конкретного calendarEventId — повторные
// пересохранения уже существующей аннотации сюда не попадают, поэтому
// статус заказа, once продвинутый вручную (монтаж/правки/готово), никогда
// не перезаписывается этой функцией. Google Calendar этой функцией не
// изменяется — только чтение уже переданных полей события.
// ============================================================

export interface EnsureOrderInput {
  calendarEventId: string
  title: string
  description: string | null
  startAt: Date | null
  endAt: Date | null
  clientId: string | null
}

// Простой, "неуверенный" поиск на один результат — если найдено больше одного
// или ни одного, оставляем clientId пустым (пользователь привяжет вручную).
// Точное fuzzy-сопоставление — задача следующего этапа, не MVP.
async function findSingleClientMatch(name: string): Promise<{ id: string; name: string } | null> {
  const candidates = await prisma.client.findMany({
    where: { deletedAt: null, name: { contains: name, mode: 'insensitive' } },
    select: { id: true, name: true },
    take: 2,
  })
  return candidates.length === 1 ? candidates[0] : null
}

export async function ensureOrderForNewBooking(params: EnsureOrderInput): Promise<string | null> {
  try {
    const existing = await prisma.order.findUnique({
      where: { googleEventId: params.calendarEventId },
      include: { scheduleEvent: true },
    })
    if (existing) {
      // Если у найденного заказа уже есть своя запись в расписании (другая, не
      // та, что сейчас создаётся) — не пытаемся переиспользовать orderId
      // (нарушило бы уникальность ScheduleEvent.orderId), просто не связываем.
      return existing.scheduleEvent ? null : existing.id
    }

    const parsed = parseEventTitle(params.title, params.description)
    let clientId = params.clientId
    let clientName: string | null = parsed.client

    if (!clientId && parsed.client) {
      const match = await findSingleClientMatch(parsed.client)
      if (match) { clientId = match.id; clientName = match.name }
    }

    const created = await prisma.order.create({
      data: {
        status: 'BOOKED',
        source: 'GOOGLE_CALENDAR',
        title: params.title || null,
        googleEventId: params.calendarEventId,
        clientId,
        clientName,
        serviceType: parsed.category || null,
        room: parsed.hall,
        plannedStartTime: params.startAt,
        plannedEndTime: params.endAt,
        durationMinutes: computeDurationMinutes(
          params.startAt?.toISOString(), params.endAt?.toISOString(),
        ),
      },
    })

    revalidatePath('/admin/orders')
    return created.id
  } catch (e) {
    console.error('[ensureOrderForNewBooking]', e)
    return null
  }
}
