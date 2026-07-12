import type { OrderStatus, OrderSource, OrderPaymentStatus, PaymentMethod, ArchiveReason } from '@prisma/client'
import { formatMakeupBadgeLabel, formatDurationMinutes } from '@/lib/schedule-model'

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

// ============================================================
// СПИСОК ЗАКАЗОВ — ОБЪЕДИНЁННЫЕ ЯЧЕЙКИ (переработка таблицы 2026-07-11):
// вместо 11 узких колонок таблица показывает 8, часть данных объединена в
// одну ячейку двумя строками (основная/вторичная). Логика объединения
// вынесена в чистые функции — тестируется без рендера React, см.
// order-model.test.ts.
// ============================================================

// «Съёмка» = Зал + Формат в одной ячейке. Формат — основная строка (если не
// указан, явное "Не указан", а не пустая строка — ячейка не должна выглядеть
// сломанной). Зал — вторичная строка, показывается только если задан.
export interface OrderShootDisplay {
  format: string
  room: string | null
}

export function orderShootDisplay(order: Pick<OrderTableRow, 'serviceType' | 'room'>): OrderShootDisplay {
  return { format: order.serviceType ?? 'Не указан', room: order.room }
}

// «Длительность»: основная строка — сама продолжительность; вторичная — время
// гримёра, ТОЛЬКО если оно задано и больше нуля (см. существующее правило в
// OrderCard.tsx/EventCardModal — гримёр НЕ прибавляется к длительности,
// показывается отдельной строкой). Переиспользует общий formatMakeupBadgeLabel
// (schedule-model.ts) — тот же текст "Гримёр Х", что и везде в проекте.
export function orderDurationSecondaryLabel(order: Pick<OrderTableRow, 'makeupDurationMinutes'>): string | null {
  const minutes = order.makeupDurationMinutes
  return minutes != null && minutes > 0 ? formatMakeupBadgeLabel(minutes) : null
}

// «Оплата» = Стоимость + Статус оплаты в одной ячейке — логика вынесена в
// getOrderPaymentSummary (src/lib/payment-model.ts), единый источник для
// ВСЕХ экранов, где показывается оплата заказа (Заказы/CRM/карточка заказа),
// не только для этой таблицы. Раньше здесь была локальная копия этой логики
// (orderPaymentCellDisplay), которая для абонемента показывала "Списано Х" по
// ДЛИТЕЛЬНОСТИ СЪЁМКИ (приближение), а не по реальному SubscriptionUsage.
// usedHours — и не видела вовсе стоимость/способ оплаты, заполненные через
// карточку записи (EventCardModal → ScheduleEvent), а не через саму карточку
// заказа. См. payment-model.ts за подробным разбором причины расхождения.

// ============================================================
// СПИСОК ЗАКАЗОВ — АДАПТИВНЫЕ УРОВНИ ТАБЛИЦЫ. Решение принимается по РЕАЛЬНО
// измеренной ширине контейнера (ResizeObserver в OrdersListView.tsx), а не по
// ширине viewport — левое меню платформы фиксировано (240px, не сворачивается
// на узких экранах), поэтому доступная ширина контента всегда меньше
// viewport, и предположение "ширина экрана = доступная ширина" было бы неверным.
//
// full    — все 8 колонок (обычный десктоп/ноутбук, включая 1280px);
// compact — 7 колонок, без "Комментарий" (узкое окно ноутбука/планшет);
// mobile  — карточный список вместо таблицы (переиспользует OrderCard).
//
// Пороги подобраны так, чтобы на 1280px viewport (реальная минимальная
// ширина из требований) таблица оставалась в 'full' с запасом — доступная
// ширина контента там ~976px (1280 - 240 сайдбар - 64 паддинг страницы),
// что выше ORDERS_TABLE_COMPACT_MAX_WIDTH. Точные числа проверены и в
// order-model.test.ts, и вживую в браузере на 1920/1680/1440/1366/1280px.
// ============================================================

export const ORDERS_TABLE_MOBILE_MAX_WIDTH = 799
export const ORDERS_TABLE_COMPACT_MAX_WIDTH = 959

export type OrdersTableTier = 'mobile' | 'compact' | 'full'

