// Материалы и статус подтверждения клиента для событий расписания —
// зеркало Prisma-энумов, лейблы UI и чистая бизнес-логика вычисления статуса.
//
// ScheduleEvent в БД — это АННОТАЦИЯ к событию Google Calendar, не его копия.
// Название/время события всегда берутся из живого календаря (CalendarEvent);
// поля title/description/startAt/endAt в самой аннотации — денормализованный
// снэпшот только для контекстов, которые не могут дёрнуть Google Calendar API
// (например блок "Клиенты из расписания" на странице Клиентов).

import type { ClientConfirmationStatus, MaterialsStatus, PaymentMethod } from '@prisma/client'
import type { CalendarEvent } from '@/lib/google-calendar'
import { type EventType, classifyEventType } from '@/lib/event-type'

export type { MaterialsStatus, ClientConfirmationStatus, EventType, PaymentMethod }

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH:         'Наличными',
  CARD:         'Картой',
  TRANSFER:     'Переводом',
  INVOICE:      'По счёту',
  UNPAID:       'Не оплачено',
  FREE:         'Бесплатно / бартер',
  OTHER:        'Другое',
  // Оплата по абонементу у записи расписания выбирается отдельным переключателем
  // (SubscriptionPaymentBlock), а не этим полем — см. ONE_TIME_PAYMENT_METHODS.
  SUBSCRIPTION: 'Абонемент',
}

// Варианты разовой оплаты для select в карточке события — без SUBSCRIPTION,
// это самостоятельный "Абонемент"-переключатель, а не значение этого поля.
export const ONE_TIME_PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'CARD', 'TRANSFER', 'INVOICE', 'UNPAID', 'FREE', 'OTHER']

export const MATERIALS_STATUS_LABELS: Record<MaterialsStatus, string> = {
  NO_LINKS:        'Нет ссылок',
  YANDEX_ACTIVE:   'Яндекс.Диск активен',
  YANDEX_EXPIRED:  'Ссылка истекла',
  BACKUP_EXISTS:   'Есть бэкап на NAS',
  NEEDS_ATTENTION: 'Требует внимания',
}

export const MATERIALS_STATUS_COLORS: Record<MaterialsStatus, string> = {
  NO_LINKS:        'border-zinc-600 text-zinc-400',
  YANDEX_ACTIVE:   'border-green-700 text-green-400',
  YANDEX_EXPIRED:  'border-amber-600 text-amber-400',
  BACKUP_EXISTS:   'border-blue-700 text-blue-400',
  NEEDS_ATTENTION: 'border-red-700 text-red-400',
}

export const CLIENT_CONFIRMATION_STATUS_LABELS: Record<ClientConfirmationStatus, string> = {
  NOT_REQUIRED: 'Не требуется',
  PENDING:      'Ожидает подтверждения',
  CONFIRMED:    'Подтверждён',
  IGNORED:      'Проигнорирован',
}

export const YANDEX_LINK_EXPIRY_DAYS = 14
const EXPIRY_MS = YANDEX_LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000

export interface MaterialsStatusInput {
  yandexDiskUrl: string | null | undefined
  yandexDiskUrlAddedAt: Date | null | undefined
  nasBackupUrl: string | null | undefined
}

export function computeYandexLinkExpiry(addedAt: Date): Date {
  return new Date(addedAt.getTime() + EXPIRY_MS)
}

function isYandexExpired(addedAt: Date, now: Date): boolean {
  return now.getTime() - addedAt.getTime() > EXPIRY_MS
}

// Единственный источник правды для materials_status — вызывается на сервере
// при каждом сохранении события (upsertScheduleEvent), клиенту не доверяем.
export function computeMaterialsStatus(input: MaterialsStatusInput, now: Date = new Date()): MaterialsStatus {
  const hasYandex = !!input.yandexDiskUrl
  const hasNas = !!input.nasBackupUrl

  if (!hasYandex && !hasNas) return 'NO_LINKS'
  if (!hasYandex && hasNas) return 'BACKUP_EXISTS'

  const expired = input.yandexDiskUrlAddedAt ? isYandexExpired(input.yandexDiskUrlAddedAt, now) : false
  if (!expired) return 'YANDEX_ACTIVE'
  return hasNas ? 'YANDEX_EXPIRED' : 'NEEDS_ATTENTION'
}

// Нужен ли значок "нет вообще никаких ссылок на материалы" в календаре
export function needsNoLinksWarning(input: MaterialsStatusInput): boolean {
  return !input.yandexDiskUrl && !input.nasBackupUrl
}

// Мягкая информационная подсказка — показывается, только когда обе ссылки
// заполнены (NAS есть), но срок Яндекс.Диска истёк. Не влияет на статус
// "требует внимания" (NAS уже есть — критичной проблемы нет).
export const MATERIALS_WARNING_TEXT: Partial<Record<MaterialsStatus, string>> = {
  YANDEX_EXPIRED: 'Срок действия ссылки на Яндекс.Диск истёк. Проверьте, можно ли удалить материалы с Яндекс.Диска, если бэкап на NAS сохранён.',
}

