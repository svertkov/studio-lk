// Единый сервисный слой раздела «Монтаж» — по тому же принципу, что
// order-model.ts для заказов: статус-конфиг/лейблы, расчёт прибыли, дедлайна,
// просрочки и причин «Требует внимания» живут здесь ОДИН раз и переиспользуются
// дашбордом, таблицей проектов, карточкой проекта, карточкой монтажёра и
// карточкой клиента — а не копируются по компонентам (см. AGENTS.md, п.4).

import type {
  MontageStatus, MontageClientPaymentStatus, MontageEditorPaymentStatus, MontageDeadlineType,
  MontageContentType, MontageTurnaroundDayType, OrderStatus,
} from '@prisma/client'
import { monthKey } from '@/lib/order-model'

export type {
  MontageStatus, MontageClientPaymentStatus, MontageEditorPaymentStatus, MontageDeadlineType,
  MontageContentType, MontageTurnaroundDayType,
}

// ============================================================
// СТАТУСЫ ПРОЕКТА МОНТАЖА — единственный источник лейбла/порядка/цвета,
// тот же принцип, что ORDER_STATUS_CONFIG (order-model.ts). Цвет здесь —
// готовый Tailwind-класс (text-*), а не CSS-токен: раздел "Монтаж" не
// использует drag&drop-канбан с glow-колонками, как CRM, только таблицу и
// компактные статус-плашки — усложнять до уровня ORDER_STATUS_CONFIG незачем.
//
// 5 понятных производственных этапов + CANCELLED (терминальный, не входит в
// MONTAGE_STATUS_ORDER — см. ниже) — сокращено с 14 значений (см. комментарий
// у enum MontageStatus в schema.prisma). Пауза и архив — больше НЕ статусы,
// это overlay-поля isPaused/isArchived поверх текущего status (см. Order.isArchived
// за тем же принципом) — их состояние не показывается через эту конфигурацию,
// а отдельными плашками в UI (MontageProjectsTable.tsx/MontageProjectModal.tsx).
// ============================================================

export interface MontageStatusConfig {
  label: string
  order: number
  color: string
}

const MONTAGE_STATUS_CONFIG: Record<MontageStatus, MontageStatusConfig> = {
  NEW:         { label: 'Новый',           order: 1, color: 'text-blue-400' },
  IN_PROGRESS: { label: 'В работе',        order: 2, color: 'text-cyan-400' },
  IN_REVIEW:   { label: 'На согласовании', order: 3, color: 'text-violet-400' },
  REVISIONS:   { label: 'Правки',          order: 4, color: 'text-amber-400' },
  DELIVERED:   { label: 'Сдан',            order: 5, color: 'text-green-500' },
  // Терминальный, вне основного производственного цикла — свой нейтральный
  // цвет, чтобы визуально не путаться с обычными этапами выше.
  CANCELLED:   { label: 'Отменён',         order: 99, color: 'text-red-400' },
}

export function getMontageStatusConfig(status: MontageStatus): MontageStatusConfig {
  return MONTAGE_STATUS_CONFIG[status]
}

export const MONTAGE_STATUS_LABELS: Record<MontageStatus, string> = Object.fromEntries(
  (Object.keys(MONTAGE_STATUS_CONFIG) as MontageStatus[]).map(s => [s, MONTAGE_STATUS_CONFIG[s].label]),
) as Record<MontageStatus, string>

// Основной выпадающий список карточки/фильтров — ТОЛЬКО 5 производственных
// этапов, без CANCELLED (тот устанавливается исключительно действием
// "Отменить проект", см. cancelMontageProject в actions/montage.ts).
export const MONTAGE_STATUS_ORDER: MontageStatus[] = ['NEW', 'IN_PROGRESS', 'IN_REVIEW', 'REVISIONS', 'DELIVERED']

// Статусы, которые считаются "активной работой" (для KPI "В работе" на
// дашборде и фильтра "Активные проекты" в карточке клиента/монтажёра).
export const MONTAGE_ACTIVE_STATUSES: MontageStatus[] = ['IN_PROGRESS', 'IN_REVIEW', 'REVISIONS']

// Статусы, которые считаются "смонтировано" (KPI "Смонтировано проектов" на
// дашборде, п.10 ТЗ) — только реально сданные клиенту.
export const MONTAGE_DELIVERED_STATUSES: MontageStatus[] = ['DELIVERED']

export const MONTAGE_CLIENT_PAYMENT_STATUS_LABELS: Record<MontageClientPaymentStatus, string> = {
  NOT_SPECIFIED:  'Не указана',
  PENDING:        'Ожидается',
  PARTIALLY_PAID: 'Частично оплачено',
  PAID:           'Оплачено',
  CANCELLED:      'Отменено',
  NOT_REQUIRED:   'Не требуется',
}

export const MONTAGE_EDITOR_PAYMENT_STATUS_LABELS: Record<MontageEditorPaymentStatus, string> = {
  NOT_CALCULATED: 'Не рассчитана',
  PENDING:        'Ожидает выплаты',
  PARTIALLY_PAID: 'Частично выплачено',
  PAID:           'Выплачено',
  NOT_REQUIRED:   'Не требуется',
}

