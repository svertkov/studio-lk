// Материалы и статус подтверждения клиента для событий расписания —
// зеркало Prisma-энумов, лейблы UI и чистая бизнес-логика вычисления статуса.
//
// ScheduleEvent в БД — это АННОТАЦИЯ к событию Google Calendar, не его копия.
// Название/время события всегда берутся из живого календаря (CalendarEvent);
// поля title/description/startAt/endAt в самой аннотации — денормализованный
// снэпшот только для контекстов, которые не могут дёрнуть Google Calendar API
// (например блок "Клиенты из расписания" на странице Клиентов).

import type { ClientConfirmationStatus, MaterialsStatus, PaymentMethod, OrderPromotionType } from '@prisma/client'
import type { CalendarEvent } from '@/lib/google-calendar'
import { type EventType, classifyEventType } from '@/lib/event-type'

export type { MaterialsStatus, ClientConfirmationStatus, EventType, PaymentMethod, OrderPromotionType }

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
  // Осознанное решение администратора "эта ссылка не требуется" (см.
  // RequiredLinkToggle) — по умолчанию true (прежнее поведение: ссылка
  // обязательна), см. ScheduleEvent.yandexLinkRequired/nasLinkRequired.
  yandexLinkRequired?: boolean
  nasLinkRequired?: boolean
}

export function computeYandexLinkExpiry(addedAt: Date): Date {
  return new Date(addedAt.getTime() + EXPIRY_MS)
}

function isYandexExpired(addedAt: Date, now: Date): boolean {
  return now.getTime() - addedAt.getTime() > EXPIRY_MS
}

// Единственный источник правды для materials_status — вызывается на сервере
// при каждом сохранении события (upsertScheduleEvent), клиенту не доверяем.
//
// "OK" вместо "has": поле считается удовлетворённым, если ссылка реально
// заполнена ИЛИ администратор явно отметил её необязательной — дальше вся
// функция работает с этим единственным понятием, отдельного значения enum
// для "не требуется" не заводим (см. AGENTS.md — не плодить копии одной и
// той же проверки).
export function computeMaterialsStatus(input: MaterialsStatusInput, now: Date = new Date()): MaterialsStatus {
  const yandexOk = !!input.yandexDiskUrl || input.yandexLinkRequired === false
  const nasOk = !!input.nasBackupUrl || input.nasLinkRequired === false

  if (!yandexOk && !nasOk) return 'NO_LINKS'
  if (!yandexOk && nasOk) return 'BACKUP_EXISTS'

  const expired = input.yandexDiskUrlAddedAt ? isYandexExpired(input.yandexDiskUrlAddedAt, now) : false
  if (!expired) return 'YANDEX_ACTIVE'
  return nasOk ? 'YANDEX_EXPIRED' : 'NEEDS_ATTENTION'
}

// Нужен ли значок "нет вообще никаких ссылок на материалы" в календаре
export function needsNoLinksWarning(input: MaterialsStatusInput): boolean {
  if (input.yandexLinkRequired === false && input.nasLinkRequired === false) return false
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
  // См. MaterialsStatusInput.nasLinkRequired — нужен только для ветки
  // YANDEX_ACTIVE ниже: BACKUP_EXISTS/NO_LINKS по построению уже означают,
  // что соответствующее поле ДЕЙСТВИТЕЛЬНО обязательно и пусто (см.
  // computeMaterialsStatus), доп. проверка там не нужна.
  nasLinkRequired?: boolean
}): MaterialsDisplay {
  switch (input.materialsStatus) {
    case 'NO_LINKS':        return { label: 'Нет материалов', severity: 'danger' }
    case 'BACKUP_EXISTS':   return { label: 'Нет Яндекс.Диска', severity: 'warning' }
    case 'NEEDS_ATTENTION': return { label: 'Нет NAS-бэкапа', severity: 'danger' }
    // Оба поля когда-то были заполнены, NAS уже есть — не критично, просто
    // ссылка на Яндекс.Диск устарела (её можно перевыпустить или удалить).
    case 'YANDEX_EXPIRED':  return { label: 'Ссылка истекла', severity: 'warning' }
    case 'YANDEX_ACTIVE':
      return (input.nasBackupUrl || input.nasLinkRequired === false)
        ? { label: 'Материалы сохранены', severity: 'success' }
        // Яндекс.Диск по-прежнему не блокирует сохранение/переход заказа (решение
        // от 2026-07-06 не отменяется), но само по себе отсутствие NAS-бэкапа
        // должно быть заметно администратору — просьба владельца от 2026-07-09,
        // после того как добавление ссылки на Яндекс.Диск у Никиты Горина тихо
        // убрало запись из блока предупреждений на дашборде.
        : { label: 'Нет бэкапа на NAS', severity: 'warning' }
  }
}

