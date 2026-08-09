// Единый сервисный слой раздела «SMM» — по тому же принципу, что
// montage-model.ts для монтажа и order-model.ts для заказов: лейблы,
// расчёт расчётного периода, прогресса пакета и производных статусов живут
// здесь один раз и переиспользуются dashboard'ом, списком клиентов,
// карточкой SMM-проекта и разделом «Выплаты» — не копируются по компонентам
// (см. AGENTS.md, п.4). См. docs/business/SMM.md — архитектура целиком.

import type {
  SmmProjectStatus, SmmBillingPeriodType, SmmServiceType, SmmPackageUnit, SmmPackagePeriod,
  SmmContentStatus, SmmClientApprovalStatus, SmmMaterialCategory, SmmMaterialType, SmmProjectRole, SmmWorkType,
  SmmWorkStatus, SmmWorkPaymentStatus, SmmPayoutType, SmmClientPaymentStatus,
  SmmPublicationPlatform, SmmPublicationStatus, SmmMetricType, SmmMetricSource, MontageStatus,
} from '@prisma/client'
import type { SmmProjectDTO, SmmPackageItemDTO, SmmContentItemDTO, SmmProjectMemberDTO } from '@/lib/actions/smm'

export type {
  SmmProjectStatus, SmmBillingPeriodType, SmmServiceType, SmmPackageUnit, SmmPackagePeriod,
  SmmContentStatus, SmmClientApprovalStatus, SmmMaterialCategory, SmmMaterialType, SmmProjectRole, SmmWorkType,
  SmmWorkStatus, SmmWorkPaymentStatus, SmmPayoutType, SmmClientPaymentStatus,
  SmmPublicationPlatform, SmmPublicationStatus, SmmMetricType, SmmMetricSource,
}

// ============================================================
// ЛЕЙБЛЫ — единственный источник русских названий для каждого enum
// (SMM.md, п.12: "UI-названия должны быть понятными на русском").
// ============================================================

export const SMM_PROJECT_STATUS_LABELS: Record<SmmProjectStatus, string> = {
  ACTIVE: 'Активен',
  PAUSED: 'На паузе',
  ARCHIVED: 'В архиве',
}

export const SMM_SERVICE_TYPE_LABELS: Record<SmmServiceType, string> = {
  SHORT_VIDEO: 'Короткий ролик',
  LONG_VIDEO: 'Длинный ролик',
  POST: 'Публикация',
  CAROUSEL: 'Карусель',
  STORY: 'Stories',
  TEASER: 'Тизер',
  STUDIO_SHOOT: 'Съёмка в студии',
  LOCATION_SHOOT: 'Выездная съёмка',
  SHOOTING_HOURS: 'Часы съёмки',
  CONTENT_PLAN: 'Контент-план',
  PUBLICATION: 'Публикация в соцсети',
  DESIGN: 'Дизайн/графика',
  OTHER: 'Другое',
}

// Подмножество SmmServiceType, реально показываемое в форме единицы
// контента (2A, SMM.md, «Content type vs Package service type») —
// STUDIO_SHOOT/LOCATION_SHOOT/SHOOTING_HOURS/CONTENT_PLAN/PUBLICATION/
// DESIGN остаются в общем enum (используются SmmPackageItem), но не имеют
// смысла как формат ПРОИЗВЕДЁННОГО контента, поэтому не предлагаются при
// создании/редактировании SmmContentItem. Пакет продолжает показывать
// полный SMM_SERVICE_TYPE_LABELS — это только фильтр для одной формы.
export const CONTENT_SERVICE_TYPES: SmmServiceType[] = [
  'SHORT_VIDEO', 'LONG_VIDEO', 'POST', 'CAROUSEL', 'STORY', 'TEASER', 'OTHER',
]

export const SMM_PACKAGE_UNIT_LABELS: Record<SmmPackageUnit, string> = {
  PIECE: 'шт.',
  HOUR: 'ч.',
  SHOOT: 'съёмка',
  PUBLICATION: 'публикация',
  DAY: 'дн.',
  OTHER: 'ед.',
}

export const SMM_PACKAGE_PERIOD_LABELS: Record<SmmPackagePeriod, string> = {
  MONTH: 'в месяц',
  WEEK: 'в неделю',
  BILLING_PERIOD: 'за расчётный период',
  ONE_TIME: 'разово',
}

export const SMM_CONTENT_STATUS_LABELS: Record<SmmContentStatus, string> = {
  IDEA: 'Идея',
  PLANNED: 'Запланировано',
  WAITING_FOR_SHOOT: 'Ожидает съёмки',
  SHOT: 'Снято',
  IN_EDIT: 'Монтаж',
  REVIEW: 'На проверке',
  APPROVED: 'Согласовано',
  SCHEDULED: 'Запланировано к публикации',
  PUBLISHED: 'Опубликовано',
  CANCELLED: 'Отменено',
}

// Порядок для канбан/сортировки — тот же принцип, что MONTAGE_STATUS_ORDER
// (montage-model.ts): последовательность реального производственного цикла,
// CANCELLED — терминальный, вне основного потока.
export const SMM_CONTENT_STATUS_ORDER: SmmContentStatus[] = [
  'IDEA', 'PLANNED', 'WAITING_FOR_SHOOT', 'SHOT', 'IN_EDIT', 'REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHED',
]

export const SMM_CLIENT_APPROVAL_STATUS_LABELS: Record<SmmClientApprovalStatus, string> = {
  NOT_REQUIRED: 'Не требуется',
  PENDING: 'Ожидает согласования',
  APPROVED: 'Согласовано',
  REJECTED: 'Отклонено',
}

