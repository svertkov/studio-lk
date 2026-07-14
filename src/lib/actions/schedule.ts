'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import {
  type ClientConfirmationStatus, type ScheduleEvent, type SubscriptionUsage, type ClientSubscription,
  type EventType, type PaymentMethod, type MaterialsStatus, type OrderPromotionType,
  Prisma,
} from '@prisma/client'
import {
  computeMaterialsStatus, computeYandexLinkExpiry,
  type ScheduleEventDTO,
} from '@/lib/schedule-model'
import { classifyEventType } from '@/lib/event-type'
import { normalizePhone, normalizeEmail, normalizeTelegram } from '@/lib/import/normalize'
import { ensureOrderForNewBooking, updateOrderStatus } from '@/lib/actions/orders'
import { ensureMontageProjectForOrder } from '@/lib/actions/montage'
import { ORDERS_AUTO_IMPORT_LAUNCH_DATE } from '@/lib/order-model'
import { writeAuditLog as writeAuditLogEntry, resolveValidUserId } from '@/lib/audit'

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

function writeAuditLog(params: { userId: string | null; action: string; entityId: string; metadata?: Record<string, unknown> }) {
  return writeAuditLogEntry({ ...params, entityType: 'ScheduleEvent' })
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
  order: { status: string } | null
  yandexNotRequiredConfirmedBy: { name: string | null; email: string } | null
  nasNotRequiredConfirmedBy: { name: string | null; email: string } | null
}

