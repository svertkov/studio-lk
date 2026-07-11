'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import type {
  Order, Client, ScheduleEvent,
  OrderStatus, OrderSource, OrderPaymentStatus, PaymentMethod, ClientType, OrderPromotionType,
} from '@prisma/client'
import { computeDurationMinutes, isOrderReadyForArchive, archiveReasonForStatus } from '@/lib/order-model'
import { computeMaterialsStatus, computeYandexLinkExpiry } from '@/lib/schedule-model'
import { parseEventTitle } from '@/lib/event-category'
import type { ArchiveReason } from '@prisma/client'

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

// CRM-воронка (/admin/crm) и список заказов (/admin/orders) читают одни и те
// же строки Order — любая мутация заказа должна инвалидировать оба экрана
// разом, иначе один из них показывает устаревшие данные до ручного refresh.
function revalidateOrderPaths(): void {
  revalidatePath('/admin/crm')
  revalidatePath('/admin/orders')
}

// ============================================================
// СЕРИАЛИЗАЦИЯ
// ============================================================

type OrderClient = Pick<Client, 'name' | 'phone' | 'telegram' | 'email' | 'type' | 'companyName'>
type OrderScheduleEvent = Pick<ScheduleEvent,
  'id' | 'camerasCount' | 'editingRequired' | 'yandexDiskUrl' | 'yandexDiskUrlExpiresAt' | 'nasBackupUrl' |
  'materialsComment' | 'notes' | 'makeupDurationMinutes' | 'promotionType'>
type OrderWithRelations = Order & { client: OrderClient | null; scheduleEvent: OrderScheduleEvent | null }

const ORDER_INCLUDE = {
  client: { select: { name: true, phone: true, telegram: true, email: true, type: true, companyName: true } },
  scheduleEvent: {
    select: {
      id: true, camerasCount: true, editingRequired: true,
      yandexDiskUrl: true, yandexDiskUrlExpiresAt: true, nasBackupUrl: true, materialsComment: true,
      notes: true, makeupDurationMinutes: true, promotionType: true,
    },
  },
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
  // Структурированная пометка акции — источник правды для карточки заказа и
  // для отображения (см. src/lib/promotion-model.ts: getOrderPromotion). Тот
  // же принцип двойного источника, что и у comment: если есть связанная
  // ScheduleEvent, её promotionType побеждает.
  promotionType: OrderPromotionType | null
  googleEventId: string | null
  hasBooking: boolean
  // Снимок части полей связанной записи расписания (см. ScheduleEvent) — их
  // источник правды там, здесь только для отображения на карточке заказа,
  // чтобы не открывать отдельно карточку записи ради зала/камер/монтажа.
  camerasCount: number | null
  editingRequired: boolean | null
  hasMaterials: boolean
  // Сырые ссылки на материалы — источник правды на связанной ScheduleEvent,
  // здесь только для отображения кликабельных плашек в списке заказов и для
  // редактирования из карточки заказа (см. OrderFormModal, раздел
  // "Материалы и монтаж" — доступен только когда hasBooking).
  yandexDiskUrl: string | null
  yandexDiskUrlExpiresAt: string | null
  nasBackupUrl: string | null
  materialsComment: string | null
  // Время на гримёра — источник правды на связанной ScheduleEvent (её
  // редактируют через основную карточку записи), у заявок без записи всегда null.
  makeupDurationMinutes: number | null
  createdAt: string
  updatedAt: string
  statusUpdatedAt: string
  completedAt: string | null
  rejectedAt: string | null
  isArchived: boolean
  archivedAt: string | null
  archiveReason: ArchiveReason | null
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
    // Реальная точка редактирования комментария — основная карточка записи
    // (EventCardModal, поле "Комментарий / нюансы" -> ScheduleEvent.notes),
    // не сама карточка заказа. Если запись уже существует, её notes и есть
    // актуальный комментарий; Order.comment остаётся источником только для
    // заявок без записи в расписании (единый источник данных, без дублей).
    comment: row.scheduleEvent?.notes ?? row.comment,
    promotionType: row.scheduleEvent?.promotionType ?? row.promotionType,
    googleEventId: row.googleEventId,
    hasBooking: !!row.scheduleEvent,
    camerasCount: row.scheduleEvent?.camerasCount ?? null,
    editingRequired: row.scheduleEvent?.editingRequired ?? null,
    hasMaterials: !!(row.scheduleEvent?.yandexDiskUrl || row.scheduleEvent?.nasBackupUrl),
    yandexDiskUrl: row.scheduleEvent?.yandexDiskUrl ?? null,
    yandexDiskUrlExpiresAt: row.scheduleEvent?.yandexDiskUrlExpiresAt
      ? row.scheduleEvent.yandexDiskUrlExpiresAt.toISOString() : null,
    nasBackupUrl: row.scheduleEvent?.nasBackupUrl ?? null,
    materialsComment: row.scheduleEvent?.materialsComment ?? null,
    makeupDurationMinutes: row.scheduleEvent?.makeupDurationMinutes ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    statusUpdatedAt: row.statusUpdatedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    rejectedAt: row.rejectedAt ? row.rejectedAt.toISOString() : null,
    isArchived: row.isArchived,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    archiveReason: row.archiveReason,
  }
}