// ============================================================
// ТИП КОНТЕНТА — структурированная категория вместо свободного текста (ТЗ
// "Сделать «Тип контента» выпадающим списком"). OTHER — единственное
// значение, для которого показывается customContentType (см. схему).
// ============================================================

export const MONTAGE_CONTENT_TYPE_ORDER: MontageContentType[] = [
  'PODCAST', 'SHORT_FORM', 'TALKING_HEAD', 'MOTION_DESIGN', 'PRESENTATION', 'OTHER',
]

export const MONTAGE_CONTENT_TYPE_LABELS: Record<MontageContentType, string> = {
  PODCAST:       'Подкаст',
  SHORT_FORM:    'Рилс / короткие ролики',
  TALKING_HEAD:  'Говорящая голова',
  MOTION_DESIGN: 'Motion design',
  PRESENTATION:  'Презентация / корпоративное видео',
  OTHER:         'Прочее',
}

// Ключевые слова для автоматической классификации исторических/импортированных
// проектов по названию (ТЗ п.7) — ПОРЯДОК ВАЖЕН: правила проверяются по
// очереди, побеждает первое совпадение. PRESENTATION проверяется раньше
// MOTION_DESIGN, потому что "моушен-презентация"/"моушен-дизайн презентации"
// по прямому примеру ТЗ должны попасть в "Презентация", а не в "Motion
// design" — иначе общее слово "моушен" забрало бы их себе первым. Аналогично
// SHORT_FORM проверяется раньше PODCAST: "Два рилса по подкасту" — это
// проект-рилс (по формату сдачи), а не подкаст, хотя оба слова есть в тексте.
// \b НЕ работает как ожидается вокруг кириллицы в JS (без /u \w значит только
// [A-Za-z0-9_], поэтому любая кириллическая буква для \b — "не-словесный"
// символ, и \bгг\b тихо никогда не совпадает) — обнаружено на реальных
// исторических данных ("Монтаж ГГ от 03.11.2025" уходил в OTHER вместо
// TALKING_HEAD). Вместо \b — явные lookaround по кириллическому классу букв.
const CYR_LETTER = 'а-яё'
const CONTENT_TYPE_RULES: { type: MontageContentType; pattern: RegExp }[] = [
  { type: 'PRESENTATION',  pattern: /презентац|мастер.?класс|корпоратив|промо(?:ролик|видео|материал)/i },
  { type: 'TALKING_HEAD',  pattern: new RegExp(`говорящ|видеовизит|(?<![${CYR_LETTER}])гг(?![${CYR_LETTER}])`, 'i') },
  { type: 'SHORT_FORM',    pattern: new RegExp(`рилс|шортс|short|нарезк|(?<![${CYR_LETTER}])клип`, 'i') },
  { type: 'MOTION_DESIGN', pattern: /моушен|motion|анимаци|джингл|график/i },
  { type: 'PODCAST',       pattern: /подкаст|интервью/i },
]

export interface MontageContentTypeClassification {
  contentType: MontageContentType
  // Заполнен только для OTHER — исходный текст никогда не теряется (ТЗ:
  // "Не терять исходное описание проекта"), даже когда классификация
  // неуверенная. Для остальных категорий null: сам title/description уже
  // хранит оригинальный текст отдельно, дублировать его в customContentType
  // незачем (AGENTS.md — не дублировать данные ради одного экрана).
  customContentType: string | null
}

// Классифицирует ОДИН свободный текст (обычно title проекта) в структурированную
// категорию. Неоднозначные/нераспознанные значения сознательно уходят в OTHER
// с сохранением исходного текста, а не угадываются "по смыслу" — угадывание
// закрытого enum из свободного текста менее предсказуемо, чем явное "Прочее".
export function classifyMontageContentType(text: string): MontageContentTypeClassification {
  const trimmed = text.trim()
  for (const rule of CONTENT_TYPE_RULES) {
    if (rule.pattern.test(trimmed)) return { contentType: rule.type, customContentType: null }
  }
  return { contentType: 'OTHER', customContentType: trimmed || null }
}

// ============================================================
// ФИНАНСЫ — единая формула прибыли, чтобы дашборд/таблица/карточка
// монтажёра/карточка проекта никогда не считали её по-разному (ТЗ п.2).
// null — прибыль не может быть достоверно посчитана (одна из сумм неизвестна),
// это НЕ то же самое, что 0 — "Нет данных" в UI должно отличаться от "0 ₽".
// ============================================================

export function computeMontageProfit(clientAmount: number | null, editorAmount: number | null): number | null {
  if (clientAmount == null || editorAmount == null) return null
  return clientAmount - editorAmount
}

export function computeMontageMargin(clientAmount: number | null, editorAmount: number | null): number | null {
  const profit = computeMontageProfit(clientAmount, editorAmount)
  if (profit == null || clientAmount == null || clientAmount === 0) return null
  return profit / clientAmount
}

