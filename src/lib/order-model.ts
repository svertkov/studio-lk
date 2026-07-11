import type { OrderStatus, OrderSource, OrderPaymentStatus, PaymentMethod, ArchiveReason } from '@prisma/client'

export type { OrderStatus, OrderSource, OrderPaymentStatus, ArchiveReason }

// ============================================================
// ЦЕНТРАЛИЗОВАННАЯ КОНФИГУРАЦИЯ СТАТУСОВ ЗАКАЗА — единственный источник
// правды для названия колонки, её порядка на канбане и цветовой индикации.
// Всё остальное (ORDER_BOARD_COLUMNS, ORDER_STATUS_LABELS) выводится отсюда,
// чтобы название/цвет статуса не расходились между канбаном, карточкой и
// селектором статуса в форме заказа.
//
// "Отказы" сознательно не заводился как новый статус в БД — для него
// переиспользован уже существующий OrderStatus.CANCELLED (был в схеме и
// раньше, просто не показывался колонкой в MVP-версии канбана). ARCHIVED
// тоже существует в БД, но по-прежнему не выводится колонкой — это отдельный,
// более поздний архивный статус, не участвующий в текущей воронке.
// ============================================================

// Цвет статуса хранится как сырые hex/rgba-токены (не готовые Tailwind-классы)
// и прокидывается в разметку через CSS custom properties (--status-*, см.
// getOrderStatusVars). Это осознанный выбор: Tailwind JIT не умеет собирать
// классы из шаблонных строк (`border-${color}-500` не сработает), а расписать
// 6 статусов × 4 состояния (обычное/hover/drag/drop-zone) литеральными
// классами означало бы огромное дублирование в OrderCard/OrdersBoard. Вместо
// этого разметка использует один и тот же набор статичных arbitrary-value
// классов вида `shadow-[0_0_20px_var(--status-glow)]` везде, а конкретный
// цвет приходит через инлайн-style с CSS-переменными для конкретного статуса.
export interface OrderStatusConfig {
  label: string
  order: number
  // Насыщенный акцентный цвет статуса (для полосы/пилюли в заголовке и
  // левого акцента карточки — там нужен чистый, не полупрозрачный цвет).
  color: string
  // Обычное состояние — граница и glow-тень столбца/карточки.
  border: string
  glow: string
  // Едва заметный фон-градиент внутри столбца/фон карточки при hover.
  background: string
  // Усиленные версии для hover/drag/активного drop-zone.
  borderStrong: string
  glowStrong: string
  // Необязательное отдельное оформление шапки столбца — сейчас есть только
  // у «Монтажа» (см. Задачу 2 в спеке): золотая заливка-градиент в фоне
  // заголовка + свой border-bottom вместо нейтрального zinc. У остальных
  // статусов оба поля не заданы — их шапка остаётся стандартной.
  headerBackground?: string
  headerBorderColor?: string
  // Отдельная, более выраженная (двухслойная — внешний + inset) тень для
  // всего столбца — тоже пока только у «Монтажа»: этот этап должен считываться
  // как визуально приоритетный среди промежуточных этапов воронки (Задача 3).
  featuredColumnGlow?: string
  featuredColumnGlowStrong?: string
}