export const SMM_MATERIAL_CATEGORY_LABELS: Record<SmmMaterialCategory, string> = {
  SOURCE: 'Исходники',
  SOURCE_SORTED: 'Отсортированные исходники',
  FINISHED_SHORT: 'Готовые короткие ролики',
  FINISHED_LONG: 'Готовые длинные ролики',
  GRAPHICS: 'Графические материалы',
  DOCUMENT: 'Документы',
  OTHER: 'Другое',
}

// 2A — более гранулярная типизация поверх category (см. enum
// SmmMaterialType в schema.prisma). Nullable на модели — "Не указан" в UI
// соответствует materialType === null.
export const SMM_MATERIAL_TYPE_LABELS: Record<SmmMaterialType, string> = {
  SOURCE_VIDEO: 'Видео-исходник',
  SOURCE_AUDIO: 'Аудио-исходник',
  SELECTED_SOURCE: 'Отобранный исходник',
  MASTER: 'Мастер-файл',
  COVER: 'Обложка',
  REFERENCE: 'Референс',
  DOCUMENT: 'Документ',
  IMAGE: 'Изображение',
  OTHER: 'Другое',
}

export const SMM_PROJECT_ROLE_LABELS: Record<SmmProjectRole, string> = {
  OWNER: 'Руководитель',
  STRATEGIST: 'Стратегический SMM-менеджер',
  SMM_MANAGER: 'Операционный SMM-менеджер',
  EDITOR: 'Монтажёр',
  OTHER: 'Другое',
}

// Приоритет роли для выбора "основного ответственного" в списке клиентов
// (SMM.md, п.6) — вычисляется, не хранится отдельным полем на SmmProject
// (тот же принцип "не дублировать то, что можно вывести", что и
// computeMontageDeadline/computeMontageProfit). Меньше — выше приоритет.
const SMM_PROJECT_ROLE_PRIORITY: Record<SmmProjectRole, number> = {
  OWNER: 1, STRATEGIST: 2, SMM_MANAGER: 3, EDITOR: 4, OTHER: 5,
}

export const SMM_WORK_TYPE_LABELS: Record<SmmWorkType, string> = {
  EDITING: 'Монтаж',
  SUBTITLES: 'Субтитры',
  REVISION: 'Правки',
  DESIGN: 'Дизайн',
  SHOOTING: 'Съёмка',
  OTHER: 'Другое',
}

export const SMM_WORK_STATUS_LABELS: Record<SmmWorkStatus, string> = {
  DRAFT: 'Черновик',
  SUBMITTED: 'Отправлено',
  APPROVED: 'Подтверждено',
  REJECTED: 'Отклонено',
}

export const SMM_WORK_PAYMENT_STATUS_LABELS: Record<SmmWorkPaymentStatus, string> = {
  UNPAID: 'Не оплачено',
  PLANNED: 'Запланировано',
  PAID: 'Оплачено',
}

export const SMM_PAYOUT_TYPE_LABELS: Record<SmmPayoutType, string> = {
  PIECEWORK: 'Сдельная',
  SALARY: 'Фиксированная',
  BONUS: 'Премия',
  OTHER: 'Другое',
}

export const SMM_CLIENT_PAYMENT_STATUS_LABELS: Record<SmmClientPaymentStatus, string> = {
  PLANNED: 'Запланирован',
  DUE: 'Наступает срок',
  PAID: 'Оплачен',
  CANCELLED: 'Отменён',
}

// 2A — SmmPublication/SmmPublicationMetric (SMM.md, «Content vs Publication»).
export const SMM_PUBLICATION_PLATFORM_LABELS: Record<SmmPublicationPlatform, string> = {
  INSTAGRAM: 'Instagram',
  TELEGRAM: 'Telegram',
  VK: 'VK',
  YOUTUBE: 'YouTube',
  RUTUBE: 'RUTUBE',
  OTHER: 'Другое',
}

export const SMM_PUBLICATION_STATUS_LABELS: Record<SmmPublicationStatus, string> = {
  PLANNED: 'Запланирована',
  READY: 'Готова',
  PUBLISHED: 'Опубликована',
  CANCELLED: 'Отменена',
}

export const SMM_METRIC_TYPE_LABELS: Record<SmmMetricType, string> = {
  VIEWS: 'Просмотры',
  REACH: 'Охват',
  LIKES: 'Лайки',
  COMMENTS: 'Комментарии',
  SHARES: 'Репосты',
  SAVES: 'Сохранения',
  REACTIONS: 'Реакции',
  FOLLOWERS_GAINED: 'Новые подписчики',
  RETENTION_PERCENT: 'Досмотр, %',
  WATCH_TIME: 'Время просмотра',
}

export const SMM_METRIC_SOURCE_LABELS: Record<SmmMetricSource, string> = {
  MANUAL: 'Вручную',
  API: 'API',
  IMPORT: 'Импорт',
}

// ============================================================
// ФОРМАТИРОВАНИЕ — тот же локальный Intl.NumberFormat, что в
// MontageOverview.tsx/остальных дашбордах проекта (единого shared-хелпера
// форматирования денег в проекте нет — см. соответствующий прецедент).
// ============================================================

export function formatSmmMoney(v: number): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