const SCHEDULE_EVENT_INCLUDE = {
  client: { select: { name: true } },
  subscriptionUsage: { include: { subscription: { include: { usages: true } } } },
  order: { select: { status: true } },
  yandexNotRequiredConfirmedBy: { select: { name: true, email: true } },
  nasNotRequiredConfirmedBy: { select: { name: true, email: true } },
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
    promotionType: row.promotionType,
    yandexDiskUrl: row.yandexDiskUrl,
    yandexDiskUrlAddedAt: row.yandexDiskUrlAddedAt ? row.yandexDiskUrlAddedAt.toISOString() : null,
    yandexDiskUrlExpiresAt: row.yandexDiskUrlExpiresAt ? row.yandexDiskUrlExpiresAt.toISOString() : null,
    nasBackupUrl: row.nasBackupUrl,
    materialsComment: row.materialsComment,
    materialsStatus: row.materialsStatus,
    yandexLinkRequired: row.yandexLinkRequired,
    nasLinkRequired: row.nasLinkRequired,
    yandexNotRequiredConfirmedAt: row.yandexNotRequiredConfirmedAt ? row.yandexNotRequiredConfirmedAt.toISOString() : null,
    yandexNotRequiredConfirmedByName: row.yandexNotRequiredConfirmedBy?.name ?? row.yandexNotRequiredConfirmedBy?.email ?? null,
    yandexNotRequiredReason: row.yandexNotRequiredReason,
    nasNotRequiredConfirmedAt: row.nasNotRequiredConfirmedAt ? row.nasNotRequiredConfirmedAt.toISOString() : null,
    nasNotRequiredConfirmedByName: row.nasNotRequiredConfirmedBy?.name ?? row.nasNotRequiredConfirmedBy?.email ?? null,
    nasNotRequiredReason: row.nasNotRequiredReason,
    editingRequired: row.editingRequired,
    clientConfirmationStatus: row.clientConfirmationStatus,
    eventType: row.eventType,
    makeupDurationMinutes: row.makeupDurationMinutes,
    orderId: row.orderId,
    isCancelled: row.order?.status === 'CANCELLED',
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
  // Была без проверки сессии вообще — единственная функция в этом файле без
  // requireStaffSession() (найдено при добавлении нового вызова из карточки
  // клиента, см. security-проверку в отчёте). Возвращает имена/контакты
  // клиентов, суммы и ссылки на материалы — не должна быть вызываемой без
  // авторизации.
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error, data: {} }

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
  // Структурированная пометка акции — см. src/lib/promotion-model.ts.
  promotionType?: OrderPromotionType | null
  yandexDiskUrl?: string | null
  nasBackupUrl?: string | null
  materialsComment?: string
  // См. ScheduleEvent.yandexLinkRequired/nasLinkRequired.
  yandexLinkRequired?: boolean
  nasLinkRequired?: boolean
  // Причина/комментарий из ConfirmableStatusToggle — учитывается только когда
  // соответствующий *LinkRequired реально переходит true→false в этом же
  // вызове (см. upsertScheduleEvent).
  yandexNotRequiredReason?: string | null
  nasNotRequiredReason?: string | null
  editingRequired?: boolean | null
  clientConfirmationStatus?: ClientConfirmationStatus
  eventType?: EventType
  // Длительность предварительного бронирования для гримёра, в минутах —
  // null/0 означает "гримёр не предусмотрен". Не влияет на startAt/endAt/
  // estimatedPrice основной съёмки (см. schedule-model.ts).
  makeupDurationMinutes?: number | null
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

    const nextYandexLinkRequired = input.yandexLinkRequired === undefined
      ? (existing?.yandexLinkRequired ?? true)
      : input.yandexLinkRequired
    const nextNasLinkRequired = input.nasLinkRequired === undefined
      ? (existing?.nasLinkRequired ?? true)
      : input.nasLinkRequired

    const materialsStatus = computeMaterialsStatus({
      yandexDiskUrl: nextYandexUrl,
      yandexDiskUrlAddedAt,
      nasBackupUrl: nextNasUrl,
      yandexLinkRequired: nextYandexLinkRequired,
      nasLinkRequired: nextNasLinkRequired,
    })
    const yandexDiskUrlExpiresAt = yandexDiskUrlAddedAt ? computeYandexLinkExpiry(yandexDiskUrlAddedAt) : null

    // Контекст подтверждения исключения (см. ConfirmableStatusToggle,
    // prisma/schema.prisma) — заполняется только на реальном переходе
    // true→false, обнуляется на возврате false→true. Не трогаем метаданные,
    // если флаг просто пересохраняется в уже установленном состоянии false
    // (например, обновили другое поле формы, не трогая эту капсулу).
    const validUserId = await resolveValidUserId(prisma, authResult.userId)
    const wasYandexNotRequired = existing?.yandexLinkRequired === false
    const wasNasNotRequired = existing?.nasLinkRequired === false

    const yandexNotRequiredConfirmedAt = nextYandexLinkRequired
      ? null
      : wasYandexNotRequired ? (existing!.yandexNotRequiredConfirmedAt ?? new Date()) : new Date()
    const yandexNotRequiredConfirmedById = nextYandexLinkRequired
      ? null
      : wasYandexNotRequired ? (existing!.yandexNotRequiredConfirmedById ?? null) : validUserId
    const yandexNotRequiredReason = nextYandexLinkRequired
      ? null
      : wasYandexNotRequired
        ? (input.yandexNotRequiredReason !== undefined ? (input.yandexNotRequiredReason?.trim() || null) : existing!.yandexNotRequiredReason)
        : (input.yandexNotRequiredReason?.trim() || null)

    const nasNotRequiredConfirmedAt = nextNasLinkRequired
      ? null
      : wasNasNotRequired ? (existing!.nasNotRequiredConfirmedAt ?? new Date()) : new Date()
    const nasNotRequiredConfirmedById = nextNasLinkRequired
      ? null
      : wasNasNotRequired ? (existing!.nasNotRequiredConfirmedById ?? null) : validUserId
    const nasNotRequiredReason = nextNasLinkRequired
      ? null
      : wasNasNotRequired
        ? (input.nasNotRequiredReason !== undefined ? (input.nasNotRequiredReason?.trim() || null) : existing!.nasNotRequiredReason)
        : (input.nasNotRequiredReason?.trim() || null)

    const effectiveEventType = input.eventType ?? classifyEventType(input.title ?? '')

    // Заказ (раздел "Заказы") создаётся только в момент ПЕРВОГО сохранения
    // студийной записи из живого Google Calendar — не при последующих
    // пересохранениях уже существующей аннотации, чтобы не перезаписывать
    // статус заказа, который могли уже вручную продвинуть по канбану. Плюс
    // не раньше ORDERS_AUTO_IMPORT_LAUNCH_DATE — раздел "Заказы" начинается с
    // чистого листа, старые записи не должны задним числом становиться
    // заказами только из-за того, что кто-то открыл и сохранил их карточку.
    // Google Calendar здесь только читается (через уже переданные input),
    // ничего не пишется обратно.
    const startsAfterOrdersLaunch = !!input.startAt && new Date(input.startAt) >= ORDERS_AUTO_IMPORT_LAUNCH_DATE
    let orderIdForCreate: string | null = null
    if (!existing && effectiveEventType === 'STUDIO_BOOKING' && startsAfterOrdersLaunch) {
      orderIdForCreate = await ensureOrderForNewBooking({
        calendarEventId: input.calendarEventId,
        title: input.title ?? '',
        description: input.description ?? null,
        startAt: input.startAt ? new Date(input.startAt) : null,
        endAt: input.endAt ? new Date(input.endAt) : null,
        clientId: input.clientId ?? null,
      })
    }

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
        promotionType: input.promotionType ?? null,
        yandexDiskUrl: nextYandexUrl,
        yandexDiskUrlAddedAt,
        yandexDiskUrlExpiresAt,
        nasBackupUrl: nextNasUrl,
        materialsComment: input.materialsComment?.trim() || null,
        materialsStatus,
        yandexLinkRequired: nextYandexLinkRequired,
        nasLinkRequired: nextNasLinkRequired,
        yandexNotRequiredConfirmedAt,
        yandexNotRequiredConfirmedById,
        yandexNotRequiredReason,
        nasNotRequiredConfirmedAt,
        nasNotRequiredConfirmedById,
        nasNotRequiredReason,
        editingRequired: input.editingRequired ?? null,
        clientConfirmationStatus: input.clientConfirmationStatus ?? 'NOT_REQUIRED',
        eventType: effectiveEventType,
        makeupDurationMinutes: input.makeupDurationMinutes ?? null,
        orderId: orderIdForCreate,
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
        ...(input.promotionType !== undefined && { promotionType: input.promotionType }),
        yandexDiskUrl: nextYandexUrl,
        yandexDiskUrlAddedAt,
        yandexDiskUrlExpiresAt,
        nasBackupUrl: nextNasUrl,
        ...(input.materialsComment !== undefined && { materialsComment: input.materialsComment?.trim() || null }),
        materialsStatus,
        yandexLinkRequired: nextYandexLinkRequired,
        nasLinkRequired: nextNasLinkRequired,
        yandexNotRequiredConfirmedAt,
        yandexNotRequiredConfirmedById,
        yandexNotRequiredReason,
        nasNotRequiredConfirmedAt,
        nasNotRequiredConfirmedById,
        nasNotRequiredReason,
        ...(input.editingRequired !== undefined && { editingRequired: input.editingRequired }),
        ...(input.clientConfirmationStatus !== undefined && { clientConfirmationStatus: input.clientConfirmationStatus }),
        ...(input.eventType !== undefined && { eventType: input.eventType }),
        ...(input.makeupDurationMinutes !== undefined && { makeupDurationMinutes: input.makeupDurationMinutes }),
      },
      include: SCHEDULE_EVENT_INCLUDE,
    })

    // Автоперевод связанного заказа по воронке — только когда решение по
    // монтажу только что сохранено (true/false, не null) И заказ всё ещё в
    // «Записан в студию». Второе условие — защита именно того, что просили:
    // если заказ уже вручную продвинут дальше (Монтаж/Правки/Завершено/Отказ),
    // повторное сохранение карточки записи (например, правка комментария)
    // больше не должно его трогать.
    if (row.orderId && (input.editingRequired === true || input.editingRequired === false)) {
      const linkedOrder = await prisma.order.findUnique({ where: { id: row.orderId }, select: { status: true } })
      if (linkedOrder?.status === 'BOOKED') {
        await updateOrderStatus(row.orderId, input.editingRequired ? 'EDITING' : 'COMPLETED')
      }
    }

    // Проект монтажа (раздел "Монтаж") создаётся один раз, в момент когда
    // "Монтаж требуется" ВПЕРВЫЕ сохраняется как true — не при каждом
    // пересохранении карточки записи и не когда монтаж уже был true раньше
    // (ensureMontageProjectForOrder сама идемпотентна, но лишний запрос на
    // каждое сохранение комментария/материалов не нужен). Срабатывает
    // независимо от текущего статуса заказа (в отличие от автоперехода
    // статуса выше) — решение можно поменять и после того, как заказ уже
    // продвинут дальше "Записан в студию".
    if (row.orderId && input.editingRequired === true && existing?.editingRequired !== true) {
      await ensureMontageProjectForOrder(row.orderId)
    }

    // Значимое бизнес-исключение (ConfirmableStatusToggle) — фиксируем в
    // audit log, только когда значение реально изменилось (не на каждый save).
    if (existing && existing.yandexLinkRequired !== nextYandexLinkRequired) {
      await writeAuditLog({
        userId: authResult.userId, action: 'SCHEDULE_EVENT_YANDEX_LINK_REQUIRED_CHANGED', entityId: row.id,
        metadata: { before: existing.yandexLinkRequired, after: nextYandexLinkRequired, reason: yandexNotRequiredReason },
      })
    }
    if (existing && existing.nasLinkRequired !== nextNasLinkRequired) {
      await writeAuditLog({
        userId: authResult.userId, action: 'SCHEDULE_EVENT_NAS_LINK_REQUIRED_CHANGED', entityId: row.id,
        metadata: { before: existing.nasLinkRequired, after: nextNasLinkRequired, reason: nasNotRequiredReason },
      })
    }

    revalidatePath('/admin/schedule')
    if (input.clientConfirmationStatus !== undefined || input.clientId !== undefined) {
      revalidatePath('/admin/clients')
    }
    // Карточка клиента (вкладка "Съёмки"), CRM-воронка и список заказов читают
    // notes/makeupDurationMinutes/материалы этой же записи — без явной
    // инвалидации здесь администратор увидел бы изменения только после
    // ручной перезагрузки.
    if (row.clientId) revalidatePath(`/admin/clients/${row.clientId}`)
    if (row.orderId) { revalidatePath('/admin/crm'); revalidatePath('/admin/orders') }
    // Стоимость/способ оплаты/абонемент этой же записи считаются в "Финансы"
    // (выручка, средний чек) и влияют на карточки "Требуют внимания" на
    // дашборде — та же логика, что и выше: без явной инвалидации оба раздела
    // показали бы устаревшие цифры до ручной перезагрузки.
    revalidatePath('/admin/finance')
    revalidatePath('/admin/dashboard')

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
  // См. заметку у getScheduleAnnotations выше — тот же пробел, тот же файл,
  // тот же класс данных (контакты/суммы), исправлено в одном заходе.
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }

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
  // См. заметку у getScheduleAnnotations выше. Эта функция особенно важна
  // защитить: без сессии это фактически открытый поиск по базе клиентов.
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }

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
  // См. заметку у getScheduleAnnotations выше — эта к тому же ЗАПИСЫВАЕТ в
  // базу (upsert), без сессии это была открытая на запись форма.
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

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
  // Добавлено для раздела "Записи" в карточке клиента — краткий список всех
  // записей клиента должен показывать статус материалов и наличие ссылок,
  // не только оплату (см. materialsStatus в ScheduleEvent).
  yandexDiskUrl: string | null
  nasBackupUrl: string | null
  materialsStatus: MaterialsStatus
}

export async function getClientScheduleBookings(clientId: string): Promise<
  { ok: true; data: ClientBookingDTO[] } | { ok: false; data: ClientBookingDTO[]; error: string }
> {
  // Тоже была без проверки сессии (см. ту же заметку у getScheduleAnnotations
  // выше) — отдаёт даты записей, суммы и статус материалов клиента.
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }

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
      yandexDiskUrl: r.yandexDiskUrl,
      nasBackupUrl: r.nasBackupUrl,
      materialsStatus: r.materialsStatus,
    }))

    return { ok: true, data }
  } catch (e) {
    console.error('[getClientScheduleBookings]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить записи расписания клиента' }
  }
}