const ORDER_STATUS_CONFIG: Record<OrderStatus, OrderStatusConfig> = {
  LEAD: {
    label: 'Заявка',
    order: 1,
    color: '#3B82F6',
    border: 'rgba(59, 130, 246, 0.45)',
    glow: 'rgba(59, 130, 246, 0.28)',
    background: 'rgba(59, 130, 246, 0.04)',
    borderStrong: 'rgba(59, 130, 246, 0.8)',
    glowStrong: 'rgba(59, 130, 246, 0.55)',
  },
  BOOKED: {
    label: 'Записан в студию',
    order: 2,
    color: '#22D3EE',
    border: 'rgba(34, 211, 238, 0.45)',
    glow: 'rgba(34, 211, 238, 0.28)',
    background: 'rgba(34, 211, 238, 0.04)',
    borderStrong: 'rgba(34, 211, 238, 0.8)',
    glowStrong: 'rgba(34, 211, 238, 0.55)',
  },
  // «Монтаж» сознательно золотой/жёлтый, а не бирюзовый — это ключевой
  // рабочий этап (клиенты, которых нельзя упустить), поэтому визуально он
  // должен быть приоритетнее соседних промежуточных этапов, не просто иметь
  // свой цвет (см. featuredColumnGlow/headerBackground выше и их применение
  // в OrdersBoard.tsx — только «Монтаж» использует эти поля).
  EDITING: {
    label: 'Монтаж',
    order: 3,
    color: '#FACC15',
    border: 'rgba(250, 204, 21, 0.55)',
    glow: 'rgba(250, 204, 21, 0.32)',
    background: 'rgba(250, 204, 21, 0.06)',
    borderStrong: 'rgba(250, 204, 21, 0.72)',
    glowStrong: 'rgba(250, 204, 21, 0.5)',
    headerBackground: 'linear-gradient(180deg, rgba(250, 204, 21, 0.14) 0%, rgba(250, 204, 21, 0.04) 100%)',
    headerBorderColor: 'rgba(250, 204, 21, 0.35)',
    featuredColumnGlow: '0 0 28px rgba(250, 204, 21, 0.18), inset 0 0 24px rgba(250, 204, 21, 0.035)',
    featuredColumnGlowStrong: '0 0 40px rgba(250, 204, 21, 0.32), inset 0 0 28px rgba(250, 204, 21, 0.07)',
  },
  REVISIONS: {
    label: 'Правки',
    order: 4,
    color: '#84CC16',
    border: 'rgba(132, 204, 22, 0.45)',
    glow: 'rgba(132, 204, 22, 0.28)',
    background: 'rgba(132, 204, 22, 0.04)',
    // Салатовый — самый "кислотный" оттенок в наборе, поэтому усиление чуть
    // сдержаннее, чем у соседних статусов, чтобы не резать глаз при hover/drag.
    borderStrong: 'rgba(132, 204, 22, 0.7)',
    glowStrong: 'rgba(132, 204, 22, 0.45)',
  },
  COMPLETED: {
    label: 'Завершено',
    order: 5,
    color: '#22C55E',
    border: 'rgba(34, 197, 94, 0.5)',
    glow: 'rgba(34, 197, 94, 0.3)',
    background: 'rgba(34, 197, 94, 0.045)',
    borderStrong: 'rgba(34, 197, 94, 0.85)',
    glowStrong: 'rgba(34, 197, 94, 0.6)',
  },
  CANCELLED: {
    label: 'Отказы',
    order: 6,
    color: '#B45353',
    border: 'rgba(180, 83, 83, 0.48)',
    glow: 'rgba(180, 83, 83, 0.26)',
    background: 'rgba(180, 83, 83, 0.045)',
    // Приглушённый статус — усиление умеренное даже на hover/drag/drop-zone,
    // чтобы "Отказы" не начали выглядеть тревожно-агрессивным ярко-красным.
    borderStrong: 'rgba(180, 83, 83, 0.65)',
    glowStrong: 'rgba(180, 83, 83, 0.4)',
  },
  // Не показывается колонкой — order вне диапазона видимых колонок.
  ARCHIVED: {
    label: 'Архив',
    order: 99,
    color: '#71717A',
    border: 'rgba(113, 113, 122, 0.4)',
    glow: 'rgba(113, 113, 122, 0.15)',
    background: 'rgba(113, 113, 122, 0.03)',
    borderStrong: 'rgba(113, 113, 122, 0.6)',
    glowStrong: 'rgba(113, 113, 122, 0.25)',
  },
}

export function getOrderStatusConfig(status: OrderStatus): OrderStatusConfig {
  return ORDER_STATUS_CONFIG[status]
}

// CSS custom properties для инлайн-style — единая точка входа цвета статуса
// в разметку. Обычный и усиленный (hover/drag/drop-zone) варианты выставлены
// оба сразу под разными именами — разметка сама решает через какой из них
// смотреть (`hover:`-вариант Tailwind для наведения мышью, обычный
// className-тумблер для isOver/isDragging), не пересчитывая style в JS.
export function getOrderStatusVars(status: OrderStatus): Record<string, string> {
  const v = ORDER_STATUS_CONFIG[status]
  return {
    '--status-color': v.color,
    '--status-border': v.border,
    '--status-border-strong': v.borderStrong,
    '--status-glow': v.glow,
    '--status-glow-strong': v.glowStrong,
    '--status-bg': v.background,
    // Заданы только там, где в конфиге есть featuredColumnGlow(Strong) —
    // сейчас только у «Монтажа». Пустая строка безопасна как fallback: она
    // никогда не читается напрямую, только когда OrdersBoard уже проверил
    // config.featuredColumnGlow и выбрал класс, который на неё ссылается.
    '--status-featured-glow': v.featuredColumnGlow ?? '',
    '--status-featured-glow-strong': v.featuredColumnGlowStrong ?? '',
  }
}

// Колонки канбана слева направо — выведены из order в конфиге, ARCHIVED
// исключён явно (см. комментарий у ARCHIVED выше).
export const ORDER_BOARD_COLUMNS: OrderStatus[] = (Object.keys(ORDER_STATUS_CONFIG) as OrderStatus[])
  .filter(s => s !== 'ARCHIVED')
  .sort((a, b) => ORDER_STATUS_CONFIG[a].order - ORDER_STATUS_CONFIG[b].order)

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = Object.fromEntries(
  (Object.keys(ORDER_STATUS_CONFIG) as OrderStatus[]).map(s => [s, ORDER_STATUS_CONFIG[s].label]),
) as Record<OrderStatus, string>