// ============================================================
// АРХИВАЦИЯ — единственное место, где isArchived реально проставляется.
// Вызывается в начале getActiveOrders/getArchivedOrders (вариант 1 из ТЗ:
// проверка при загрузке раздела), поэтому отдельный cron не нужен — свежесть
// не критична (7 дней — не секунды), а свип идёт от чтения самого частого
// экрана. isOrderReadyForArchive (order-model.ts) — тот же порог 7 дней,
// здесь просто транслируется в Prisma-условие для bulk-update.
//
// isArchived: false в WHERE — единственная защита от того, чтобы вручную
// возвращённый ("Вернуть из архива") заказ тут же не улетел обратно: пока
// пользователь не поменяет статус ещё раз, isArchived остаётся false и этот
// where больше не совпадает, даже если completedAt/rejectedAt всё ещё старше
// 7 дней (см. unarchiveOrder и manuallyUnarchivedAt в схеме).
// ============================================================

// Prisma не умеет сравнивать две колонки одной строки в where, а без этого
// сравнения (manuallyUnarchivedAt vs statusUpdatedAt) вручную возвращённый
// заказ тут же попал бы обратно под updateMany ниже, стоит только
// completedAt/rejectedAt остаться старше 7 дней. Поэтому кандидатов сначала
// выбираем обычным findMany (их всегда мало — не полнотабличный скан) и
// фильтруем в JS, и только оставшихся — одним updateMany.
// Кандидатов на архивацию всегда мало (только COMPLETED/CANCELLED, ещё не
// заархивированные — это и так узкий "хвост" воронки), поэтому дешевле
// вытащить их все и прогнать через isOrderReadyForArchive (единственный
// источник правды про порог 7 дней, order-model.ts), чем повторять расчёт
// порога отдельно в Prisma where.
async function archiveEligibleIds(status: 'COMPLETED' | 'CANCELLED'): Promise<string[]> {
  const candidates = await prisma.order.findMany({
    where: { isArchived: false, status },
    select: { id: true, status: true, completedAt: true, rejectedAt: true, statusUpdatedAt: true, manuallyUnarchivedAt: true },
  })
  return candidates
    .filter(o => isOrderReadyForArchive(o))
    .filter(o => !o.manuallyUnarchivedAt || o.statusUpdatedAt > o.manuallyUnarchivedAt)
    .map(o => o.id)
}

async function archiveEligibleOrders(): Promise<void> {
  const completedIds = await archiveEligibleIds('COMPLETED')
  if (completedIds.length > 0) {
    await prisma.order.updateMany({
      where: { id: { in: completedIds } },
      data: { isArchived: true, archivedAt: new Date(), archiveReason: 'COMPLETED' },
    })
  }

  const cancelledIds = await archiveEligibleIds('CANCELLED')
  if (cancelledIds.length > 0) {
    await prisma.order.updateMany({
      where: { id: { in: cancelledIds } },
      data: { isArchived: true, archivedAt: new Date(), archiveReason: 'REJECTED' },
    })
  }
}