export const MATERIALS_SEVERITY_TEXT_COLOR: Record<MaterialsSeverity, string> = {
  danger:  'text-red-400',
  warning: 'text-amber-400',
  info:    'text-blue-400',
  success: 'text-green-500',
  neutral: 'text-zinc-400',
}

// Тревожная подсветка карточки — переиспользуется в Day/Week/Month видах
// расписания и в блоке "Записи требуют внимания" на дашборде. Уровень CRITICAL:
// карточка практически не заполнена (нет ни материалов, ни оплаты).
export const CRITICAL_GLOW_CARD_CLASS =
  'border-red-600/60 bg-red-950/30 shadow-[0_0_14px_rgba(239,68,68,0.22)]'

// Уровень WARNING: карточка заполнена частично — что-то одно из ключевых
// полей (NAS-бэкап, способ оплаты и т.п.) ещё не указано. Ничего не
// блокирует, только напоминание — см. getBookingAttentionInfo.
export const WARNING_GLOW_CARD_CLASS =
  'border-amber-600/60 bg-amber-950/30 shadow-[0_0_14px_rgba(245,158,11,0.22)]'

// Отслеживание материалов появилось в системе только с этой даты — съёмки,
// которые НАЧАЛИСЬ раньше, никогда не помечаются проблемными, даже если ссылок
// нет и они уже прошли. Иначе фича сразу пометила бы красным весь ранее
// накопленный архив клиентов, где материалы никогда не заводились в системе
// (пользователь явно попросил не задевать прошлые записи при внедрении).
export const MATERIALS_TRACKING_LAUNCH_DATE = new Date('2026-07-03T00:00:00')

// ============================================================
// "ВНИМАНИЕ К ЗАПИСИ" (booking attention) — единственный источник правды для
// подсветки мини-карточек в расписании и для блока "Записи требуют внимания"
// на дашборде. Проверяется только STUDIO_BOOKING (встречи/отсутствия
// сотрудников/служебные пометки никогда не считаются проблемными) и только
// для уже прошедших записей — будущая запись без материалов/оплаты это норма.
// ============================================================

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

export type AttentionSeverity = 'critical' | 'warning' | 'complete'

// Конкретное поле карточки, которого не хватает — для программных проверок
// (тесты, будущие фичи), badges — это уже готовый для показа текст на русском.
export type BookingMissingField = 'yandexDiskUrl' | 'nasBackupUrl' | 'paymentAmount' | 'paymentMethod'

export interface BookingAttentionInfo {
  isComplete: boolean
  severity: AttentionSeverity
  missingFields: BookingMissingField[]
  badges: string[]
}

export const ATTENTION_BADGE_CLASS: Record<'critical' | 'warning', string> = {
  critical: 'bg-red-950/50 border border-red-700/60 text-red-300',
  warning:  'bg-amber-950/50 border border-amber-700/60 text-amber-300',
}

// Стили отдельной цветной панели уровня критичности в блоке "Записи требуют
// внимания" на дашборде (см. AttentionSubsection) — critical и warning теперь
// две самостоятельные панели, а не одна общая рамка с построчными акцентами,
// чтобы жёлтая (неполная) запись не читалась как часть красной "колбасы"
// (владелец, 2026-07-10). Свечение warning намеренно той же силы, что и у
// critical (тот же размер/прозрачность shadow, только жёлтый цвет) — раньше
// было заметно ярче/крупнее, чем у красных, что читалось как перебор
// (владелец, 2026-07-10, тот же день).
export const ATTENTION_PANEL_STYLE: Record<'critical' | 'warning', {
  panel: string
  headerBorder: string
  headerText: string
  button: string
}> = {
  critical: {
    panel:       'border border-red-600/60 bg-red-950/30 shadow-[0_0_22px_rgba(239,68,68,0.20)]',
    headerBorder: 'border-red-900/50',
    headerText:  'text-red-300',
    button:      'bg-red-600 hover:bg-red-500',
  },
  warning: {
    panel:       'border border-amber-500/70 bg-amber-950/40 shadow-[0_0_22px_rgba(245,158,11,0.20)]',
    headerBorder: 'border-amber-800/60',
    headerText:  'text-amber-300',
    button:      'bg-amber-600 hover:bg-amber-500',
  },
}