export function getOrdersTableTier(containerWidth: number): OrdersTableTier {
  if (containerWidth <= ORDERS_TABLE_MOBILE_MAX_WIDTH) return 'mobile'
  if (containerWidth <= ORDERS_TABLE_COMPACT_MAX_WIDTH) return 'compact'
  return 'full'
}

// ============================================================
// СПИСОК ЗАКАЗОВ — ГРУППИРОВКА ПО МЕСЯЦАМ (доработка 2026-07-12: раздел
// "Заказы" стал полным историческим архивом студии, а не списком последних
// нескольких заказов — см. src/lib/visit-promotion-model.ts и
// scripts/promote-visits-to-orders). Рисовать сотни строк одним плоским
// списком не нужно — интерфейс группирует их по календарному месяцу и
// показывает только несколько последних месяцев сразу, остальные — по кнопке
// "Показать более ранние месяцы" (см. OrdersListView.tsx).
// ============================================================

export interface OrderMonthGroup<T> {
  // "2026-07" — сортируемый ключ месяца, не для отображения.
  key: string
  // "Июль 2026" — готовая подпись для заголовка блока.
  label: string
  orders: T[]
}

const MONTH_LABEL_FORMAT = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' })

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(d: Date): string {
  // Intl добавляет суффикс "г." ("года") в русской локали — здесь он лишний,
  // заголовку блока достаточно "Июль 2026".
  const s = MONTH_LABEL_FORMAT.format(d).replace(/\s*г\.$/, '')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Группирует уже отфильтрованный (и, в идеале, отсортированный по убыванию
// даты) список заказов по календарному месяцу той же даты, что и вся
// остальная сортировка/поиск таблицы (orderTableDate — plannedStartTime,
// иначе createdAt). Порядок ключей месяцев — от новых к старым — не зависит
// от порядка входного массива: сортируется явно, а не полагается на порядок
// вставки в Map.
export function groupOrdersByMonth<T extends Pick<OrderTableRow, 'plannedStartTime' | 'createdAt'>>(
  orders: T[],
): OrderMonthGroup<T>[] {
  const map = new Map<string, OrderMonthGroup<T>>()
  for (const o of orders) {
    const d = new Date(orderTableDate(o))
    const key = monthKey(d)
    const existing = map.get(key)
    if (existing) existing.orders.push(o)
    else map.set(key, { key, label: monthLabel(d), orders: [o] })
  }
  return Array.from(map.values()).sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
}

// Сколько месячных блоков показывать сразу / сколько подгружать за один клик
// "Показать более ранние месяцы" — намеренно НЕ ограничивает сами заказы
// (поиск/фильтры уже отработали по полному набору до группировки), только
// то, сколько ГОТОВЫХ месячных блоков рендерится в DOM разом.
export const ORDERS_MONTHS_INITIAL_VISIBLE = 3
export const ORDERS_MONTHS_REVEAL_STEP = 3

export function getHiddenMonthsCount(totalGroups: number, visibleCount: number): number {
  return Math.max(0, totalGroups - visibleCount)
}

// Суммарная длительность заказов месяца для подписи месячного блока — null,
// если ни у одного заказа месяца длительность не известна (нечего суммировать,
// не показываем вводящий в заблуждение "0 ч"). Выручку сюда намеренно не
// добавляем: исторические заказы часто имеют неполные данные по оплате (см.
// scripts/promote-visits-to-orders), а платёжный источник истины —
// getOrderPaymentSummary (payment-model.ts) — уже используется для колонки
// "Оплата", но с потенциально неполными суммами эту функцию как сводную
// метрику месяца лучше не дублировать здесь.
export function monthGroupDurationLabel<T extends { durationMinutes: number | null }>(orders: T[]): string | null {
  const known = orders.filter(o => o.durationMinutes != null)
  if (known.length === 0) return null
  const totalMinutes = known.reduce((sum, o) => sum + o.durationMinutes!, 0)
  return formatDurationMinutes(totalMinutes)
}

// "1 заказ" / "2 заказа" / "5 заказов" — для подписи месячного блока.
export function pluralizeOrdersCount(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} заказ`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} заказа`
  return `${n} заказов`
}