// ============================================================
// СПИСОК ЗАКАЗОВ — АКТИВНАЯ ВОРОНКА
// ============================================================

export async function getActiveOrders(): Promise<
  { ok: true; data: OrderDTO[] } | { ok: false; data: OrderDTO[]; error: string }
> {
  // Обнаружено при расширении OrderDTO (зал/камеры/статус монтажа из
  // ScheduleEvent): у функции не было проверки сессии вовсе — 'use server' в
  // начале файла делает её вызываемой напрямую как server action, в обход
  // защиты уровня страницы /admin/orders. Раньше это уже отдавало имена,
  // телефоны и выручку клиентов без авторизации; теперь ещё и зал/камеры/
  // статус монтажа — повод исправить сейчас же, а не откладывать.
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }

  try {
    await archiveEligibleOrders()
    // CANCELLED — видимая колонка канбана "Отказы" (см. order-model.ts).
    // ARCHIVED (статус) по-прежнему исключён на всякий случай — ему никогда
    // ничего не присваивается, но это не то же самое, что isArchived: false.
    const rows = await prisma.order.findMany({
      where: { status: { not: 'ARCHIVED' }, isArchived: false },
      orderBy: { createdAt: 'desc' },
      include: ORDER_INCLUDE,
    })
    return { ok: true, data: rows.map(toDTO) }
  } catch (e) {
    console.error('[getActiveOrders]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить заказы' }
  }
}

// ============================================================
// СПИСОК ЗАКАЗОВ — АРХИВ
// ============================================================

export async function getArchivedOrders(): Promise<
  { ok: true; data: OrderDTO[] } | { ok: false; data: OrderDTO[]; error: string }
> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }

  try {
    await archiveEligibleOrders()
    const rows = await prisma.order.findMany({
      where: { isArchived: true },
      orderBy: { archivedAt: 'desc' },
      include: ORDER_INCLUDE,
    })
    return { ok: true, data: rows.map(toDTO) }
  } catch (e) {
    console.error('[getArchivedOrders]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить архив заказов' }
  }
}

// ============================================================
// СПИСОК ЗАКАЗОВ — ПОЛНЫЙ (раздел "Заказы") — единый источник для
// хронологического списка/таблицы всех реальных заказов, активных и
// архивных разом (см. ТЗ раздела "Заказы": "не скрывать исторические заказы
// навсегда"). Использует ту же ORDER_INCLUDE/toDTO, что и getActiveOrders/
// getArchivedOrders — те же строки Order, без отдельной сущности или копии
// данных. ARCHIVED (статус, не путать с isArchived) по-прежнему исключён —
// ему никогда ничего не присваивается, см. order-model.ts.
// ============================================================

export async function getAllOrders(): Promise<
  { ok: true; data: OrderDTO[] } | { ok: false; data: OrderDTO[]; error: string }
> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }

  try {
    await archiveEligibleOrders()
    const rows = await prisma.order.findMany({
      where: { status: { not: 'ARCHIVED' } },
      orderBy: { createdAt: 'desc' },
      include: ORDER_INCLUDE,
    })
    return { ok: true, data: rows.map(toDTO) }
  } catch (e) {
    console.error('[getAllOrders]', e)
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
  // Структурированная пометка акции — см. OrderDTO.promotionType и
  // src/lib/promotion-model.ts. Общее поле заказа (не завязано на наличие
  // записи в расписании, в отличие от блока "Материалы и монтаж" ниже) —
  // акцию можно отметить и на заявке без даты.
  promotionType?: OrderPromotionType | null
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
  // Материалы/гримёр/монтаж — применяются только когда у заказа уже есть своя
  // запись в расписании (см. OrderFormModal, секция "Материалы и монтаж",
  // видима только при order.hasBooking). Источник правды остаётся на
  // ScheduleEvent, как и для остальных полей записи — см. комментарий у
  // OrderDTO.yandexDiskUrl.
  makeupDurationMinutes?: number | null
  editingRequired?: boolean | null
  yandexDiskUrl?: string | null
  nasBackupUrl?: string | null
  materialsComment?: string
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
          promotionType: input.promotionType ?? null,
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
            promotionType: created.promotionType,
            eventType: 'STUDIO_BOOKING',
          },
        })
      }

      return tx.order.findUniqueOrThrow({ where: { id: created.id }, include: ORDER_INCLUDE })
    })

    revalidateOrderPaths()
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
    const nextPromotionType = input.promotionType !== undefined ? input.promotionType : existing.promotionType
    const nextStart = input.plannedStartTime !== undefined
      ? (input.plannedStartTime ? new Date(input.plannedStartTime) : null)
      : existing.plannedStartTime
    const nextEnd = input.plannedEndTime !== undefined
      ? (input.plannedEndTime ? new Date(input.plannedEndTime) : null)
      : existing.plannedEndTime
    const hasBookingTimeNow = !!(nextStart && nextEnd)
    const hadBookingBefore = !!existing.scheduleEvent

    // Автоперевод статуса (см. ниже) обязан выполниться ПОСЛЕ коммита
    // транзакции: updateOrderStatus пишет через отдельный prisma-клиент, а не
    // через tx, и вызов его изнутри ещё не закоммиченной транзакции держал бы
    // её в ожидании лока на той же строке Order, которую tx.order.update уже
    // заблокировал — классический self-deadlock. Поэтому транзакция только
    // решает, нужен ли автоперевод (autoTransitionStatus), а сам вызов — уже
    // после await prisma.$transaction(...).
    let autoTransitionStatus: 'EDITING' | 'COMPLETED' | null = null

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
          promotionType: nextPromotionType,
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
          // Материалы/гримёр/монтаж — та же логика вычисления даты добавления
          // ссылки и срока её жизни, что и в upsertScheduleEvent (см.
          // src/lib/actions/schedule.ts): сервер сам решает "возраст" ссылки,
          // клиенту не доверяем. Эта ветка (обновление уже существующей
          // ScheduleEvent) — единственное место в orders.ts, где эти поля
          // реально применяются, см. OrderInput.yandexDiskUrl и др.
          const se = updated.scheduleEvent
          const nextYandexUrl = input.yandexDiskUrl === undefined
            ? se.yandexDiskUrl
            : (input.yandexDiskUrl?.trim() || null)
          const yandexDiskUrlAddedAt = nextYandexUrl === null
            ? null
            : nextYandexUrl !== se.yandexDiskUrl
              ? new Date()
              : (se.yandexDiskUrlAddedAt ?? new Date())
          const nextNasUrl = input.nasBackupUrl === undefined
            ? se.nasBackupUrl
            : (input.nasBackupUrl?.trim() || null)
          const materialsStatus = computeMaterialsStatus({
            yandexDiskUrl: nextYandexUrl, yandexDiskUrlAddedAt, nasBackupUrl: nextNasUrl,
          })
          const yandexDiskUrlExpiresAt = yandexDiskUrlAddedAt ? computeYandexLinkExpiry(yandexDiskUrlAddedAt) : null

          await tx.scheduleEvent.update({
            where: { id: se.id },
            data: {
              clientId: nextClientId,
              title: nextTitle,
              startAt: nextStart,
              endAt: nextEnd,
              room: nextRoom,
              format: nextServiceType,
              notes: nextComment,
              promotionType: nextPromotionType,
              yandexDiskUrl: nextYandexUrl,
              yandexDiskUrlAddedAt,
              yandexDiskUrlExpiresAt,
              nasBackupUrl: nextNasUrl,
              materialsStatus,
              ...(input.materialsComment !== undefined && { materialsComment: input.materialsComment?.trim() || null }),
              ...(input.editingRequired !== undefined && { editingRequired: input.editingRequired }),
              ...(input.makeupDurationMinutes !== undefined && { makeupDurationMinutes: input.makeupDurationMinutes }),
            },
          })

          // Тот же автоперевод по воронке, что и при сохранении карточки
          // записи из "Расписания" (см. upsertScheduleEvent) — решение по
          // монтажу только что сохранено (true/false, не null) и заказ ещё
          // в "Записан в студию" -> двигаем на "Монтаж"/"Завершено". Если
          // заказ уже продвинут вручную дальше, повторное сохранение карточки
          // (например, правка комментария) его не трогает. Сам вызов
          // updateOrderStatus — после транзакции, см. autoTransitionStatus выше.
          if (input.editingRequired !== undefined && input.editingRequired !== null && existing.status === 'BOOKED') {
            autoTransitionStatus = input.editingRequired ? 'EDITING' : 'COMPLETED'
          }
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
              promotionType: nextPromotionType,
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

    // Автоперевод статуса (см. autoTransitionStatus выше) — уже вне
    // транзакции. updateOrderStatus сама делает revalidateOrderPaths и
    // возвращает свежий DTO с обновлённым статусом — используем его, чтобы
    // не возвращать вызывающей стороне устаревший (дотранзакционный) статус.
    if (autoTransitionStatus) {
      const statusResult = await updateOrderStatus(id, autoTransitionStatus)
      if (statusResult.ok) return statusResult
    }

    revalidateOrderPaths()
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
    // rejectedAt — тот же принцип, что у completedAt: выставляется один раз
    // при первом переходе в CANCELLED, дальше не трогается.
    const rejectedAt = status === 'CANCELLED' ? (existing.rejectedAt ?? new Date()) : existing.rejectedAt
    // Заказ покидает финальный статус (COMPLETED/CANCELLED) — архивный оверлей
    // больше не может быть актуален, иначе он завис бы "заархивированным" в
    // активной колонке канбана. Для самих COMPLETED/CANCELLED isArchived не
    // трогаем здесь вовсе — им управляет только archiveEligibleOrders
    // (см. getActiveOrders/getArchivedOrders) и unarchiveOrder.
    const archiveReset = archiveReasonForStatus(status) === null
      ? { isArchived: false, archivedAt: null, archiveReason: null }
      : {}

    const updated = await prisma.order.update({
      where: { id },
      data: { status, completedAt, rejectedAt, statusUpdatedAt: new Date(), ...archiveReset },
      include: ORDER_INCLUDE,
    })

    revalidateOrderPaths()
    return { ok: true, data: toDTO(updated) }
  } catch (e) {
    console.error('[updateOrderStatus]', e)
    return { ok: false, error: 'Не удалось изменить статус заказа' }
  }
}