// ============================================================
// РАСЧЁТНЫЙ ПЕРИОД (SMM.md, п.10) — НЕ всегда календарный месяц. CUSTOM
// считается от дня месяца, в который начался проект (startDate), а не от
// 1 числа — пример из ТЗ: старт 08.08.2026 → период 08.08–07.09. Период не
// хранится построчно — вычисляется на лету от reference-даты, тот же принцип,
// что computeMontageDeadline (montage-model.ts).
// ============================================================

export interface SmmBillingPeriod {
  start: Date
  end: Date
}

export function computeSmmBillingPeriod(
  startDate: string, billingPeriodType: SmmBillingPeriodType, referenceDate: Date = new Date(),
): SmmBillingPeriod {
  if (billingPeriodType === 'CALENDAR_MONTH') {
    const start = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1)
    const end = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0, 23, 59, 59, 999)
    return { start, end }
  }

  // CUSTOM — якорный день месяца берётся из даты старта проекта. Если в
  // текущем месяце ещё не наступил этот день — период начался в прошлом
  // календарном месяце (пример: якорь 8-е число, сегодня 3-е → период
  // стартовал 8-го ПРОШЛОГО месяца).
  const anchorDay = new Date(startDate).getDate()
  const ref = referenceDate
  let periodStart = new Date(ref.getFullYear(), ref.getMonth(), anchorDay)
  if (periodStart > ref) {
    periodStart = new Date(ref.getFullYear(), ref.getMonth() - 1, anchorDay)
  }
  const periodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, anchorDay)
  periodEnd.setDate(periodEnd.getDate() - 1)
  periodEnd.setHours(23, 59, 59, 999)
  return { start: periodStart, end: periodEnd }
}

export function isWithinPeriod(date: string | null, period: SmmBillingPeriod): boolean {
  if (!date) return false
  const d = new Date(date)
  return d >= period.start && d <= period.end
}

// ============================================================
// ПРОГРЕСС ПАКЕТА (SMM.md, п.8/9) — строится ДИНАМИЧЕСКИ из пакета клиента,
// не фиксированным набором полей ("Короткие ролики 18/25"). Считает, сколько
// единиц контента данного типа (любого нетерминального статуса, кроме
// CANCELLED) создано в текущем расчётном периоде — из скольки обещанных по
// пакету. Пункты пакета без числового quantity (диапазоны/скидки/текстовые
// условия) не участвуют в дроби — показываются только описанием в UI.
// ============================================================

export interface SmmPackageProgressItem {
  packageItem: SmmPackageItemDTO
  done: number
  target: number | null
}

export function computePackageProgress(
  packageItems: SmmPackageItemDTO[], contentItems: SmmContentItemDTO[], period: SmmBillingPeriod,
): SmmPackageProgressItem[] {
  return packageItems
    .filter(p => p.included)
    .map(packageItem => {
      const done = contentItems.filter(c =>
        c.serviceType === packageItem.serviceType
        && c.status !== 'CANCELLED'
        && isWithinPeriod(c.plannedPublishDate ?? c.createdAt, period)
      ).length
      return { packageItem, done, target: packageItem.quantity }
    })
}

// ============================================================
// ПРОИЗВОДНЫЕ ПРИЗНАКИ КОНТЕНТА
// ============================================================

export function isSmmContentOverdue(item: Pick<SmmContentItemDTO, 'deadline' | 'status'>, now: Date = new Date()): boolean {
  if (!item.deadline) return false
  if (item.status === 'PUBLISHED' || item.status === 'CANCELLED') return false
  return new Date(item.deadline) < now
}

// ============================================================
// КОМАНДА ПРОЕКТА
// ============================================================

export function getPrimaryResponsibleMember(members: SmmProjectMemberDTO[]): SmmProjectMemberDTO | null {
  const active = members.filter(m => !m.activeTo)
  if (active.length === 0) return null
  return [...active].sort((a, b) => SMM_PROJECT_ROLE_PRIORITY[a.role] - SMM_PROJECT_ROLE_PRIORITY[b.role])[0]
}

// ============================================================
// DASHBOARD-АГРЕГАТЫ (SMM.md, п.5) — «Месячная выручка SMM» (сумма
// стоимостей активных контрактов) сознательно ОТДЕЛЕНА от «Получено в
// текущем месяце» (реально зарегистрированные оплаты) — та же дисциплина,
// что FINANCE.md требует для «Прибыли по заказу»: не путать план с фактом.
// ============================================================

export interface SmmDashboardInput {
  projects: SmmProjectDTO[]
}

export function computeSmmMonthlyRevenue(projects: SmmProjectDTO[]): number {
  return projects.filter(p => p.status === 'ACTIVE').reduce((sum, p) => sum + (p.monthlyFee ?? 0), 0)
}

// ============================================================
// PARENT/CHILD CONTENT (2A, ТЗ п.15/16) — self-relation на SmmContentItem
// (длинный выпуск → тизер/фрагменты). Защита от self-reference и цикла —
// не общий graph engine, просто обход цепочки родителей НОВОГО
// parentContentId вверх: если по пути встретилась сама единица контента —
// это цикл. MAX_PARENT_CHAIN_DEPTH — защита от уже испорченных данных
// (бесконечный while при повреждённой цепочке), не ожидаемый рабочий кейс.
// ============================================================

interface ContentParentLink {
  id: string
  parentContentId: string | null
}

const MAX_PARENT_CHAIN_DEPTH = 50