// ============================================================
// UI-СЛОЙ ОТОБРАЖЕНИЯ СТАТУСА (не меняет хранимый в БД MaterialsStatus,
// только уточняет метку/цвет для интерфейса)
// ============================================================

export type MaterialsSeverity = 'danger' | 'warning' | 'info' | 'success' | 'neutral'

export interface MaterialsDisplay {
  label: string
  severity: MaterialsSeverity
}

// Ссылка на Яндекс.Диск — главное условие: она одна снимает предупреждение
// независимо от NAS. NAS-бэкап — это плюс сверху, а не обязательное условие
// (явное решение владельца, 2026-07-06 — раньше было наоборот: NAS считался
// критичным, а "Яндекс.Диск есть, NAS нет" показывалось как danger; это
// мешало реальной работе — карточка оставалась в предупреждении даже когда
// клиенту материалы уже фактически отданы через Яндекс.Диск). В БД
// YANDEX_ACTIVE не отличает "есть оба линка" от "есть только Яндекс.Диск" —
// здесь это разделяем по факту наличия nasBackupUrl, не трогая сам enum.
export function getMaterialsDisplay(input: {
  materialsStatus: MaterialsStatus
  nasBackupUrl?: string | null
}): MaterialsDisplay {
  switch (input.materialsStatus) {
    case 'NO_LINKS':        return { label: 'Нет материалов', severity: 'danger' }
    case 'BACKUP_EXISTS':   return { label: 'Нет Яндекс.Диска', severity: 'warning' }
    case 'NEEDS_ATTENTION': return { label: 'Нет NAS-бэкапа', severity: 'danger' }
    // Оба поля когда-то были заполнены, NAS уже есть — не критично, просто
    // ссылка на Яндекс.Диск устарела (её можно перевыпустить или удалить).
    case 'YANDEX_EXPIRED':  return { label: 'Ссылка истекла', severity: 'warning' }
    case 'YANDEX_ACTIVE':
      return input.nasBackupUrl
        ? { label: 'Материалы сохранены', severity: 'success' }
        : { label: 'Яндекс.Диск указан', severity: 'success' }
  }
}

export const MATERIALS_SEVERITY_TEXT_COLOR: Record<MaterialsSeverity, string> = {
  danger:  'text-red-400',
  warning: 'text-amber-400',
  info:    'text-blue-400',
  success: 'text-green-500',
  neutral: 'text-zinc-400',
}

// Тревожная подсветка карточки для проблемных событий — переиспользуется
// в Day/Week/Month видах расписания и в блоке проблемных съёмок на дашборде.
export const PROBLEM_GLOW_CARD_CLASS =
  'border-red-600/60 bg-red-950/30 shadow-[0_0_14px_rgba(239,68,68,0.22)]'

// Отслеживание материалов появилось в системе только с этой даты — съёмки,
// которые НАЧАЛИСЬ раньше, никогда не помечаются проблемными, даже если ссылок
// нет и они уже прошли. Иначе фича сразу пометила бы красным весь ранее
// накопленный архив клиентов, где материалы никогда не заводились в системе
// (пользователь явно попросил не задевать прошлые записи при внедрении).
export const MATERIALS_TRACKING_LAUNCH_DATE = new Date('2026-07-03T00:00:00')

// ============================================================
// ПРОБЛЕМЫ ЗАПИСИ (booking issues) — единственный источник правды для
// подсветки мини-карточек в расписании и для блока "Записи требуют внимания"
// на дашборде. Проверяется только STUDIO_BOOKING (встречи/отсутствия
// сотрудников/служебные пометки никогда не считаются проблемными) и только
// для уже прошедших записей — будущая запись без материалов/оплаты это норма.
// ============================================================

export type BookingIssueType = 'materials_missing' | 'payment_missing'
export type IssueSeverity = 'danger' | 'warning'

export interface BookingIssue {
  type: BookingIssueType
  label: string
  severity: IssueSeverity
}

// Небольшой запас времени после окончания записи, прежде чем она станет
// считаться "прошедшей" для целей предупреждений — чтобы администратор успел
// спокойно выгрузить материалы/внести оплату сразу после съёмки.
export const BOOKING_ISSUE_GRACE_PERIOD_HOURS = 2

// Эффективный тип события: сохранённый в аннотации (в т.ч. вручную изменённый
// администратором), а если аннотации ещё нет — определяется на лету по
// названию живого calendarEvent (classifyEventType).
export function getEffectiveEventType(vm: ScheduleEventVM): EventType {
  return vm.annotation?.eventType ?? classifyEventType(vm.calendarEvent.title)
}

export function isPastBooking(vm: ScheduleEventVM, now: Date = new Date()): boolean {
  const graceMs = BOOKING_ISSUE_GRACE_PERIOD_HOURS * 60 * 60 * 1000
  return new Date(vm.calendarEvent.end).getTime() + graceMs < now.getTime()
}