// ============================================================
// ДЕДЛАЙН — вычисляется ОДИН раз при сохранении карточки (см.
// src/lib/actions/montage.ts) и хранится готовым значением в
// MontageProject.deadlineDate, эта функция — единственное место, где решается
// "какая дата дедлайна", дальше везде читается уже готовое поле.
//
// Календарные ИЛИ рабочие дни (turnaroundDayType) — рабочие пропускают
// субботу/воскресенье. Праздники намеренно не учитываются: в проекте нет
// календаря праздников, а заводить его ради одного поля было бы преждевременным
// усложнением (тот же принцип "не добавлять то, что не просили" — праздники
// никто не просил).
// ============================================================

export interface MontageDeadlineInput {
  sourceReceivedAt: string | Date | null
  deadlineType: MontageDeadlineType | null
  deadlineDate: string | Date | null | undefined
  turnaroundDays: number | null | undefined
  turnaroundDayType?: MontageTurnaroundDayType | null
}

// Добавляет N рабочих дней (пропуская сб/вс) к дате — суббота/воскресенье
// самой даты начала НЕ считаются днём отсчёта (первый рабочий день считается
// от следующего дня после старта, тот же принцип "через N дней", что и у
// календарного варианта).
function addBusinessDays(start: Date, days: number): Date {
  const d = new Date(start)
  let added = 0
  while (added < days) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay() // 0 = вс, 6 = сб
    if (dow !== 0 && dow !== 6) added += 1
  }
  return d
}

export function computeMontageDeadline(input: MontageDeadlineInput): Date | null {
  if (input.deadlineType === 'FIXED_DATE') {
    return input.deadlineDate ? new Date(input.deadlineDate) : null
  }
  if (input.deadlineType === 'DURATION_DAYS') {
    if (!input.sourceReceivedAt || input.turnaroundDays == null) return null
    if (input.turnaroundDayType === 'BUSINESS') {
      return addBusinessDays(new Date(input.sourceReceivedAt), input.turnaroundDays)
    }
    const d = new Date(input.sourceReceivedAt)
    d.setDate(d.getDate() + input.turnaroundDays)
    return d
  }
  return null
}

function pluralizeDays(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'день'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дня'
  return 'дней'
}

// Статусы, для которых просрочка/обратный отсчёт больше не имеют смысла —
// проект либо уже сдан, либо снят с производства (ТЗ п.20: просрочен, если
// deadlineDate < now И статус не «Сдан»/«Отменён»). Архив проверяется отдельным
// полем isArchived (см. ниже) — это больше не значение статуса.
const MONTAGE_DEADLINE_INACTIVE_STATUSES: MontageStatus[] = ['DELIVERED', 'CANCELLED']

export interface MontageDeadlineStateInput {
  deadlineDate: string | Date | null
  status: MontageStatus
  deliveredAt: string | Date | null
  // Архивный проект не в производстве — просрочка/обратный отсчёт для него
  // так же не имеет смысла, как и для CANCELLED (см. MontageProject.isArchived
  // в схеме, тот же overlay-принцип, что Order.isArchived). Необязателен —
  // старые вызовы без этого поля продолжают работать как раньше (undefined
  // трактуется как false), это не меняет поведение везде, где isArchived
  // ещё не подключён.
  isArchived?: boolean
}

// Разница в календарных днях (не часах) между двумя датами — дедлайн это
// дата, а не момент времени, поэтому "Дедлайн сегодня" должен срабатывать
// весь день, а не только если текущее время раньше конкретного часа дедлайна.
function calendarDaysBetween(a: Date, b: Date): number {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((utcA - utcB) / 86_400_000)
}

export function isMontageOverdue(project: MontageDeadlineStateInput, now: Date = new Date()): boolean {
  if (!project.deadlineDate) return false
  if (project.isArchived) return false
  if (MONTAGE_DEADLINE_INACTIVE_STATUSES.includes(project.status)) return false
  return calendarDaysBetween(new Date(project.deadlineDate), now) < 0
}

// Готовая строка для колонки "Дедлайн" (ТЗ п.14/20): "Осталось N дней" /
// "Дедлайн сегодня" / "Просрочено на N дней" / "Сдано вовремя" / "Сдано с
// опозданием на N дней" — единственное место, формирующее этот текст.
export function montageDeadlineLabel(project: MontageDeadlineStateInput, now: Date = new Date()): string | null {
  if (!project.deadlineDate) return null
  const deadline = new Date(project.deadlineDate)

  if (project.status === 'DELIVERED' && project.deliveredAt) {
    const delivered = new Date(project.deliveredAt)
    const diffDays = calendarDaysBetween(delivered, deadline)
    if (diffDays < 0) return `Сдан на ${Math.abs(diffDays)} ${pluralizeDays(Math.abs(diffDays))} раньше`
    if (diffDays === 0) return 'Сдано вовремя'
    return `Сдано с опозданием на ${diffDays} ${pluralizeDays(diffDays)}`
  }
  if (project.isArchived || MONTAGE_DEADLINE_INACTIVE_STATUSES.includes(project.status)) return null

  const diffDays = calendarDaysBetween(deadline, now)
  if (diffDays < 0) return `Просрочено на ${Math.abs(diffDays)} ${pluralizeDays(Math.abs(diffDays))}`
  if (diffDays === 0) return 'Дедлайн сегодня'
  return `Осталось ${diffDays} ${pluralizeDays(diffDays)}`
}