export function wouldCreateContentParentCycle(
  allItems: ContentParentLink[], itemId: string, newParentId: string | null,
): boolean {
  if (!newParentId) return false
  if (newParentId === itemId) return true
  const byId = new Map(allItems.map(i => [i.id, i]))
  let current = byId.get(newParentId) ?? null
  let depth = 0
  while (current && depth < MAX_PARENT_CHAIN_DEPTH) {
    if (current.id === itemId) return true
    current = current.parentContentId ? (byId.get(current.parentContentId) ?? null) : null
    depth++
  }
  return false
}

// ============================================================
// МЕТРИКИ ПУБЛИКАЦИИ (2A, ТЗ п.10/11) — capturedAt-снимки, не
// перезаписываемое "последнее значение". Для компактного отображения в UI
// нужно только последнее значение по каждому metricType — вычисляется
// здесь, а не хранится отдельно (та же экономия источника правды, что и
// остальной модуль).
// ============================================================

interface MetricSnapshot {
  metricType: SmmMetricType
  value: number
  capturedAt: string
}

export function getLatestMetricByType<T extends MetricSnapshot>(metrics: T[]): Partial<Record<SmmMetricType, T>> {
  const latest: Partial<Record<SmmMetricType, T>> = {}
  for (const m of metrics) {
    const current = latest[m.metricType]
    if (!current || new Date(m.capturedAt) > new Date(current.capturedAt)) {
      latest[m.metricType] = m
    }
  }
  return latest
}

// ============================================================
// PRODUCTION (2B, docs/business/SMM.md, «Production») — глобальный
// операционный экран SMM → Производство. Вся derived-логика строки
// (просрочка/«требует внимания»/ближайшая публикация/короткое состояние
// монтажа/индикатор материалов/сортировка) живёт здесь одним источником —
// ТЗ 2B, п.30: "не размазывать логику по React-компонентам".
// ============================================================

// Короткое состояние реального MontageProject для компактной колонки
// «Монтаж» (ТЗ 2B, п.5) — НЕ второй статус-система, чистая свёртка уже
// существующего MontageStatus в 4 операционные группы.
export function getContentMontageShortState(editingProjectStatus: MontageStatus | null): string {
  if (!editingProjectStatus) return 'Не создан'
  if (editingProjectStatus === 'NEW' || editingProjectStatus === 'IN_PROGRESS') return 'В работе'
  if (editingProjectStatus === 'IN_REVIEW' || editingProjectStatus === 'REVISIONS') return 'На проверке'
  if (editingProjectStatus === 'DELIVERED') return 'Готово'
  return 'Отменён'
}

// Ближайшая ПЛАНОВАЯ публикация среди непубликаций-CANCELLED (ТЗ 2B, п.5:
// "если публикаций несколько — показать ближайшую дату и количество
// площадок"). platformCount — все активные публикации, не только те, что
// совпадают датой с ближайшей.
export interface SmmNearestPublicationInfo {
  date: string
  platformCount: number
}

export function getNearestPublicationInfo(
  publications: { plannedPublishAt: string | null; status: SmmPublicationStatus }[],
): SmmNearestPublicationInfo | null {
  const active = publications.filter(p => p.status !== 'CANCELLED')
  if (active.length === 0) return null
  const withDate = active
    .filter((p): p is { plannedPublishAt: string; status: SmmPublicationStatus } => p.plannedPublishAt !== null)
    .sort((a, b) => new Date(a.plannedPublishAt).getTime() - new Date(b.plannedPublishAt).getTime())
  if (withDate.length === 0) return null
  return { date: withDate[0].plannedPublishAt, platformCount: active.length }
}

// Компактный индикатор материалов для колонки «Материалы» (ТЗ 2B, п.5: "не
// выводить длинные URL, только есть/нет исходников, есть/нет master").
// Master учитывает ТОЛЬКО SmmMaterialLink здесь — сигнал от
// MontageProject.deliveryUrl (тоже валидный источник "master есть", см.
// SMM.md, «Source/Master/Publication URL») подмешивается вызывающим кодом
// (actions/smm.ts, при сборке строки), а не этой функцией — она не знает
// про MontageProject и не должна.
const SOURCE_MATERIAL_TYPES: SmmMaterialType[] = ['SOURCE_VIDEO', 'SOURCE_AUDIO', 'SELECTED_SOURCE']
const SOURCE_MATERIAL_CATEGORIES: SmmMaterialCategory[] = ['SOURCE', 'SOURCE_SORTED']
const MASTER_MATERIAL_CATEGORIES: SmmMaterialCategory[] = ['FINISHED_SHORT', 'FINISHED_LONG']

export interface SmmContentMaterialsIndicator {
  hasSource: boolean
  hasMaster: boolean
}

export function computeContentMaterialsIndicator(
  materialLinks: { materialType: SmmMaterialType | null; category: SmmMaterialCategory }[],
): SmmContentMaterialsIndicator {
  const hasSource = materialLinks.some(m =>
    (m.materialType && SOURCE_MATERIAL_TYPES.includes(m.materialType)) || SOURCE_MATERIAL_CATEGORIES.includes(m.category)
  )
  const hasMaster = materialLinks.some(m => m.materialType === 'MASTER' || MASTER_MATERIAL_CATEGORIES.includes(m.category))
  return { hasSource, hasMaster }
}

// «Требует внимания» (ТЗ 2B, п.31) — derived state, НЕ поле в БД. Общий
// вход для операционной просрочки (isSmmContentOperationallyOverdue ниже
// выводится из ТЕХ ЖЕ причин, не пересчитывает дедлайн заново отдельной
// формулой — единственный источник, ТЗ п.30: "не размазывать логику").
export type SmmContentAttentionReason =
  | 'OVERDUE_PRODUCTION' | 'OVERDUE_PUBLICATION' | 'NO_SOURCE_MATERIALS' | 'NO_EDITOR_IN_EDIT' | 'PUBLICATION_READY_NO_URL'