// ============================================================
// СОРТИРОВКА КАРТОЧЕК ВНУТРИ КОЛОНКИ
// ============================================================

interface SortableOrder {
  status: OrderStatus
  createdAt: string
  plannedStartTime: string | null
  statusUpdatedAt: string
}

// Правило сортировки зависит от колонки:
// - «Заявка» — сначала новые заявки (по дате создания);
// - «Записан в студию» — сначала ближайшие актуальные записи, прошедшие
//   уходят вниз (среди прошедших — недавно прошедшие выше давних);
// - остальные (Монтаж/Правки/Завершено/Отказы) — сначала недавно изменённый
//   статус (statusUpdatedAt).
export function sortOrdersForColumn<T extends SortableOrder>(status: OrderStatus, orders: T[]): T[] {
  const arr = [...orders]
  if (status === 'LEAD') {
    return arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }
  if (status === 'BOOKED') {
    const now = Date.now()
    return arr.sort((a, b) => {
      const aTime = a.plannedStartTime ? new Date(a.plannedStartTime).getTime() : Infinity
      const bTime = b.plannedStartTime ? new Date(b.plannedStartTime).getTime() : Infinity
      const aPast = aTime < now
      const bPast = bTime < now
      if (aPast !== bPast) return aPast ? 1 : -1
      return aPast ? bTime - aTime : aTime - bTime
    })
  }
  return arr.sort((a, b) => new Date(b.statusUpdatedAt).getTime() - new Date(a.statusUpdatedAt).getTime())
}

export const ORDER_SOURCE_LABELS: Record<OrderSource, string> = {
  MANUAL:          'Вручную',
  GOOGLE_CALENDAR: 'Google Calendar',
  TELEGRAM_BOT:    'Telegram-бот',
  OTHER:           'Другое',
}

export const ORDER_PAYMENT_STATUS_LABELS: Record<OrderPaymentStatus, string> = {
  NOT_SPECIFIED:  'Не указана',
  UNPAID:         'Не оплачено',
  PARTIALLY_PAID: 'Оплачено частично',
  PAID:           'Оплачено',
  SUBSCRIPTION:   'По абонементу',
}

export const ORDER_PAYMENT_STATUS_COLORS: Record<OrderPaymentStatus, string> = {
  NOT_SPECIFIED:  'text-zinc-400',
  UNPAID:         'text-red-400',
  PARTIALLY_PAID: 'text-amber-400',
  PAID:           'text-green-500',
  SUBSCRIPTION:   'text-blue-400',
}

// Способ оплаты заказа — то же перечисление, что и у разовой оплаты записи
// расписания, плюс SUBSCRIPTION (см. комментарий у enum PaymentMethod в схеме).
export const ORDER_PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH:         'Наличными',
  CARD:         'Картой',
  TRANSFER:     'Переводом',
  INVOICE:      'По счёту',
  UNPAID:       'Не оплачено',
  FREE:         'Бесплатно / бартер',
  OTHER:        'Другое',
  SUBSCRIPTION: 'Абонемент',
}

// Автоимпорт заказов из Google Calendar (ensureOrderForNewBooking) должен
// создавать заказы только для записей, начинающихся ПОСЛЕ этой даты — по
// явной просьбе пользователя (2026-07-04): раздел "Заказы" запускается с
// чистого листа, старые/прошедшие записи в календаре не должны задним числом
// становиться заказами, когда сотрудник открывает и сохраняет их карточку
// (например, чтобы просто добавить материалы). Ручное создание заказа через
// "+ Создать заказ" этим ограничением не связано.
export const ORDERS_AUTO_IMPORT_LAUNCH_DATE = new Date('2026-07-05T00:00:00')

export function computeDurationMinutes(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return null
  return Math.round(ms / 60000)
}

// ============================================================
// АРХИВ ЗАКАЗОВ — заказ остаётся в финальном статусе COMPLETED/CANCELLED
// навсегда, isArchived лишь скрывает старую карточку из основной CRM-воронки
// (см. Order.isArchived/archivedAt/archiveReason в схеме и getActiveOrders/
// getArchivedOrders/archiveEligibleOrders в src/lib/actions/orders.ts —
// единственное место, где isArchived реально проставляется). Эта функция —
// единственный источник правды для "должен ли заказ считаться архивным по
// правилу 7 дней"; ей не важно текущее значение isArchived в БД, только
// статус и completedAt/rejectedAt — так тест/просмотр правила не зависит от
// того, прошёл ли уже фактический свип (владелец, 2026-07-10).
// ============================================================