// ============================================================
// МАТЕРИАЛЫ — исходники и NAS, не дублируем существующие поля ScheduleEvent
// (см. схему: MontageProject.sourceMaterialsUrl — только переопределение).
// ============================================================

// Эффективная ссылка на исходники: собственное поле проекта побеждает, если
// задано (нужно для самостоятельных проектов или когда монтажёру передали
// другую ссылку, отличную от исходной съёмочной), иначе — ссылка со связанного
// заказа (order.yandexDiskUrl из OrderDTO), иначе — ничего.
export function getMontageSourceMaterialsUrl(
  project: { sourceMaterialsUrl: string | null },
  orderYandexDiskUrl: string | null,
): string | null {
  return project.sourceMaterialsUrl ?? orderYandexDiskUrl ?? null
}

// Архивировать можно только проект, уже покинувший производственный цикл —
// та же граница, что actions/montage.ts проверяет на сервере перед
// archiveMontageProject; экспортирована отсюда (а не задана заново в
// actions/montage.ts или в карточке), чтобы кнопка "Отправить в архив" в
// MontageProjectModal.tsx показывалась по ТОЙ ЖЕ границе, что реально
// разрешает сервер, а не по второй, случайно рассинхронизированной копии
// (AGENTS.md, п.4). 'use server'-файлы не могут экспортировать константы —
// поэтому общий источник живёт здесь, а не в actions/montage.ts.
export const MONTAGE_ARCHIVABLE_STATUSES: MontageStatus[] = ['DELIVERED', 'CANCELLED']

// ============================================================
// КОНТРОЛЬ МАТЕРИАЛОВ НА NAS (ТЗ "точечно доработать контроль материалов в
// таблице проектов") — два НЕЗАВИСИМЫХ NAS-поля на MontageProject:
// sourceMaterialsNasUrl (исходники) и mountedMaterialNasUrl (готовый монтаж,
// уже существовал). Это НЕ то же самое, что sourceMaterialsUrl/
// getMontageSourceMaterialsUrl выше — та пара отвечает на вопрос "чем сейчас
// пользуется монтажёр" (обычно временная ссылка на Яндекс.Диск), а эта — на
// более строгий вопрос "сохранено ли на постоянное хранение NAS" (ТЗ: "не
// считать ссылку на Яндекс.Диск заменой обязательному хранению на NAS").
//
// Контроль действует только для проектов, поступивших в монтаж НЕ РАНЕЕ
// MONTAGE_MATERIALS_TRACKING_START_DATE — единственная константа даты во всём
// приложении, компоненты её не дублируют.
// ============================================================

export const MONTAGE_MATERIALS_TRACKING_START_DATE = new Date('2026-07-08T00:00:00.000Z')

// На каких статусах какая ссылка обязательна (ТЗ п.5) — намеренно РАЗНЫЕ
// списки: на "В работе" исходники уже обязаны быть, а готовый материал ещё
// нет (монтаж только начался); "Новый" не входит ни в один список — контроль
// для него ещё не наступил вовсе, это не то же самое, что "материалы есть".
export const MONTAGE_SOURCE_NAS_REQUIRED_STATUSES: MontageStatus[] = ['IN_PROGRESS', 'IN_REVIEW', 'REVISIONS', 'DELIVERED']
export const MONTAGE_FINAL_NAS_REQUIRED_STATUSES: MontageStatus[] = ['IN_REVIEW', 'REVISIONS', 'DELIVERED']

export type MontageMaterialsState = 'COMPLETE' | 'PARTIAL' | 'MISSING' | 'NOT_TRACKED'

// Порядок для фильтра в таблице проектов (ТЗ п.10) — "Все" добавляется самим
// select'ом в компоненте, здесь только реальные значения состояния.
export const MONTAGE_MATERIALS_STATE_ORDER: MontageMaterialsState[] = ['COMPLETE', 'PARTIAL', 'MISSING', 'NOT_TRACKED']

export const MONTAGE_MATERIALS_STATE_LABELS: Record<MontageMaterialsState, string> = {
  COMPLETE:    'Всё заполнено',
  PARTIAL:     'Заполнено частично',
  MISSING:     'Материалы отсутствуют',
  NOT_TRACKED: 'Контроль не применяется',
}

export interface MontageMaterialsStateInput {
  status: MontageStatus
  sourceReceivedAt: string | Date | null
  sourceMaterialsNasUrl: string | null
  mountedMaterialNasUrl: string | null
  isArchived: boolean
}

export interface MontageMaterialsMissingFields {
  missingSource: boolean
  missingFinal: boolean
}

// Какая из двух ссылок отсутствует, ТОЛЬКО среди обязательных на данном
// статусе (не гейтится датой/архивом/отменой — вызывающая сторона уже знает
// это через getMontageMaterialsState и обычно проверяет missing-* только
// когда состояние PARTIAL/MISSING).
export function getMontageMaterialsMissingFields(
  project: Pick<MontageMaterialsStateInput, 'status' | 'sourceMaterialsNasUrl' | 'mountedMaterialNasUrl'>,
): MontageMaterialsMissingFields {
  const sourceRequired = MONTAGE_SOURCE_NAS_REQUIRED_STATUSES.includes(project.status)
  const finalRequired = MONTAGE_FINAL_NAS_REQUIRED_STATUSES.includes(project.status)
  return {
    missingSource: sourceRequired && !project.sourceMaterialsNasUrl,
    missingFinal: finalRequired && !project.mountedMaterialNasUrl,
  }
}