export const SMM_CONTENT_ATTENTION_LABELS: Record<SmmContentAttentionReason, string> = {
  OVERDUE_PRODUCTION: 'Просрочен дедлайн производства/монтажа',
  OVERDUE_PUBLICATION: 'Просрочена публикация',
  NO_SOURCE_MATERIALS: 'Нет исходников',
  NO_EDITOR_IN_EDIT: 'В монтаже без монтажёра',
  PUBLICATION_READY_NO_URL: 'Публикация готова, но без ссылки после срока',
}

export interface SmmContentAttentionInput {
  status: SmmContentStatus
  // "Релевантный" дедлайн производства — ContentItem.deadline, ЗА ИСКЛЮЧЕНИЕМ
  // статуса IN_EDIT, где реальный срок держит MontageProject.deadlineDate
  // (SMM.md, «MontageProject остаётся source of truth для монтажа») —
  // именно поэтому оба передаются отдельно, а не заранее "схлопнуты" одним
  // числом на вызывающей стороне.
  deadline: string | null
  editingProjectStatus: MontageStatus | null
  editingProjectDeadlineDate: string | null
  editingProjectEditorId: string | null
  hasSourceMaterials: boolean
  publications: { status: SmmPublicationStatus; plannedPublishAt: string | null; url: string | null }[]
}

// Статусы, для которых источники ещё не обязаны существовать (идея/план/
// ожидание съёмки) — тот же принцип, что MONTAGE_ATTENTION_EXEMPT_STATUSES
// в montage-model.ts: не ругаться на пустую карточку, которую только что создали.
const CONTENT_SOURCE_REQUIRED_STATUSES: SmmContentStatus[] = ['WAITING_FOR_SHOOT', 'SHOT', 'IN_EDIT']

export function getSmmContentAttentionReasons(item: SmmContentAttentionInput, now: Date = new Date()): SmmContentAttentionReason[] {
  if (item.status === 'CANCELLED' || item.status === 'PUBLISHED') return []
  const reasons: SmmContentAttentionReason[] = []

  const relevantDeadline = item.status === 'IN_EDIT' && item.editingProjectDeadlineDate ? item.editingProjectDeadlineDate : item.deadline
  if (relevantDeadline && new Date(relevantDeadline) < now) reasons.push('OVERDUE_PRODUCTION')

  if (item.publications.some(p => p.plannedPublishAt && new Date(p.plannedPublishAt) < now && p.status !== 'PUBLISHED' && p.status !== 'CANCELLED')) {
    reasons.push('OVERDUE_PUBLICATION')
  }

  if (item.status === 'IN_EDIT' && !item.editingProjectEditorId) reasons.push('NO_EDITOR_IN_EDIT')

  if (CONTENT_SOURCE_REQUIRED_STATUSES.includes(item.status) && !item.hasSourceMaterials) {
    reasons.push('NO_SOURCE_MATERIALS')
  }

  if (item.publications.some(p => p.status === 'READY' && p.plannedPublishAt && new Date(p.plannedPublishAt) < now && !p.url)) {
    reasons.push('PUBLICATION_READY_NO_URL')
  }

  return reasons
}

// Операционная просрочка (ТЗ 2B, п.30) — ШИРЕ, чем isSmmContentOverdue выше
// (та смотрит только на ContentItem.deadline, используется дашбордом этапа
// 1/2A без изменений). Здесь же учитывается ещё и дедлайн MontageProject, и
// просроченные публикации — производная ОТ getSmmContentAttentionReasons
// (единственный источник причин, не вторая параллельная формула).
export function isSmmContentOperationallyOverdue(item: SmmContentAttentionInput, now: Date = new Date()): boolean {
  const reasons = getSmmContentAttentionReasons(item, now)
  return reasons.includes('OVERDUE_PRODUCTION') || reasons.includes('OVERDUE_PUBLICATION')
}

// Дефолтная сортировка строки Production (ТЗ 2B, п.10): просроченные →
// ближайший дедлайн → ближайшая публикация → остальное по дате создания.
// Строка сама несёт уже посчитанные isOverdue/sortDeadline/
// nearestPublicationDate — функция ничего не пересчитывает, только
// упорядочивает (та же экономия, что в остальном модуле).
export interface SmmProductionSortableRow {
  isOverdue: boolean
  sortDeadline: string | null
  nearestPublicationDate: string | null
  createdAt: string
}

export function sortSmmProductionRowsDefault<T extends SmmProductionSortableRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1
    const ad = a.sortDeadline ? new Date(a.sortDeadline).getTime() : Infinity
    const bd = b.sortDeadline ? new Date(b.sortDeadline).getTime() : Infinity
    if (ad !== bd) return ad - bd
    const ap = a.nearestPublicationDate ? new Date(a.nearestPublicationDate).getTime() : Infinity
    const bp = b.nearestPublicationDate ? new Date(b.nearestPublicationDate).getTime() : Infinity
    if (ap !== bp) return ap - bp
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })
}

// KPI-строка над Production (ТЗ 2B, п.32) — компактные счётчики, не
// dashboard-карточки. Считается из уже загруженных строк на клиенте, не
// отдельным SQL-агрегатом (тот же объём данных, который и так на экране).
export interface SmmProductionKpis {
  inProgress: number
  inEdit: number
  inReview: number
  readyToPublish: number
  overdue: number
}