export const ORDER_ARCHIVE_AFTER_DAYS = 7
const ARCHIVE_AFTER_MS = ORDER_ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000

export const ARCHIVE_REASON_LABELS: Record<ArchiveReason, string> = {
  COMPLETED: 'Завершено',
  REJECTED:  'Отказ',
}

export interface ArchivableOrder {
  status: OrderStatus
  completedAt: string | Date | null
  rejectedAt: string | Date | null
}

export function isOrderReadyForArchive(order: ArchivableOrder, now: Date = new Date()): boolean {
  if (order.status === 'COMPLETED' && order.completedAt) {
    return now.getTime() - new Date(order.completedAt).getTime() > ARCHIVE_AFTER_MS
  }
  if (order.status === 'CANCELLED' && order.rejectedAt) {
    return now.getTime() - new Date(order.rejectedAt).getTime() > ARCHIVE_AFTER_MS
  }
  return false
}

// Какую archiveReason проставить заказу этого статуса при архивации — только
// для COMPLETED/CANCELLED, для остальных архивация не имеет смысла.
export function archiveReasonForStatus(status: OrderStatus): ArchiveReason | null {
  if (status === 'COMPLETED') return 'COMPLETED'
  if (status === 'CANCELLED') return 'REJECTED'
  return null
}

// ============================================================
// СПИСОК ЗАКАЗОВ (раздел "Заказы") — чистые хелперы сортировки/поиска
// таблицы, вынесены сюда (а не в клиентский компонент), чтобы их можно было
// покрыть unit-тестами без рендера React (см. src/lib/order-model.test.ts).
// ============================================================

export interface OrderTableRow {
  id: string
  status: OrderStatus
  clientName: string | null
  clientPhone: string | null
  clientTelegram: string | null
  clientEmail: string | null
  companyName: string | null
  serviceType: string | null
  room: string | null
  comment: string | null
  preliminaryAmount: number | null
  paymentStatus: OrderPaymentStatus
  plannedStartTime: string | null
  durationMinutes: number | null
  createdAt: string
  hasMaterials: boolean
  nasBackupUrl: string | null
  editingRequired: boolean | null
  makeupDurationMinutes: number | null
}

// Дата, по которой заказ занимает место в хронологическом списке — дата
// запланированной записи, если она есть, иначе дата создания заявки (для
// заявок, у которых ещё нет даты студийной записи). Тот же принцип, что и
// orderDate в архиве CRM (см. OrdersArchiveView.tsx), но без дублирования —
// оттуда эта функция не переиспользуется напрямую только потому, что архив
// показывает отдельно "дату финального статуса", а не общую хронологию.
export function orderTableDate(order: Pick<OrderTableRow, 'plannedStartTime' | 'createdAt'>): string {
  return order.plannedStartTime ?? order.createdAt
}

export type OrderTableSortKey = 'date' | 'client' | 'duration' | 'amount' | 'status'
export type SortDirection = 'asc' | 'desc'

// Сравнение по одной из колонок списка заказов — статус сравнивается по
// порядку из ORDER_STATUS_CONFIG (тот же порядок, что и колонки канбана CRM),
// не по алфавиту лейбла, иначе "Завершено" оказалось бы раньше "Заявки".
export function compareOrdersForTable(
  a: OrderTableRow, b: OrderTableRow, key: OrderTableSortKey, direction: SortDirection,
): number {
  let cmp = 0
  switch (key) {
    case 'date':
      cmp = new Date(orderTableDate(a)).getTime() - new Date(orderTableDate(b)).getTime()
      break
    case 'client':
      cmp = (a.clientName ?? '').localeCompare(b.clientName ?? '', 'ru')
      break
    case 'duration':
      cmp = (a.durationMinutes ?? -1) - (b.durationMinutes ?? -1)
      break
    case 'amount':
      cmp = (a.preliminaryAmount ?? -1) - (b.preliminaryAmount ?? -1)
      break
    case 'status':
      cmp = ORDER_STATUS_CONFIG[a.status].order - ORDER_STATUS_CONFIG[b.status].order
      break
  }
  return direction === 'asc' ? cmp : -cmp
}

// Единая строка поиска — те же поля, что уже ищет архив CRM (см.
// searchHaystack в OrdersArchiveView.tsx), плюс телефон/Telegram/email и
// компания, которых архиву не требовалось.
export function orderTableSearchHaystack(order: OrderTableRow): string {
  return [
    order.clientName, order.clientPhone, order.clientTelegram, order.clientEmail, order.companyName,
    order.serviceType, order.room, order.comment, order.preliminaryAmount?.toString(),
  ].filter(Boolean).join(' ').toLowerCase()
}