// Единственное место, решающее COMPLETE/PARTIAL/MISSING/NOT_TRACKED — таблица,
// карточка, "Требует внимания", аналитика и фильтр читают ТОЛЬКО этот
// результат, не пересчитывают условие сами (ТЗ п.4: "не дублируй условную
// логику в нескольких компонентах").
export function getMontageMaterialsState(project: MontageMaterialsStateInput): MontageMaterialsState {
  if (project.status === 'CANCELLED' || project.isArchived) return 'NOT_TRACKED'
  if (!project.sourceReceivedAt) return 'NOT_TRACKED'
  if (new Date(project.sourceReceivedAt) < MONTAGE_MATERIALS_TRACKING_START_DATE) return 'NOT_TRACKED'

  const sourceRequired = MONTAGE_SOURCE_NAS_REQUIRED_STATUSES.includes(project.status)
  const finalRequired = MONTAGE_FINAL_NAS_REQUIRED_STATUSES.includes(project.status)
  // "Новый" — ни одна ссылка ещё не обязательна, это не проблема (ТЗ: "для
  // статуса «Новый» отсутствие готового материала ещё не является проблемой").
  if (!sourceRequired && !finalRequired) return 'COMPLETE'

  const { missingSource, missingFinal } = getMontageMaterialsMissingFields(project)
  const requiredCount = (sourceRequired ? 1 : 0) + (finalRequired ? 1 : 0)
  const missingCount = (missingSource ? 1 : 0) + (missingFinal ? 1 : 0)

  if (missingCount === 0) return 'COMPLETE'
  if (missingCount === requiredCount) return 'MISSING'
  return 'PARTIAL'
}

// ============================================================
// «ТРЕБУЮТ ВНИМАНИЯ» (ТЗ п.10/12) — единый источник причин для KPI-карточки
// дашборда и её раскрытия; та же функция должна фильтровать список за карточкой,
// чтобы счётчик и список никогда не расходились.
// ============================================================

export type MontageAttentionReason =
  | 'NO_EDITOR' | 'OVERDUE' | 'NO_SOURCE' | 'PAYMENT_UNDEFINED' | 'INCOMPLETE_CARD'
  | 'NO_CLIENT_LINK' | 'NO_DEADLINE' | 'NO_SOURCE_NAS' | 'NO_FINAL_NAS' | 'MATERIALS_MISSING'

export const MONTAGE_ATTENTION_LABELS: Record<MontageAttentionReason, string> = {
  NO_EDITOR:              'Без монтажёра',
  OVERDUE:                'Просрочен дедлайн',
  NO_SOURCE:               'Нет исходников',
  PAYMENT_UNDEFINED:       'Оплата не определена',
  INCOMPLETE_CARD:         'Незаполненная карточка',
  NO_CLIENT_LINK:          'Клиент не привязан',
  NO_DEADLINE:             'Не задан дедлайн',
  NO_SOURCE_NAS:           'Нет исходников на NAS',
  NO_FINAL_NAS:            'Нет готового материала на NAS',
  MATERIALS_MISSING:       'Материалы полностью отсутствуют',
}

export interface MontageAttentionInput {
  status: MontageStatus
  editorId: string | null
  deadlineDate: string | Date | null
  deliveredAt: string | Date | null
  // Уже РЕЗОЛВЛЕННАЯ ссылка на исходники (см. getMontageSourceMaterialsUrl) —
  // эта функция не знает про Order/ScheduleEvent, только про готовое значение.
  // Отдельный, более мягкий вопрос "есть ли ХОТЬ КАКАЯ-ТО рабочая ссылка"
  // (обычно Яндекс.Диск) — НЕ то же самое, что контроль NAS ниже.
  effectiveSourceMaterialsUrl: string | null
  // Контроль материалов на NAS (см. getMontageMaterialsState выше) — два
  // независимых NAS-поля + дата поступления, обязательность зависит от статуса.
  sourceReceivedAt: string | Date | null
  sourceMaterialsNasUrl: string | null
  mountedMaterialNasUrl: string | null
  clientAmount: number | null
  clientPaymentStatus: MontageClientPaymentStatus
  title: string | null
  description: string | null
  // true, если у проекта нет НИ заказа, НИ реального Client (только сырое имя
  // из импорта, см. MontageProject.clientName в схеме) — строки, которые
  // администратор осознанно попросил завести без привязки при историческом
  // импорте (scripts/import-montage-projects), с меткой "!" на довязку позже.
  hasNoClientLink: boolean
  // true — проект создан историческим импортом (MontageProject.importSource
  // задан), а не через саму платформу. Старая Google-таблица никогда не
  // фиксировала отдельную ссылку на исходники почти для никаких проектов
  // (см. отчёт dry-run: 17 из 76 с исходниками) — без этого флага почти все
  // 76 исторических проектов сразу попадали бы в «Требуют внимания» из-за
  // NO_SOURCE, что превращает список из "текущих проблем, требующих действия"
  // в бесполезный "почти весь архив". Контроль NAS (NO_SOURCE_NAS/NO_FINAL_NAS/
  // MATERIALS_MISSING, см. getMontageMaterialsState) этим флагом НЕ гейтится —
  // у него своя, более точная защита от старых данных: дата поступления
  // (MONTAGE_MATERIALS_TRACKING_START_DATE), все 76 исторических проектов
  // поступили задолго до неё и автоматически получают NOT_TRACKED. Остальные
  // причины (нет клиента, нет монтажёра, просрочка, неопределённая оплата,
  // пустая карточка) по-прежнему применяются и к историческим записям — они
  // остаются реально значимыми независимо от источника данных.
  isHistoricalImport: boolean
  // Архивный проект (см. MontageProject.isArchived) полностью выведен из
  // оперативной работы — тот же смысл, что и раньше был у статуса ARCHIVED,
  // но теперь это отдельное overlay-поле, а не значение status (см. схему).
  isArchived: boolean
}