const KPI_IN_PROGRESS_STATUSES: SmmContentStatus[] = ['IDEA', 'PLANNED', 'WAITING_FOR_SHOOT', 'SHOT']

// "Готово к публикации" — та же группа статусов, что и в KPI-счётчике ниже,
// и в quick-пресете "Готово к публикации" таблицы (ProductionView) — один
// источник, не третья копия того же списка.
export const SMM_READY_TO_PUBLISH_STATUSES: SmmContentStatus[] = ['APPROVED', 'SCHEDULED']

export function computeSmmProductionKpis<T extends { status: SmmContentStatus; isOverdue: boolean }>(rows: T[]): SmmProductionKpis {
  return {
    inProgress: rows.filter(r => KPI_IN_PROGRESS_STATUSES.includes(r.status)).length,
    inEdit: rows.filter(r => r.status === 'IN_EDIT').length,
    inReview: rows.filter(r => r.status === 'REVIEW').length,
    readyToPublish: rows.filter(r => SMM_READY_TO_PUBLISH_STATUSES.includes(r.status)).length,
    overdue: rows.filter(r => r.isOverdue).length,
  }
}

// ============================================================
// Фильтрация и поиск таблицы Production (ТЗ 2B, п.7-9) — чистая функция,
// не размазанная по ProductionView/ProductionTable (тот же принцип, что и
// у derived-полей выше). URL-синхронизация состояния фильтров живёт в
// ProductionView (клиентские router.replace в обработчиках, без useEffect —
// SMM.md, «set-state-in-effect»), сама фильтрация — здесь.
// ============================================================

export type SmmProductionDateFilter = 'ALL' | 'TODAY' | 'WEEK' | 'MONTH' | 'OVERDUE' | 'NONE'

export const SMM_PRODUCTION_DATE_FILTER_LABELS: Record<SmmProductionDateFilter, string> = {
  ALL: 'Все даты',
  TODAY: 'Сегодня',
  WEEK: 'Эта неделя',
  MONTH: 'Этот месяц',
  OVERDUE: 'Просрочено',
  NONE: 'Без даты',
}

interface DateFilterableRow {
  sortDeadline: string | null
  nearestPublicationDate: string | null
  isOverdue: boolean
}

function startOfWeek(d: Date): Date {
  const day = (d.getDay() + 6) % 7 // понедельник = 0
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day)
  start.setHours(0, 0, 0, 0)
  return start
}
function endOfWeek(d: Date): Date {
  const start = startOfWeek(d)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
  end.setHours(23, 59, 59, 999)
  return end
}

// "Релевантная" дата строки — ближайший дедлайн производства/монтажа, а при
// его отсутствии ближайшая плановая публикация (тот же приоритет, что уже
// зашит в sortDeadline на стороне actions/smm.ts) — Сегодня/Неделя/Месяц
// фильтруют по НЕЙ, не по двум датам по отдельности.
export function matchesSmmProductionDateFilter(row: DateFilterableRow, filter: SmmProductionDateFilter, now: Date = new Date()): boolean {
  if (filter === 'ALL') return true
  if (filter === 'OVERDUE') return row.isOverdue
  const relevant = row.sortDeadline ?? row.nearestPublicationDate
  if (filter === 'NONE') return relevant === null
  if (!relevant) return false
  const d = new Date(relevant)
  if (filter === 'TODAY') return d.toDateString() === now.toDateString()
  if (filter === 'WEEK') return d >= startOfWeek(now) && d <= endOfWeek(now)
  if (filter === 'MONTH') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  return true
}

export interface SmmProductionFilters {
  search: string
  smmProjectId: string | 'ALL'
  status: SmmContentStatus | 'ALL'
  serviceType: SmmServiceType | 'ALL'
  editorId: string | 'ALL'
  dateFilter: SmmProductionDateFilter
  platform: SmmPublicationPlatform | 'ALL'
  // Отдельный тумблер, а не значение статус-фильтра (ТЗ 2B, п.8: пресет
  // "Готово к публикации" — это ДВА статуса сразу, APPROVED и SCHEDULED,
  // одиночный select статуса такое выразить не может без второй enum-копии).
  readyToPublishOnly: boolean
}

export const SMM_PRODUCTION_DEFAULT_FILTERS: SmmProductionFilters = {
  search: '', smmProjectId: 'ALL', status: 'ALL', serviceType: 'ALL', editorId: 'ALL', dateFilter: 'ALL', platform: 'ALL', readyToPublishOnly: false,
}

interface SmmProductionFilterableRow extends DateFilterableRow {
  smmProjectId: string
  clientName: string | null
  fileCode: string | null
  title: string | null
  status: SmmContentStatus
  serviceType: SmmServiceType
  editorId: string | null
  publicationPlatforms: SmmPublicationPlatform[]
}

