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
  SmmPublicationPlatform, SmmPublicationStatus, SmmMetricType, SmmMetricSource,
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