// NEW покрывает и то, что раньше было NEEDS_INFO/AWAITING_SOURCE — этап "ещё
// не начали", для которого рано ругаться на отсутствие монтажёра/исходников/
// дедлайна (это ожидаемо для только что созданной карточки, не проблема).
const MONTAGE_ATTENTION_EXEMPT_STATUSES: MontageStatus[] = ['CANCELLED', 'NEW']

export function getMontageAttentionReasons(project: MontageAttentionInput, now: Date = new Date()): MontageAttentionReason[] {
  if (project.status === 'CANCELLED' || project.isArchived) return []
  const reasons: MontageAttentionReason[] = []

  if (project.hasNoClientLink) reasons.push('NO_CLIENT_LINK')
  if (!project.editorId && !MONTAGE_ATTENTION_EXEMPT_STATUSES.includes(project.status)) reasons.push('NO_EDITOR')
  if (isMontageOverdue({
    deadlineDate: project.deadlineDate, status: project.status, deliveredAt: project.deliveredAt, isArchived: project.isArchived,
  }, now)) {
    reasons.push('OVERDUE')
  }
  if (!project.isHistoricalImport) {
    if (!project.effectiveSourceMaterialsUrl && !MONTAGE_ATTENTION_EXEMPT_STATUSES.includes(project.status)) reasons.push('NO_SOURCE')
    if (!project.deadlineDate && !MONTAGE_ATTENTION_EXEMPT_STATUSES.includes(project.status)) reasons.push('NO_DEADLINE')
  }
  if (project.clientAmount != null && project.clientPaymentStatus === 'NOT_SPECIFIED') reasons.push('PAYMENT_UNDEFINED')
  if (!project.title && !project.description) reasons.push('INCOMPLETE_CARD')

  // Контроль материалов на NAS — своя, более точная защита от старых данных
  // (дата поступления), поэтому НЕ внутри isHistoricalImport-блока выше (см.
  // комментарий у MontageAttentionInput.isHistoricalImport). Ровно одна
  // причина на проект (ТЗ п.9: "не создавать дубли предупреждений") —
  // MATERIALS_MISSING заменяет собой NO_SOURCE_NAS+NO_FINAL_NAS, когда
  // отсутствуют обе обязательные ссылки разом.
  const materialsState = getMontageMaterialsState({
    status: project.status, sourceReceivedAt: project.sourceReceivedAt,
    sourceMaterialsNasUrl: project.sourceMaterialsNasUrl, mountedMaterialNasUrl: project.mountedMaterialNasUrl,
    isArchived: project.isArchived,
  })
  if (materialsState === 'MISSING') {
    reasons.push('MATERIALS_MISSING')
  } else if (materialsState === 'PARTIAL') {
    const { missingSource, missingFinal } = getMontageMaterialsMissingFields(project)
    if (missingSource) reasons.push('NO_SOURCE_NAS')
    else if (missingFinal) reasons.push('NO_FINAL_NAS')
  }

  return reasons
}

// ============================================================
// СВЯЗЬ СО СТАТУСОМ ЗАКАЗА (CRM) — ТЗ п.23: "может коррелировать", НЕ жёстко
// связаны, без циклов. Однонаправленно: смена статуса ПРОЕКТА МОНТАЖА может
// подвинуть статус ЗАКАЗА вперёд по воронке; обратного маппинга нет — смена
// статуса заказа (ручной канбан CRM) никогда не переписывает статус проекта
// монтажа, поэтому цикл в принципе невозможен. Возвращает null, если менять
// ничего не нужно (заказ уже не в «Монтаж»/«Правки» — значит, продвинут
// вручную дальше, автоматика его больше не трогает — тот же принцип, что и
// автопереход editingRequired в src/lib/actions/schedule.ts).
// ============================================================

export function mapMontageStatusToOrderStatus(
  montageStatus: MontageStatus, currentOrderStatus: OrderStatus,
): OrderStatus | null {
  if (currentOrderStatus !== 'EDITING' && currentOrderStatus !== 'REVISIONS') return null
  if (montageStatus === 'REVISIONS' && currentOrderStatus !== 'REVISIONS') {
    return 'REVISIONS'
  }
  if (montageStatus === 'DELIVERED') return 'COMPLETED'
  return null
}