// Действительно ли эту запись вообще стоит проверять на материалы/оплату —
// студийная запись, начавшаяся не раньше даты запуска фичи, и уже прошедшая
// (с учётом грейс-периода). Всё остальное (встречи/отсутствия, будущие и
// доисторические записи) не проверяется вообще.
export function canCheckBookingIssues(vm: ScheduleEventVM, now: Date = new Date()): boolean {
  if (getEffectiveEventType(vm) !== 'STUDIO_BOOKING') return false
  if (new Date(vm.calendarEvent.start) < MATERIALS_TRACKING_LAUNCH_DATE) return false
  return isPastBooking(vm, now)
}

export function getBookingIssues(vm: ScheduleEventVM, now: Date = new Date()): BookingIssue[] {
  if (!canCheckBookingIssues(vm, now)) return []

  const a = vm.annotation
  const issues: BookingIssue[] = []
  const hasYandex = !!a?.yandexDiskUrl
  const hasNas = !!a?.nasBackupUrl

  // Ссылка на Яндекс.Диск сама по себе закрывает проблему с материалами — NAS
  // сверху не обязателен (см. комментарий у getMaterialsDisplay про решение
  // от 2026-07-06). Единственные проблемные случаи: нет вообще ничего
  // (danger) или есть только NAS без Яндекс.Диска (warning — клиенту всё ещё
  // нечем ничего передать напрямую).
  if (!hasNas && !hasYandex) {
    issues.push({ type: 'materials_missing', label: 'Нет материалов', severity: 'danger' })
  } else if (!hasYandex) {
    issues.push({ type: 'materials_missing', label: 'Нет Яндекс.Диска', severity: 'warning' })
  }

  const hasPayment = a?.estimatedPrice != null || !!a?.subscriptionUsage
  if (!hasPayment) {
    issues.push({ type: 'payment_missing', label: 'Оплата не указана', severity: 'warning' })
  }

  return issues
}

export function hasDangerIssue(issues: BookingIssue[]): boolean {
  return issues.some(i => i.severity === 'danger')
}

export function hasPaymentIssue(issues: BookingIssue[]): boolean {
  return issues.some(i => i.type === 'payment_missing')
}

// ============================================================
// Общая сериализуемая форма строки ScheduleEvent (даты как ISO-строки —
// пересекает границу server action → client component)
// ============================================================

export interface ScheduleEventDTO {
  id: string
  calendarEventId: string | null
  title: string | null
  description: string | null
  startAt: string | null
  endAt: string | null
  clientId: string | null
  clientName: string | null
  clientNameRaw: string | null
  contactRaw: string | null
  companyRaw: string | null
  room: string | null
  format: string | null
  camerasCount: number | null
  estimatedPrice: number | null
  paymentMethod: PaymentMethod | null
  notes: string | null
  yandexDiskUrl: string | null
  yandexDiskUrlAddedAt: string | null
  yandexDiskUrlExpiresAt: string | null
  nasBackupUrl: string | null
  materialsComment: string | null
  materialsStatus: MaterialsStatus
  editingRequired: boolean | null
  clientConfirmationStatus: ClientConfirmationStatus
  subscriptionUsage: ScheduleEventSubscriptionInfo | null
  eventType: EventType
}

// Снэпшот абонемента, которым оплачена эта конкретная запись — только для
// отображения/дефолтов в карточке события, пересчитывается заново при каждой
// загрузке (не кэшируется отдельно от самого абонемента).
export interface ScheduleEventSubscriptionInfo {
  subscriptionId: string
  usedHours: number
  purchasedAt: string
  packageHours: number
  remainingHours: number
}

// Событие календаря (источник правды по времени/названию) + аннотация из БД
// (студийные поля), объединённые для отрисовки/карточки. Намеренно НЕ плоский
// тип — annotation может быть null (событие ещё не аннотировано), и даже когда
// она есть, title/start/end внутри annotation — это только снэпшот, читать
// время/название нужно всегда из calendarEvent.
export interface ScheduleEventVM {
  calendarEvent: CalendarEvent
  annotation: ScheduleEventDTO | null
}

export function mergeScheduleEvent(calendarEvent: CalendarEvent, annotation: ScheduleEventDTO | null): ScheduleEventVM {
  return { calendarEvent, annotation }
}

// Аннотации может не быть (событие ещё не открывали) — в этом случае считаем как NO_LINKS.
export function getVmMaterialsDisplay(vm: ScheduleEventVM): MaterialsDisplay {
  return getMaterialsDisplay({
    materialsStatus: vm.annotation?.materialsStatus ?? 'NO_LINKS',
    nasBackupUrl: vm.annotation?.nasBackupUrl,
  })
}

// Тревожный (danger) значок статуса материалов должен появляться только там,
// где запись реально проверяется на материалы (canCheckBookingIssues) — иначе
// значок "Нет материалов" ошибочно горит на будущих или доисторических
// (до даты запуска фичи) записях, которые никогда не считаются проблемой.
// Нейтральные/положительные статусы (есть бэкап, материалы сохранены и т.п.)
// показываются всегда — они не пугают и не вводят в заблуждение.
export function shouldShowMaterialsBadge(vm: ScheduleEventVM, now: Date = new Date()): boolean {
  return getVmMaterialsDisplay(vm).severity !== 'danger' || canCheckBookingIssues(vm, now)
}