// ============================================================
// ВЕРНУТЬ ЗАКАЗ ИЗ АРХИВА (вручную, на случай ошибки автосвипа)
// ============================================================

export async function unarchiveOrder(
  id: string
): Promise<{ ok: true; data: OrderDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  try {
    const existing = await prisma.order.findUnique({ where: { id } })
    if (!existing) return { ok: false, error: 'Заказ не найден' }
    if (!existing.isArchived) return { ok: false, error: 'Заказ не находится в архиве' }

    // manuallyUnarchivedAt — единственное, что мешает archiveEligibleOrders
    // тут же снова заархивировать этот же заказ на следующей загрузке страницы
    // (см. комментарий у archiveEligibleOrders и у Order.manuallyUnarchivedAt
    // в схеме): свип матчит только isArchived: false, но заказ статуса
    // COMPLETED/CANCELLED старше 7 дней сам по себе всегда будет "подходить"
    // под правило — единственное, что реально меняется после ручного
    // возврата, это факт наличия manuallyUnarchivedAt позже statusUpdatedAt.
    const updated = await prisma.order.update({
      where: { id },
      data: { isArchived: false, archivedAt: null, archiveReason: null, manuallyUnarchivedAt: new Date() },
      include: ORDER_INCLUDE,
    })

    revalidateOrderPaths()
    revalidatePath('/admin/crm/archive')
    return { ok: true, data: toDTO(updated) }
  } catch (e) {
    console.error('[unarchiveOrder]', e)
    return { ok: false, error: 'Не удалось вернуть заказ из архива' }
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

    revalidateOrderPaths()
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

    revalidateOrderPaths()
    return created.id
  } catch (e) {
    console.error('[ensureOrderForNewBooking]', e)
    return null
  }
}