// ============================================================
// ДАШБОРД (ТЗ п.10) — KPI считаются ОДИН раз здесь из полного списка
// проектов, а не отдельно в каждой карточке/детальном экране (п.32: "не
// создавай montageDashboardCopy/editorIncomeCopy... все показатели
// рассчитываются из проектов"). Раскрытие каждого KPI (п.12) должно
// фильтровать тот же список этими же предикатами, а не считать заново.
// ============================================================

export interface MontageStatsInput {
  status: MontageStatus
  sourceReceivedAt: string | Date | null
  clientAmount: number | null
  editorAmount: number | null
  clientPaymentStatus: MontageClientPaymentStatus
  editorPaymentStatus: MontageEditorPaymentStatus
  editorId: string | null
  deadlineDate: string | Date | null
  deliveredAt: string | Date | null
  effectiveSourceMaterialsUrl: string | null
  sourceMaterialsNasUrl: string | null
  mountedMaterialNasUrl: string | null
  title: string | null
  description: string | null
  hasNoClientLink: boolean
  isHistoricalImport: boolean
  isArchived: boolean
}

export interface MontageDashboardStats {
  deliveredCount: number
  // ISO-дата самого раннего sourceReceivedAt среди ВСЕХ проектов — "отчётность
  // с..." (ТЗ п.10) вычисляется от реальных данных после импорта, не задаётся
  // вручную. null, если проектов с известной датой поступления ещё нет.
  reportingSince: string | null
  revenueTotal: number
  revenuePaid: number
  expensesTotal: number
  expensesPaid: number
  profit: number
  margin: number | null
  activeCount: number
  attentionCount: number
  clientDebt: number
  studioDebt: number
}

// PARTIALLY_PAID считается "в долгу" целиком (а не остатком) — в схеме
// сознательно нет отдельного поля "сколько уже оплачено частично" (ТЗ не
// запрашивал его, только статус), тот же компромисс уже принят в проекте для
// Order.paymentStatus = PARTIALLY_PAID (тоже без отдельной суммы остатка).
const DEBT_CLIENT_STATUSES: MontageClientPaymentStatus[] = ['PENDING', 'PARTIALLY_PAID']
const DEBT_EDITOR_STATUSES: MontageEditorPaymentStatus[] = ['PENDING', 'PARTIALLY_PAID']

export function computeMontageDashboardStats(projects: MontageStatsInput[], now: Date = new Date()): MontageDashboardStats {
  let deliveredCount = 0
  let reportingSince: string | null = null
  let revenueTotal = 0, revenuePaid = 0
  let expensesTotal = 0, expensesPaid = 0
  let activeCount = 0, attentionCount = 0
  let clientDebt = 0, studioDebt = 0

  for (const p of projects) {
    if (MONTAGE_DELIVERED_STATUSES.includes(p.status)) deliveredCount += 1

    if (p.sourceReceivedAt) {
      const iso = new Date(p.sourceReceivedAt).toISOString()
      if (!reportingSince || iso < reportingSince) reportingSince = iso
    }

    if (p.clientAmount != null) {
      revenueTotal += p.clientAmount
      if (p.clientPaymentStatus === 'PAID') revenuePaid += p.clientAmount
      if (DEBT_CLIENT_STATUSES.includes(p.clientPaymentStatus)) clientDebt += p.clientAmount
    }
    if (p.editorAmount != null) {
      expensesTotal += p.editorAmount
      if (p.editorPaymentStatus === 'PAID') expensesPaid += p.editorAmount
      if (DEBT_EDITOR_STATUSES.includes(p.editorPaymentStatus)) studioDebt += p.editorAmount
    }

    if (MONTAGE_ACTIVE_STATUSES.includes(p.status)) activeCount += 1

    const attention = getMontageAttentionReasons({
      status: p.status, editorId: p.editorId, deadlineDate: p.deadlineDate, deliveredAt: p.deliveredAt,
      effectiveSourceMaterialsUrl: p.effectiveSourceMaterialsUrl, mountedMaterialNasUrl: p.mountedMaterialNasUrl,
      sourceReceivedAt: p.sourceReceivedAt, sourceMaterialsNasUrl: p.sourceMaterialsNasUrl,
      clientAmount: p.clientAmount, clientPaymentStatus: p.clientPaymentStatus, title: p.title, description: p.description,
      hasNoClientLink: p.hasNoClientLink, isHistoricalImport: p.isHistoricalImport, isArchived: p.isArchived,
    }, now)
    if (attention.length > 0) attentionCount += 1
  }

  const profit = revenueTotal - expensesTotal
  const margin = revenueTotal > 0 ? profit / revenueTotal : null

  return {
    deliveredCount, reportingSince, revenueTotal, revenuePaid, expensesTotal, expensesPaid,
    profit, margin, activeCount, attentionCount, clientDebt, studioDebt,
  }
}