// Поиск ищет по File Code (docs/business/SMM.md, «File Code»), не по
// прежнему Content Code — тот больше не показывается и не заполняется в
// новых данных.
export function filterSmmProductionRows<T extends SmmProductionFilterableRow>(
  rows: T[], filters: SmmProductionFilters, now: Date = new Date(),
): T[] {
  const q = filters.search.trim().toLowerCase()
  return rows.filter(r => {
    if (q) {
      const haystack = [r.fileCode, r.title, r.clientName].filter(Boolean).join(' ').toLowerCase()
      if (!haystack.includes(q)) return false
    }
    if (filters.smmProjectId !== 'ALL' && r.smmProjectId !== filters.smmProjectId) return false
    if (filters.status !== 'ALL' && r.status !== filters.status) return false
    if (filters.serviceType !== 'ALL' && r.serviceType !== filters.serviceType) return false
    if (filters.editorId !== 'ALL' && r.editorId !== filters.editorId) return false
    if (filters.platform !== 'ALL' && !r.publicationPlatforms.includes(filters.platform)) return false
    if (filters.readyToPublishOnly && !SMM_READY_TO_PUBLISH_STATUSES.includes(r.status)) return false
    if (!matchesSmmProductionDateFilter(r, filters.dateFilter, now)) return false
    return true
  })
}

// ============================================================
// FILE CODE (следующий этап после 2B, docs/business/SMM.md, «File Code») —
// единственный человекочитаемый идентификатор готового файла, заменяет
// прежний двойной Content Code/File Code. Формат:
// ГГГГ.ММ.ДД-{projectCode}-{editorCode}-{порядковый номер монтажёра}-V{версия}
// Чистое форматирование живёт здесь; генерация номера (атомарный счётчик,
// см. «Гонки при генерации номера») — в actions/smm.ts, у базы данных.
// ============================================================