const COMPLETE_ATTENTION: BookingAttentionInfo = { isComplete: true, severity: 'complete', missingFields: [], badges: [] }

// Карточка считается полностью заполненной, только если заполнены ВСЕ
// ключевые поля: ссылка на Яндекс.Диск, NAS-бэкап и оплата (сумма + способ,
// либо списание по абонементу — абонемент сам по себе покрывает и то, и
// другое). Такая запись не должна попадать в блок "Записи требуют внимания"
// (владелец, 2026-07-09/10).
//
// Уровень критичности — не по количеству отдельных недостающих полей, а по
// тому, пуста ли карточка целиком по ОБОИМ направлениям сразу:
//   - CRITICAL: нет вообще никаких материалов (ни Яндекс.Диска, ни NAS) И
//     вообще никакой оплаты (ни суммы, ни способа, ни абонемента) —
//     карточка практически не заполнена.
//   - WARNING: хотя бы одно из двух направлений (материалы или оплата) уже
//     имеет какие-то данные, но что-то из ключевых полей всё ещё не хватает
//     (например есть Яндекс.Диск, но нет NAS; есть оплата, но нет способа;
//     есть абонемент, но нет NAS, и т.п.).
// Это единственная функция, определяющая критичность — переиспользуется и
// в расписании (Day/Week/Month), и в блоке на дашборде.
export function getBookingAttentionInfo(vm: ScheduleEventVM, now: Date = new Date()): BookingAttentionInfo {
  if (!canCheckBookingIssues(vm, now)) return COMPLETE_ATTENTION

  const a = vm.annotation
  // "Ok" вместо "has" — поле не считается недостающим, если администратор
  // явно отметил его необязательным (см. computeMaterialsStatus, тот же
  // принцип). Дальше по функции используются только hasYandex/hasNas —
  // читаются как "с этим полем всё в порядке", а не "ссылка реально есть".
  const hasYandex = !!a?.yandexDiskUrl || a?.yandexLinkRequired === false
  const hasNas = !!a?.nasBackupUrl || a?.nasLinkRequired === false
  const hasSubscription = !!a?.subscriptionUsage
  const hasPrice = a?.estimatedPrice != null
  const hasPaymentMethod = !!a?.paymentMethod

  const paymentComplete = hasSubscription || (hasPrice && hasPaymentMethod)
  const paymentEmpty = !hasSubscription && !hasPrice && !hasPaymentMethod
  const materialsEmpty = !hasYandex && !hasNas

  if (hasYandex && hasNas && paymentComplete) return COMPLETE_ATTENTION

  const missingFields: BookingMissingField[] = []
  if (!hasYandex) missingFields.push('yandexDiskUrl')
  if (!hasNas) missingFields.push('nasBackupUrl')
  if (!hasSubscription && !hasPrice) missingFields.push('paymentAmount')
  if (!hasSubscription && !hasPaymentMethod) missingFields.push('paymentMethod')

  const critical = materialsEmpty && paymentEmpty
  const badges: string[] = []

  if (critical) {
    // По определению critical оба направления пусты целиком — отдельная
    // пометка "нет способа оплаты" здесь ничего не добавляет к "оплата не
    // указана", поэтому не дублируем её отдельным бейджем.
    badges.push('Нет материалов', 'Оплата не указана')
  } else {
    if (materialsEmpty) badges.push('Нет материалов')
    else if (!hasYandex) badges.push('Нет ссылки на Яндекс')
    else if (!hasNas) badges.push('Нет бэкапа на NAS')

    if (paymentEmpty) {
      badges.push('Оплата не указана')
    } else if (!hasSubscription) {
      if (!hasPaymentMethod) badges.push('Не указан способ оплаты')
      if (!hasPrice) badges.push('Нет статуса оплаты')
    }
  }

  return { isComplete: false, severity: critical ? 'critical' : 'warning', missingFields, badges }
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
  // Структурированная пометка акции (см. src/lib/promotion-model.ts) —
  // источник правды для записей с датой; для заявок без записи см.
  // OrderDTO.promotionType (тот же принцип двойного источника, что и notes/comment).
  promotionType: OrderPromotionType | null
  yandexDiskUrl: string | null
  yandexDiskUrlAddedAt: string | null
  yandexDiskUrlExpiresAt: string | null
  nasBackupUrl: string | null
  materialsComment: string | null
  materialsStatus: MaterialsStatus
  // См. MaterialsStatusInput.yandexLinkRequired/nasLinkRequired.
  yandexLinkRequired: boolean
  nasLinkRequired: boolean
  editingRequired: boolean | null
  clientConfirmationStatus: ClientConfirmationStatus
  subscriptionUsage: ScheduleEventSubscriptionInfo | null
  eventType: EventType
  makeupDurationMinutes: number | null
  orderId: string | null
  // Единственный существующий в схеме сигнал отмены записи — статус связанного
  // Order (у самого ScheduleEvent нет отдельного статуса отмены, см.
  // client-shoots-model.ts). false, если заказа нет вовсе.
  isCancelled: boolean
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
    nasLinkRequired: vm.annotation?.nasLinkRequired,
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

// ============================================================
// ГРИМЁР — предварительное бронирование студии перед основной съёмкой.
// Источник истины — длительность в минутах (ScheduleEvent.makeupDurationMinutes),
// НЕ отдельно хранимое время начала: интервал гримёра всегда пересчитывается
// от startAt самой записи (см. computeMakeupInterval), поэтому перенос
// съёмки не может рассинхронизировать сохранённое "время гримёра".
// ============================================================

// Разумный потолок длительности гримёра — защита от опечатки при ручном
// вводе (например, лишний ноль), а не жёсткое бизнес-ограничение.
export const MAKEUP_DURATION_MAX_MINUTES = 480

export interface MakeupQuickOption {
  minutes: number
  label: string
}

// Быстрые варианты длительности гримёра — используются как плашки в карточке
// записи, не ограничивают ручной ввод.
export const MAKEUP_QUICK_OPTIONS: MakeupQuickOption[] = [
  { minutes: 30, label: '30 минут' },
  { minutes: 60, label: '1 час' },
  { minutes: 90, label: '1 час 30 минут' },
  { minutes: 120, label: '2 часа' },
]

export type MakeupDurationUnit = 'minutes' | 'hours'

// Единая точка нормализации введённой пользователем длительности гримёра —
// что для ручного ввода в минутах, что для ввода в часах (в т.ч. дробных,
// «1,5 часа» -> 90). Всегда возвращает целые минуты либо null (пусто/0/
// отрицательное/NaN — во всех этих случаях гримёр считается не предусмотренным).
export function normalizeMakeupDurationMinutes(rawValue: string, unit: MakeupDurationUnit = 'minutes'): number | null {
  const trimmed = rawValue.trim().replace(',', '.')
  if (!trimmed) return null

  const num = parseFloat(trimmed)
  if (!Number.isFinite(num) || num < 0) return null

  const minutes = unit === 'hours' ? num * 60 : num
  const rounded = Math.round(minutes)
  if (rounded <= 0) return null

  return Math.min(rounded, MAKEUP_DURATION_MAX_MINUTES)
}

export interface MakeupInterval {
  start: Date
  end: Date
}

// Интервал гримёра = [начало съёмки − длительность гримёра, начало съёмки).
// Не меняет и не читает длительность/стоимость/время окончания основной
// съёмки — целиком отдельный расчёт поверх уже существующих значений.
export function computeMakeupInterval(shootStart: Date | null, makeupDurationMinutes: number | null): MakeupInterval | null {
  if (!shootStart || !makeupDurationMinutes || makeupDurationMinutes <= 0) return null
  return { start: new Date(shootStart.getTime() - makeupDurationMinutes * 60_000), end: shootStart }
}

// Единый helper форматирования минут — переиспользуется в карточке записи,
// карточке клиента, списке заказов и tooltip'ах, чтобы не дублировать
// логику "минуты -> человекочитаемая строка" в нескольких компонентах.
// 0 -> '0 мин', 30 -> '30 мин', 60 -> '1 ч', 90 -> '1 ч 30 мин', 150 -> '2 ч 30 мин'.
export function formatDurationMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins} мин`
  if (mins === 0) return `${hours} ч`
  return `${hours} ч ${mins} мин`
}

export function formatMakeupBadgeLabel(minutes: number): string {
  return `Гримёр ${formatDurationMinutes(minutes)}`
}