// ============================================================
// КАРТОЧКА МОНТАЖЁРА (ТЗ п.9) — "верхние показатели" за всё время и
// помесячная аналитика считаются одними и теми же чистыми функциями из
// списка проектов ЭТОГО монтажёра (см. getMontageProjectsForEditor,
// actions/montage.ts) — тот же принцип единого источника, что и
// computeMontageDashboardStats для общего дашборда.
// ============================================================

export interface EditorProjectStatsInput {
  status: MontageStatus
  clientAmount: number | null
  editorAmount: number | null
  editorPaymentStatus: MontageEditorPaymentStatus
  sourceReceivedAt: string | Date | null
  deliveredAt: string | Date | null
  deadlineDate: string | Date | null
}

export interface EditorAllTimeSummary {
  totalProjects: number
  deliveredProjects: number
  activeProjects: number
  // Начислено монтажёру (сумма editorAmount по всем его проектам, независимо
  // от статуса оплаты) — "заработал" в ТЗ понимается как объём выполненной
  // работы, факт выплаты отражён отдельно (paidEarned).
  totalEarned: number
  paidEarned: number
  studioProfit: number
  avgProjectAmount: number | null
  avgTurnaroundDays: number | null
}

function averageTurnaroundDays(projects: Pick<EditorProjectStatsInput, 'sourceReceivedAt' | 'deliveredAt'>[]): number | null {
  const durations = projects
    .filter(p => p.sourceReceivedAt && p.deliveredAt)
    .map(p => (new Date(p.deliveredAt!).getTime() - new Date(p.sourceReceivedAt!).getTime()) / 86_400_000)
  if (durations.length === 0) return null
  return durations.reduce((sum, d) => sum + d, 0) / durations.length
}

export function computeEditorAllTimeSummary(projects: EditorProjectStatsInput[]): EditorAllTimeSummary {
  let deliveredProjects = 0, activeProjects = 0
  let totalEarned = 0, paidEarned = 0, studioProfit = 0
  let amountsKnownCount = 0

  for (const p of projects) {
    if (MONTAGE_DELIVERED_STATUSES.includes(p.status)) deliveredProjects += 1
    if (MONTAGE_ACTIVE_STATUSES.includes(p.status)) activeProjects += 1
    if (p.editorAmount != null) {
      totalEarned += p.editorAmount
      amountsKnownCount += 1
      if (p.editorPaymentStatus === 'PAID') paidEarned += p.editorAmount
    }
    const profit = computeMontageProfit(p.clientAmount, p.editorAmount)
    if (profit != null) studioProfit += profit
  }

  return {
    totalProjects: projects.length,
    deliveredProjects,
    activeProjects,
    totalEarned,
    paidEarned,
    studioProfit,
    avgProjectAmount: amountsKnownCount > 0 ? totalEarned / amountsKnownCount : null,
    avgTurnaroundDays: averageTurnaroundDays(projects),
  }
}

export interface EditorMonthlyStats {
  projectsCount: number
  editorEarned: number
  clientRevenue: number
  studioProfit: number
  deliveredCount: number
  activeCount: number
  avgTurnaroundDays: number | null
  overdueCount: number
}

// monthKey — "YYYY-MM" по sourceReceivedAt проекта (та же дата, что и везде
// в разделе "Монтаж" считается "поступлением в работу"). Проекты без
// sourceReceivedAt не попадают ни в один месяц — как и заказы без даты не
// попадают в группировку по месяцам в order-model.ts.
export function computeEditorMonthlyStats(projects: EditorProjectStatsInput[], selectedMonthKey: string, now: Date = new Date()): EditorMonthlyStats {
  const inMonth = projects.filter(p => p.sourceReceivedAt && monthKey(new Date(p.sourceReceivedAt)) === selectedMonthKey)

  let editorEarned = 0, clientRevenue = 0, studioProfit = 0
  let deliveredCount = 0, activeCount = 0, overdueCount = 0

  for (const p of inMonth) {
    if (p.editorAmount != null) editorEarned += p.editorAmount
    if (p.clientAmount != null) clientRevenue += p.clientAmount
    const profit = computeMontageProfit(p.clientAmount, p.editorAmount)
    if (profit != null) studioProfit += profit
    if (MONTAGE_DELIVERED_STATUSES.includes(p.status)) deliveredCount += 1
    if (MONTAGE_ACTIVE_STATUSES.includes(p.status)) activeCount += 1
    if (isMontageOverdue({ deadlineDate: p.deadlineDate, status: p.status, deliveredAt: p.deliveredAt }, now)) overdueCount += 1
  }

  return {
    projectsCount: inMonth.length,
    editorEarned,
    clientRevenue,
    studioProfit,
    deliveredCount,
    activeCount,
    avgTurnaroundDays: averageTurnaroundDays(inMonth),
    overdueCount,
  }
}

// "1 проект" / "2 проекта" / "5 проектов" — по аналогии с pluralizeOrdersCount
// (order-model.ts), но не переиспользует её напрямую: разные существительные
// с разными формами множественного числа не сводятся к общей функции без
// передачи самого слова, что усложнило бы вызовы больше, чем экономит.
export function pluralizeProjectsCount(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} проект`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} проекта`
  return `${n} проектов`
}