function padNumber(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

export function formatFileCodeDate(date: Date): string {
  return `${date.getFullYear()}.${padNumber(date.getMonth() + 1, 2)}.${padNumber(date.getDate(), 2)}`
}

// База БЕЗ версии ("2026.08.09-DIA-AH-017") — формируется один раз при
// первой передаче в монтаж, дальше не пересчитывается (MontageProject.fileCodeBase).
export function formatFileCodeBase(date: Date, projectCode: string, editorCode: string, sequence: number): string {
  return `${formatFileCodeDate(date)}-${projectCode}-${editorCode}-${padNumber(sequence, 3)}`
}

// Полный File Code конкретной версии — единственное, что видит пользователь
// как "имя файла" (ТЗ, «Master File Code»: не показывать base и version
// отдельно как две конкурирующие системы).
export function formatFileCode(base: string, versionNumber: number): string {
  return `${base}-V${padNumber(versionNumber, 2)}`
}

// ============================================================
// КОНТЕНТ-ПЛАН (следующий этап после 2B, docs/business/SMM.md, «Views») —
// pivot-представление Publication по площадкам, НЕ отдельные физические
// поля instagram/telegram/vk/youtube (ТЗ: "если появились новые площадки —
// backend не меняется"). Чистая функция группировки, площадки, которых нет
// в данных, просто отсутствуют в результирующем объекте — UI решает, что
// показать вместо них ("—").
// ============================================================

export interface SmmContentPlanPlatformCell {
  publicationId: string
  status: SmmPublicationStatus
  plannedPublishAt: string | null
  publishedAt: string | null
  url: string | null
}

interface ContentPlanPublicationInput {
  id: string
  platform: SmmPublicationPlatform
  status: SmmPublicationStatus
  plannedPublishAt: string | null
  publishedAt: string | null
  url: string | null
}

// Если на одной площадке легитимно несколько публикаций (ТЗ 2B, п.21) —
// в pivot-ячейку попадает ближайшая по плановой дате, не первая/последняя
// по порядку создания (иначе ячейка "плавала" бы в зависимости от порядка
// добавления, а не от реальной хронологии).
export function buildContentPlanPlatformCells(
  publications: ContentPlanPublicationInput[],
): Partial<Record<SmmPublicationPlatform, SmmContentPlanPlatformCell>> {
  const cells: Partial<Record<SmmPublicationPlatform, SmmContentPlanPlatformCell>> = {}
  for (const p of publications) {
    const existing = cells[p.platform]
    const isCloser = existing && p.plannedPublishAt && existing.plannedPublishAt && p.plannedPublishAt < existing.plannedPublishAt
    if (!existing || (existing && !existing.plannedPublishAt && p.plannedPublishAt) || isCloser) {
      cells[p.platform] = { publicationId: p.id, status: p.status, plannedPublishAt: p.plannedPublishAt, publishedAt: p.publishedAt, url: p.url }
    }
  }
  return cells
}

// ============================================================
// ГЛОБАЛЬНЫЙ КАЛЕНДАРЬ SMM (следующий этап после 2B, docs/business/SMM.md,
// «Views») — /admin/smm/calendar ничего своего не хранит, агрегирует уже
// существующие источники: Publication (план/факт), ScheduleEvent SMM-съёмок,
// дедлайны ContentItem/MontageProject. Здесь — только объединение уже
// смаппленных построчных источников в один отсортированный список +
// фильтрация; сама выборка строк из БД — в actions/smm.ts.
// ============================================================

export type SmmCalendarEventKind = 'PUBLICATION' | 'SHOOT' | 'DEADLINE'

export interface SmmCalendarEvent {
  id: string
  kind: SmmCalendarEventKind
  date: string
  title: string
  smmProjectId: string
  clientName: string | null
  contentItemId: string | null
  publicationId: string | null
  platform: SmmPublicationPlatform | null
  scheduleEventId: string | null
  orderId: string | null
}

interface CalendarPublicationInput {
  id: string; date: string; title: string; smmProjectId: string; clientName: string | null; contentItemId: string; platform: SmmPublicationPlatform
}
interface CalendarShootInput {
  id: string; date: string; title: string; smmProjectId: string; clientName: string | null; scheduleEventId: string; orderId: string | null
}
interface CalendarDeadlineInput {
  id: string; date: string; title: string; smmProjectId: string; clientName: string | null; contentItemId: string
}

export function buildSmmCalendarEvents(input: {
  publications: CalendarPublicationInput[]
  shoots: CalendarShootInput[]
  deadlines: CalendarDeadlineInput[]
}): SmmCalendarEvent[] {
  const events: SmmCalendarEvent[] = [
    ...input.publications.map(p => ({
      id: `pub-${p.id}`, kind: 'PUBLICATION' as const, date: p.date, title: p.title, smmProjectId: p.smmProjectId, clientName: p.clientName,
      contentItemId: p.contentItemId, publicationId: p.id, platform: p.platform, scheduleEventId: null, orderId: null,
    })),
    ...input.shoots.map(s => ({
      id: `shoot-${s.id}`, kind: 'SHOOT' as const, date: s.date, title: s.title, smmProjectId: s.smmProjectId, clientName: s.clientName,
      contentItemId: null, publicationId: null, platform: null, scheduleEventId: s.scheduleEventId, orderId: s.orderId,
    })),
    ...input.deadlines.map(d => ({
      id: `deadline-${d.id}`, kind: 'DEADLINE' as const, date: d.date, title: d.title, smmProjectId: d.smmProjectId, clientName: d.clientName,
      contentItemId: d.contentItemId, publicationId: null, platform: null, scheduleEventId: null, orderId: null,
    })),
  ]
  return events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

export interface SmmCalendarFilters {
  smmProjectId: string | 'ALL'
  kind: SmmCalendarEventKind | 'ALL'
  platform: SmmPublicationPlatform | 'ALL'
}

export function filterSmmCalendarEvents(events: SmmCalendarEvent[], filters: SmmCalendarFilters): SmmCalendarEvent[] {
  return events.filter(e => {
    if (filters.smmProjectId !== 'ALL' && e.smmProjectId !== filters.smmProjectId) return false
    if (filters.kind !== 'ALL' && e.kind !== filters.kind) return false
    if (filters.platform !== 'ALL' && e.platform !== filters.platform) return false
    return true
  })
}

// ============================================================
// АНАЛИТИКА (следующий этап после 2B, docs/business/SMM.md, «Views») —
// агрегаты считаются из уже загруженного набора строк аналитической таблицы
// (latest snapshot на публикацию), не отдельным SQL-агрегатом — тот же
// объём данных, что и так на экране (ТЗ 2B «Production KPI», тот же приём).
// ============================================================

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export interface SmmAnalyticsAggregates {
  publishedCount: number
  totalViews: number
  averageViews: number
  medianViews: number
  bestContentTitle: string | null
  bestContentViews: number | null
  followersGained: number
}

interface AnalyticsRowInput {
  status: SmmPublicationStatus
  title: string | null
  latestViews: number | null
  latestFollowersGained: number | null
}

export function computeSmmAnalyticsAggregates(rows: AnalyticsRowInput[]): SmmAnalyticsAggregates {
  const published = rows.filter(r => r.status === 'PUBLISHED')
  const viewsList = published.map(r => r.latestViews).filter((v): v is number => v != null)
  const totalViews = viewsList.reduce((sum, v) => sum + v, 0)

  let bestContentTitle: string | null = null
  let bestContentViews: number | null = null
  for (const r of published) {
    if (r.latestViews != null && (bestContentViews === null || r.latestViews > bestContentViews)) {
      bestContentViews = r.latestViews
      bestContentTitle = r.title
    }
  }

  return {
    publishedCount: published.length,
    totalViews,
    averageViews: viewsList.length > 0 ? Math.round(totalViews / viewsList.length) : 0,
    medianViews: Math.round(median(viewsList)),
    bestContentTitle,
    bestContentViews,
    followersGained: published.reduce((sum, r) => sum + (r.latestFollowersGained ?? 0), 0),
  }
}

// ============================================================
// РЕГУЛЯРНЫЕ ВЫПЛАТЫ (следующий этап после 2B, docs/business/SMM.md,
// «Регулярные выплаты») — SmmRecurringPayout хранит ТОЛЬКО план (дни месяца
// + границы действия), сами даты обязательств за конкретный период
// вычисляются здесь на лету, не хранятся построчно на годы вперёд (тот же
// принцип, что computeSmmBillingPeriod). Дни за пределами длины конкретного
// месяца (31 в феврале) клэмпятся к последнему дню месяца.
// ============================================================

export interface SmmRecurringPayoutScheduleInput {
  daysOfMonth: number[]
  startDate: string
  endDate: string | null
}

export function computeRecurringPayoutDueDates(payout: SmmRecurringPayoutScheduleInput, periodStart: Date, periodEnd: Date): Date[] {
  if (payout.daysOfMonth.length === 0) return []
  const start = new Date(payout.startDate)
  const end = payout.endDate ? new Date(payout.endDate) : null
  const dates: Date[] = []

  let cursor = new Date(periodStart.getFullYear(), periodStart.getMonth(), 1)
  const lastMonth = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1)
  while (cursor <= lastMonth) {
    const year = cursor.getFullYear()
    const month = cursor.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    for (const day of payout.daysOfMonth) {
      const clampedDay = Math.min(day, daysInMonth)
      const due = new Date(year, month, clampedDay)
      if (due < start) continue
      if (end && due > end) continue
      if (due < periodStart || due > periodEnd) continue
      dates.push(due)
    }
    cursor = new Date(year, month + 1, 1)
  }
  return dates.sort((a, b) => a.getTime() - b.getTime())
}
