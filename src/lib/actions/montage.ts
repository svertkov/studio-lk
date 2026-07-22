'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import type {
  MontageProject, MontageStatus, MontageClientPaymentStatus, MontageEditorPaymentStatus, MontageDeadlineType,
  MontageContentType, MontageTurnaroundDayType,
  Order, Client, EditorProfile, DocumentType, DocumentStatus,
} from '@prisma/client'
import {
  computeMontageProfit, computeMontageDeadline, isMontageOverdue, montageDeadlineLabel,
  getMontageSourceMaterialsUrl, getMontageAttentionReasons, mapMontageStatusToOrderStatus,
  computeMontageDashboardStats, classifyMontageContentType, getMontageMaterialsState, MONTAGE_ARCHIVABLE_STATUSES,
  type MontageAttentionReason, type MontageDashboardStats, type MontageMaterialsState,
} from '@/lib/montage-model'
import { getDocumentDisplayNumber } from '@/lib/document-model'
import { updateOrderStatus } from '@/lib/actions/orders'
import { writeAuditLog } from '@/lib/audit'

// ============================================================
// АВТОРИЗАЦИЯ — та же локальная проверка, что в actions/orders.ts и
// actions/schedule.ts (в проекте нет общего requireRole-хелпера, см.
// AGENTS.md/архитектурный разбор — не заводим здесь новый паттерн в обход
// уже существующего). Гранулярные права по ролям (Owner/Admin видят всё,
// будущий личный кабинет монтажёра видит только своё) — задел на будущее,
// сейчас раздел "Монтаж" доступен только сотрудникам с доступом в /admin,
// как и все остальные админ-разделы (см. src/app/(admin)/layout.tsx).
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

// Раздел "Монтаж" завязан на заказы, клиентов, CRM и финансы — любая мутация
// обязана инвалидировать все их разом (AGENTS.md, п.5/9), не только саму
// страницу /admin/editing.
function revalidateMontagePaths(clientId?: string | null): void {
  revalidatePath('/admin/editing')
  revalidatePath('/admin/orders')
  revalidatePath('/admin/crm')
  if (clientId) revalidatePath(`/admin/clients/${clientId}`)
  revalidatePath('/admin/finance')
  revalidatePath('/admin/dashboard')
}

// ============================================================
// СЕРИАЛИЗАЦИЯ
// ============================================================

type MontageOrder = Pick<Order, 'id' | 'title' | 'status' | 'clientId' | 'clientName' | 'companyName'> & {
  client: Pick<Client, 'name' | 'companyName'> | null
  scheduleEvent: { yandexDiskUrl: string | null } | null
}
type MontageClient = Pick<Client, 'id' | 'name' | 'companyName'>
type MontageEditor = Pick<EditorProfile, 'id' | 'displayName'>

type MontageProjectDocument = { type: DocumentType; number: string | null; suffix: string | null; status: DocumentStatus; amount: number | null }
type MontageProjectWithRelations = MontageProject & {
  order: MontageOrder | null
  client: MontageClient | null
  editor: MontageEditor | null
  documents: MontageProjectDocument[]
}

const MONTAGE_INCLUDE = {
  order: {
    select: {
      id: true, title: true, status: true, clientId: true, clientName: true, companyName: true,
      client: { select: { name: true, companyName: true } },
      scheduleEvent: { select: { yandexDiskUrl: true } },
    },
  },
  client: { select: { id: true, name: true, companyName: true } },
  editor: { select: { id: true, displayName: true } },
  // Реестр документов (см. AGENTS.md) — только счёт/акт этого проекта, для
  // компактной колонки таблицы; договор клиента сюда не тянем (тот же
  // принцип, что и у Order.documents в actions/orders.ts).
  documents: { select: { type: true, number: true, suffix: true, status: true, amount: true } },
} as const

export interface MontageProjectDTO {
  id: string
  orderId: string | null
  orderTitle: string | null
  orderStatus: Order['status'] | null
  // Клиент/компания — ЧИТАЮТСЯ через заказ для order-привязанных проектов
  // (не дублируются), и через собственную связь только для самостоятельных
  // (см. схему: MontageProject.clientId).
  clientId: string | null
  clientName: string | null
  companyName: string | null
  title: string | null
  description: string | null
  contentType: MontageContentType | null
  // Заполнено только когда contentType === 'OTHER' — исходный текст, который
  // администратор ввёл вручную, когда ни одна структурированная категория не
  // подошла (см. classifyMontageContentType, montage-model.ts). Никогда не
  // подменяет сам enum произвольным текстом.
  customContentType: string | null
  status: MontageStatus
  // Пауза — обратимый оверлей ПОВЕРХ текущего status, не отдельный статус (тот
  // же принцип, что Order.isArchived, см. actions/orders.ts) — управляется
  // только через pauseMontageProject/resumeMontageProject ниже, никогда через
  // updateMontageProject.
  isPaused: boolean
  pausedAt: string | null
  pauseReason: string | null
  // Отмена — терминальный статус (CANCELLED), но с отдельным поводом/датой,
  // проставляется только через cancelMontageProject.
  cancelledAt: string | null
  cancelReason: string | null
  editorId: string | null
  editorName: string | null
  additionalEditorIds: string[]
  assignedAt: string | null
  sourceReceivedAt: string | null
  startedAt: string | null
  deadlineType: MontageDeadlineType | null
  deadlineDate: string | null
  turnaroundDays: number | null
  turnaroundDayType: MontageTurnaroundDayType | null
  // Технический таймстамп, больше НЕ поле формы — проставляется автоматически
  // при первом переходе статуса в DELIVERED (см. updateMontageProject), не
  // путать с deliveredAt (фактическая дата сдачи клиенту, вводится вручную).
  completedAt: string | null
  deliveredAt: string | null
  clientAmount: number | null
  editorAmount: number | null
  profit: number | null
  clientPaymentStatus: MontageClientPaymentStatus
  editorPaymentStatus: MontageEditorPaymentStatus
  clientPaidAt: string | null
  editorPaidAt: string | null
  paymentComment: string | null
  sourceMaterialsUrl: string | null
  // Эффективная ссылка на исходники — см. getMontageSourceMaterialsUrl
  // (montage-model.ts): собственное поле, иначе материалы связанного заказа.
  // Это "чем сейчас пользуется монтажёр" — НЕ то же самое, что контроль NAS
  // ниже (см. комментарий у sourceMaterialsNasUrl в схеме).
  effectiveSourceMaterialsUrl: string | null
  // Контроль материалов на NAS (ТЗ "точечно доработать контроль материалов") —
  // два независимых NAS-поля, единое состояние — см. getMontageMaterialsState.
  sourceMaterialsNasUrl: string | null
  mountedMaterialNasUrl: string | null
  materialsState: MontageMaterialsState
  deliveryUrl: string | null
  materialsComment: string | null
  revisionsIncluded: number | null
  revisionsUsed: number
  revisionsComment: string | null
  requirements: string | null
  internalComment: string | null
  clientComment: string | null
  importSource: string | null
  createdAt: string
  updatedAt: string
  isArchived: boolean
  archivedAt: string | null
  // ---- Вычисляемые поля (единый источник — src/lib/montage-model.ts, тот же
  // принцип, что ScheduleEventDTO.isCancelled в actions/schedule.ts) ----
  isOverdue: boolean
  deadlineLabel: string | null
  attentionReasons: MontageAttentionReason[]
  // Ни заказа, ни реального Client — только сырое clientName из импорта (см.
  // схему). UI показывает маленькую метку "!" рядом с именем клиента, пока
  // администратор не довяжет реального клиента вручную.
  hasNoClientLink: boolean
  // Проект создан историческим импортом (importSource задан) — влияет на то,
  // какие причины "Требует внимания" применяются (см. isHistoricalImport,
  // montage-model.ts: старые записи не штрафуются за отсутствие исходников/
  // NAS, которых старая Google-таблица никогда не фиксировала).
  isHistoricalImport: boolean
  // Реестр документов (см. AGENTS.md) — только счёт/акт ЭТОГО проекта (не
  // договор клиента, см. комментарий у MONTAGE_INCLUDE.documents выше).
  invoiceDisplayNumber: string | null
  actDisplayNumber: string | null
  appendixDisplayNumber: string | null
}

function toDTO(row: MontageProjectWithRelations): MontageProjectDTO {
  // clientName — как у Order.clientName: снэпшот "как в источнике", источник
  // правды только пока нет реальной связи (ни order, ни client). Нужен для
  // строк исторического импорта, где клиента не удалось сопоставить уверенно
  // (см. схему, комментарий у MontageProject.clientName) — администратор
  // довязывает клиента вручную позже, до этого видит исходное имя из таблицы.
  const clientName = row.order
    ? (row.order.client?.name ?? row.order.clientName)
    : (row.client?.name ?? row.clientName)
  const companyName = row.order ? (row.order.client?.companyName ?? row.order.companyName) : (row.client?.companyName ?? null)
  const effectiveSourceMaterialsUrl = getMontageSourceMaterialsUrl(
    { sourceMaterialsUrl: row.sourceMaterialsUrl },
    row.order?.scheduleEvent?.yandexDiskUrl ?? null,
  )
  const deadlineState = { deadlineDate: row.deadlineDate, status: row.status, deliveredAt: row.deliveredAt, isArchived: row.isArchived }
  const hasNoClientLink = !row.orderId && !row.clientId
  const isHistoricalImport = !!row.importSource
  const materialsState = getMontageMaterialsState({
    status: row.status, sourceReceivedAt: row.sourceReceivedAt,
    sourceMaterialsNasUrl: row.sourceMaterialsNasUrl, mountedMaterialNasUrl: row.mountedMaterialNasUrl,
    isArchived: row.isArchived,
  })

  return {
    id: row.id,
    orderId: row.orderId,
    orderTitle: row.order?.title ?? null,
    orderStatus: row.order?.status ?? null,
    clientId: row.order?.clientId ?? row.clientId,
    clientName,
    companyName,
    title: row.title,
    description: row.description,
    contentType: row.contentType,
    customContentType: row.customContentType,
    status: row.status,
    isPaused: row.isPaused,
    pausedAt: row.pausedAt ? row.pausedAt.toISOString() : null,
    pauseReason: row.pauseReason,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancelReason: row.cancelReason,
    editorId: row.editorId,
    editorName: row.editor?.displayName ?? null,
    additionalEditorIds: row.additionalEditorIds,
    assignedAt: row.assignedAt ? row.assignedAt.toISOString() : null,
    sourceReceivedAt: row.sourceReceivedAt ? row.sourceReceivedAt.toISOString() : null,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    deadlineType: row.deadlineType,
    deadlineDate: row.deadlineDate ? row.deadlineDate.toISOString() : null,
    turnaroundDays: row.turnaroundDays,
    turnaroundDayType: row.turnaroundDayType,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
    clientAmount: row.clientAmount,
    editorAmount: row.editorAmount,
    profit: computeMontageProfit(row.clientAmount, row.editorAmount),
    clientPaymentStatus: row.clientPaymentStatus,
    editorPaymentStatus: row.editorPaymentStatus,
    clientPaidAt: row.clientPaidAt ? row.clientPaidAt.toISOString() : null,
    editorPaidAt: row.editorPaidAt ? row.editorPaidAt.toISOString() : null,
    paymentComment: row.paymentComment,
    sourceMaterialsUrl: row.sourceMaterialsUrl,
    effectiveSourceMaterialsUrl,
    sourceMaterialsNasUrl: row.sourceMaterialsNasUrl,
    mountedMaterialNasUrl: row.mountedMaterialNasUrl,
    materialsState,
    deliveryUrl: row.deliveryUrl,
    materialsComment: row.materialsComment,
    revisionsIncluded: row.revisionsIncluded,
    revisionsUsed: row.revisionsUsed,
    revisionsComment: row.revisionsComment,
    requirements: row.requirements,
    internalComment: row.internalComment,
    clientComment: row.clientComment,
    importSource: row.importSource,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isArchived: row.isArchived,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    isOverdue: isMontageOverdue(deadlineState),
    deadlineLabel: montageDeadlineLabel(deadlineState),
    attentionReasons: getMontageAttentionReasons({
      status: row.status, editorId: row.editorId, deadlineDate: row.deadlineDate, deliveredAt: row.deliveredAt,
      effectiveSourceMaterialsUrl, sourceMaterialsNasUrl: row.sourceMaterialsNasUrl, mountedMaterialNasUrl: row.mountedMaterialNasUrl,
      sourceReceivedAt: row.sourceReceivedAt,
      clientAmount: row.clientAmount, clientPaymentStatus: row.clientPaymentStatus,
      title: row.title, description: row.description, hasNoClientLink, isHistoricalImport,
      isArchived: row.isArchived,
    }),
    hasNoClientLink,
    isHistoricalImport,
    invoiceDisplayNumber: (() => {
      const invoice = row.documents.find(d => d.type === 'INVOICE' && d.status !== 'CANCELLED')
      return invoice ? getDocumentDisplayNumber(invoice, row.documentPackageNumber) : null
    })(),
    actDisplayNumber: (() => {
      const act = row.documents.find(d => d.type === 'ACT' && d.status !== 'CANCELLED')
      return act ? getDocumentDisplayNumber(act, row.documentPackageNumber) : null
    })(),
    appendixDisplayNumber: (() => {
      const appendix = row.documents.find(d => d.type === 'APPENDIX' && d.status !== 'CANCELLED')
      return appendix ? getDocumentDisplayNumber(appendix, null) : null
    })(),
  }
}

// ============================================================
// СПИСОК ПРОЕКТОВ — единый для дашборда, таблицы и всех фильтров/группировок
// (ТЗ п.17: "не обязательно создавать четыре разные страницы"). Датасет
// небольшой (исторический импорт — десятки строк, см. dry-run), поэтому,
// как и в разделе "Заказы", загружается целиком и фильтруется/группируется
// на клиенте — тот же принцип, что getAllOrders (actions/orders.ts).
// ============================================================

export async function getAllMontageProjects(): Promise<
  { ok: true; data: MontageProjectDTO[] } | { ok: false; data: MontageProjectDTO[]; error: string }
> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }

  try {
    const rows = await prisma.montageProject.findMany({
      orderBy: { createdAt: 'desc' },
      include: MONTAGE_INCLUDE,
    })
    return { ok: true, data: rows.map(toDTO) }
  } catch (e) {
    console.error('[getAllMontageProjects]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить проекты монтажа' }
  }
}

// Проекты клиента — объединяет самостоятельные (clientId) и привязанные к
// заказу (order.clientId) одним запросом, а не отдельной копией данных (см.
// комментарий у Client.montageProjects в схеме).
export async function getMontageProjectsForClient(clientId: string): Promise<
  { ok: true; data: MontageProjectDTO[] } | { ok: false; data: MontageProjectDTO[]; error: string }
> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }

  try {
    const rows = await prisma.montageProject.findMany({
      where: { OR: [{ clientId }, { order: { clientId } }] },
      orderBy: { createdAt: 'desc' },
      include: MONTAGE_INCLUDE,
    })
    return { ok: true, data: rows.map(toDTO) }
  } catch (e) {
    console.error('[getMontageProjectsForClient]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить проекты монтажа клиента' }
  }
}

// Проекты монтажа ОДНОГО заказа — читается финансовым блоком карточки заказа
// (OrderFinanceBlock) и диалогом отключения монтажа (MontageDisableChoiceDialog),
// чтобы показывать/менять MontageProject.editorAmount/clientAmount напрямую,
// не заводя копию этих полей на Order (см. AGENTS.md, единый источник данных).
export async function getMontageProjectsForOrder(orderId: string): Promise<
  { ok: true; data: MontageProjectDTO[] } | { ok: false; data: MontageProjectDTO[]; error: string }
> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }

  try {
    const rows = await prisma.montageProject.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      include: MONTAGE_INCLUDE,
    })
    return { ok: true, data: rows.map(toDTO) }
  } catch (e) {
    console.error('[getMontageProjectsForOrder]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить проекты монтажа заказа' }
  }
}

export async function getMontageProjectsForEditor(editorId: string): Promise<
  { ok: true; data: MontageProjectDTO[] } | { ok: false; data: MontageProjectDTO[]; error: string }
> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }

  try {
    const rows = await prisma.montageProject.findMany({
      where: { editorId },
      orderBy: { createdAt: 'desc' },
      include: MONTAGE_INCLUDE,
    })
    return { ok: true, data: rows.map(toDTO) }
  } catch (e) {
    console.error('[getMontageProjectsForEditor]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить проекты монтажёра' }
  }
}

// ============================================================
// ДАШБОРД — считает KPI единым чистым хелпером (computeMontageDashboardStats,
// montage-model.ts) из того же полного списка, что видит таблица, чтобы
// цифры карточек и раскрытая аналитика никогда не расходились (ТЗ п.12).
// ============================================================

export async function getMontageDashboardStats(): Promise<
  { ok: true; data: MontageDashboardStats } | { ok: false; data: null; error: string }
> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: null, error: authResult.error }

  try {
    const rows = await prisma.montageProject.findMany({ include: MONTAGE_INCLUDE })
    const dtos = rows.map(toDTO)
    return { ok: true, data: computeMontageDashboardStats(dtos) }
  } catch (e) {
    console.error('[getMontageDashboardStats]', e)
    return { ok: false, data: null, error: 'Не удалось посчитать статистику монтажа' }
  }
}

// ============================================================
// СОЗДАТЬ / ОБНОВИТЬ ПРОЕКТ ВРУЧНУЮ (карточка проекта, п.19 ТЗ)
// ============================================================

export interface MontageProjectInput {
  orderId?: string | null
  clientId?: string | null
  title?: string
  description?: string
  contentType?: MontageContentType
  // Учитывается только когда contentType === 'OTHER' (см. MontageProjectDTO.
  // customContentType) — при любом другом contentType сохраняется как null,
  // чтобы на карточке не залипал текст от предыдущего выбора "Прочее".
  customContentType?: string | null
  status?: MontageStatus
  editorId?: string | null
  additionalEditorIds?: string[]
  sourceReceivedAt?: string | null
  startedAt?: string | null
  deadlineType?: MontageDeadlineType | null
  deadlineDate?: string | null
  turnaroundDays?: number | null
  turnaroundDayType?: MontageTurnaroundDayType | null
  // completedAt НЕ входит в этот интерфейс — это больше не поле формы (ТЗ:
  // убрать дублирующую "Дата завершения работы"), см. комментарий у
  // MontageProjectDTO.completedAt. Проставляется автоматически в
  // createMontageProject/updateMontageProject при первом переходе в DELIVERED.
  deliveredAt?: string | null
  clientAmount?: number | null
  editorAmount?: number | null
  clientPaymentStatus?: MontageClientPaymentStatus
  editorPaymentStatus?: MontageEditorPaymentStatus
  clientPaidAt?: string | null
  editorPaidAt?: string | null
  paymentComment?: string
  sourceMaterialsUrl?: string | null
  sourceMaterialsNasUrl?: string | null
  mountedMaterialNasUrl?: string | null
  deliveryUrl?: string | null
  materialsComment?: string
  revisionsIncluded?: number | null
  revisionsUsed?: number
  revisionsComment?: string
  requirements?: string
  internalComment?: string
  clientComment?: string
  // Явное подтверждение "да, создать ещё один проект для заказа, у которого
  // уже есть проект(ы)" (ТЗ п.18: "предупредить и не создавать дубль без
  // явного подтверждения") — UI сам показывает предупреждение и список уже
  // существующих проектов ДО отправки, здесь только финальная защита.
  confirmDuplicateForOrder?: boolean
}

// assignedAt проставляется автоматически, когда editorId впервые задаётся —
// не отдельное ручное поле формы (ТЗ п.7: "После назначения... установить
// assignedAt"), чтобы дата назначения не могла разойтись с самим фактом
// назначения монтажёра.
function resolveAssignedAt(nextEditorId: string | null | undefined, previousEditorId: string | null, previousAssignedAt: Date | null): Date | null {
  if (nextEditorId === undefined) return previousAssignedAt
  if (!nextEditorId) return null
  if (nextEditorId === previousEditorId) return previousAssignedAt
  return new Date()
}

// customContentType имеет смысл только при contentType === 'OTHER' (см.
// MontageProjectInput.customContentType) — общий хелпер для create/update,
// чтобы это правило не разошлось между ними.
function resolveCustomContentType(
  contentType: MontageContentType | null | undefined, customContentType: string | null | undefined,
): string | null {
  if (contentType !== 'OTHER') return null
  return customContentType?.trim() || null
}

export async function createMontageProject(
  input: MontageProjectInput
): Promise<{ ok: true; data: MontageProjectDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  if (!input.orderId && !input.clientId) {
    return { ok: false, error: 'Укажите заказ или клиента для самостоятельного проекта' }
  }

  try {
    // Заказ уже может иметь автосозданный проект (см. ensureMontageProjectForOrder)
    // — второй проект на тот же заказ создаётся только осознанно, форма должна
    // была предупредить об этом ДО вызова (ТЗ п.18), здесь — финальная защита.
    if (input.orderId) {
      const existingCount = await prisma.montageProject.count({ where: { orderId: input.orderId } })
      if (existingCount > 0 && !input.confirmDuplicateForOrder) {
        return { ok: false, error: 'У этого заказа уже есть проект монтажа. Подтвердите создание ещё одного.' }
      }
    }

    const deadlineDate = computeMontageDeadline({
      sourceReceivedAt: input.sourceReceivedAt ?? null,
      deadlineType: input.deadlineType ?? null,
      deadlineDate: input.deadlineDate ?? null,
      turnaroundDays: input.turnaroundDays ?? null,
      turnaroundDayType: input.turnaroundDayType ?? null,
    })
    const initialStatus = input.status ?? 'NEW'

    const created = await prisma.montageProject.create({
      data: {
        orderId: input.orderId ?? null,
        clientId: input.orderId ? null : (input.clientId ?? null),
        title: input.title?.trim() || null,
        description: input.description?.trim() || null,
        contentType: input.contentType ?? null,
        customContentType: resolveCustomContentType(input.contentType, input.customContentType),
        status: initialStatus,
        editorId: input.editorId ?? null,
        additionalEditorIds: input.additionalEditorIds ?? [],
        assignedAt: input.editorId ? new Date() : null,
        sourceReceivedAt: input.sourceReceivedAt ? new Date(input.sourceReceivedAt) : null,
        startedAt: input.startedAt ? new Date(input.startedAt) : null,
        deadlineType: input.deadlineType ?? null,
        deadlineDate,
        turnaroundDays: input.turnaroundDays ?? null,
        turnaroundDayType: input.turnaroundDayType ?? null,
        // completedAt — технический таймстамп, не поле формы (см. интерфейс
        // MontageProjectInput выше) — проставляется автоматически, только если
        // проект создаётся сразу в статусе "Сдан" (редкий случай, обычно новый
        // проект стартует с NEW). Тот же принцип, что и completedAt у Order
        // (см. updateOrderStatus, actions/orders.ts).
        completedAt: initialStatus === 'DELIVERED' ? new Date() : null,
        deliveredAt: input.deliveredAt ? new Date(input.deliveredAt) : null,
        clientAmount: input.clientAmount ?? null,
        editorAmount: input.editorAmount ?? null,
        clientPaymentStatus: input.clientPaymentStatus ?? 'NOT_SPECIFIED',
        editorPaymentStatus: input.editorPaymentStatus ?? 'NOT_CALCULATED',
        clientPaidAt: input.clientPaidAt ? new Date(input.clientPaidAt) : null,
        editorPaidAt: input.editorPaidAt ? new Date(input.editorPaidAt) : null,
        paymentComment: input.paymentComment?.trim() || null,
        sourceMaterialsUrl: input.sourceMaterialsUrl?.trim() || null,
        sourceMaterialsNasUrl: input.sourceMaterialsNasUrl?.trim() || null,
        mountedMaterialNasUrl: input.mountedMaterialNasUrl?.trim() || null,
        deliveryUrl: input.deliveryUrl?.trim() || null,
        materialsComment: input.materialsComment?.trim() || null,
        revisionsIncluded: input.revisionsIncluded ?? null,
        revisionsUsed: input.revisionsUsed ?? 0,
        revisionsComment: input.revisionsComment?.trim() || null,
        requirements: input.requirements?.trim() || null,
        internalComment: input.internalComment?.trim() || null,
        clientComment: input.clientComment?.trim() || null,
      },
      include: MONTAGE_INCLUDE,
    })

    revalidateMontagePaths(created.order?.clientId ?? created.clientId)
    return { ok: true, data: toDTO(created) }
  } catch (e) {
    console.error('[createMontageProject]', e)
    return { ok: false, error: 'Не удалось создать проект монтажа' }
  }
}

export async function updateMontageProject(
  id: string, input: MontageProjectInput
): Promise<{ ok: true; data: MontageProjectDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  try {
    const existing = await prisma.montageProject.findUnique({ where: { id } })
    if (!existing) return { ok: false, error: 'Проект монтажа не найден' }

    const nextSourceReceivedAt = input.sourceReceivedAt !== undefined
      ? (input.sourceReceivedAt ? new Date(input.sourceReceivedAt) : null)
      : existing.sourceReceivedAt
    const nextDeadlineType = input.deadlineType !== undefined ? input.deadlineType : existing.deadlineType
    const nextTurnaroundDays = input.turnaroundDays !== undefined ? input.turnaroundDays : existing.turnaroundDays
    const nextTurnaroundDayType = input.turnaroundDayType !== undefined ? input.turnaroundDayType : existing.turnaroundDayType
    const nextDeadlineDateInput = input.deadlineDate !== undefined ? input.deadlineDate : existing.deadlineDate?.toISOString() ?? null
    const deadlineDate = computeMontageDeadline({
      sourceReceivedAt: nextSourceReceivedAt ? nextSourceReceivedAt.toISOString() : null,
      deadlineType: nextDeadlineType, deadlineDate: nextDeadlineDateInput, turnaroundDays: nextTurnaroundDays,
      turnaroundDayType: nextTurnaroundDayType,
    })

    const assignedAt = resolveAssignedAt(input.editorId, existing.editorId, existing.assignedAt)
    const nextContentType = input.contentType !== undefined ? input.contentType : existing.contentType
    const nextCustomContentTypeInput = input.customContentType !== undefined ? input.customContentType : existing.customContentType

    const updated = await prisma.montageProject.update({
      where: { id },
      data: {
        orderId: input.orderId !== undefined ? input.orderId : undefined,
        clientId: input.clientId !== undefined ? input.clientId : undefined,
        title: input.title !== undefined ? (input.title.trim() || null) : undefined,
        description: input.description !== undefined ? (input.description.trim() || null) : undefined,
        contentType: input.contentType !== undefined ? input.contentType : undefined,
        // Пересчитывается, если поменялось ЛИБО contentType, ЛИБО сам текст —
        // см. resolveCustomContentType выше: обнуляется, если категория ушла
        // от OTHER, даже если сам customContentType в этом вызове не передан.
        customContentType: (input.contentType !== undefined || input.customContentType !== undefined)
          ? resolveCustomContentType(nextContentType, nextCustomContentTypeInput)
          : undefined,
        status: input.status ?? undefined,
        editorId: input.editorId !== undefined ? input.editorId : undefined,
        additionalEditorIds: input.additionalEditorIds ?? undefined,
        assignedAt,
        sourceReceivedAt: nextSourceReceivedAt,
        startedAt: input.startedAt !== undefined ? (input.startedAt ? new Date(input.startedAt) : null) : undefined,
        deadlineType: nextDeadlineType,
        deadlineDate,
        turnaroundDays: nextTurnaroundDays,
        turnaroundDayType: nextTurnaroundDayType,
        // completedAt больше не читается из input (поле убрано из формы) —
        // проставляется один раз автоматически при первом переходе в DELIVERED
        // и дальше не трогается ("sticky", тот же принцип, что у Order.completedAt
        // в updateOrderStatus, actions/orders.ts).
        completedAt: input.status === 'DELIVERED' && existing.status !== 'DELIVERED'
          ? (existing.completedAt ?? new Date())
          : undefined,
        deliveredAt: input.deliveredAt !== undefined ? (input.deliveredAt ? new Date(input.deliveredAt) : null) : undefined,
        clientAmount: input.clientAmount !== undefined ? input.clientAmount : undefined,
        editorAmount: input.editorAmount !== undefined ? input.editorAmount : undefined,
        clientPaymentStatus: input.clientPaymentStatus ?? undefined,
        editorPaymentStatus: input.editorPaymentStatus ?? undefined,
        clientPaidAt: input.clientPaidAt !== undefined ? (input.clientPaidAt ? new Date(input.clientPaidAt) : null) : undefined,
        editorPaidAt: input.editorPaidAt !== undefined ? (input.editorPaidAt ? new Date(input.editorPaidAt) : null) : undefined,
        paymentComment: input.paymentComment !== undefined ? (input.paymentComment.trim() || null) : undefined,
        sourceMaterialsUrl: input.sourceMaterialsUrl !== undefined ? (input.sourceMaterialsUrl?.trim() || null) : undefined,
        sourceMaterialsNasUrl: input.sourceMaterialsNasUrl !== undefined ? (input.sourceMaterialsNasUrl?.trim() || null) : undefined,
        mountedMaterialNasUrl: input.mountedMaterialNasUrl !== undefined ? (input.mountedMaterialNasUrl?.trim() || null) : undefined,
        deliveryUrl: input.deliveryUrl !== undefined ? (input.deliveryUrl?.trim() || null) : undefined,
        materialsComment: input.materialsComment !== undefined ? (input.materialsComment.trim() || null) : undefined,
        revisionsIncluded: input.revisionsIncluded !== undefined ? input.revisionsIncluded : undefined,
        revisionsUsed: input.revisionsUsed ?? undefined,
        revisionsComment: input.revisionsComment !== undefined ? (input.revisionsComment.trim() || null) : undefined,
        requirements: input.requirements !== undefined ? (input.requirements.trim() || null) : undefined,
        internalComment: input.internalComment !== undefined ? (input.internalComment.trim() || null) : undefined,
        clientComment: input.clientComment !== undefined ? (input.clientComment.trim() || null) : undefined,
      },
      include: MONTAGE_INCLUDE,
    })

    // Однонаправленная связь со статусом заказа (ТЗ п.23) — только когда
    // статус проекта реально изменился этим вызовом, чтобы не пересчитывать
    // на каждое сохранение карточки (правка комментария и т.п.).
    if (input.status && input.status !== existing.status && updated.orderId) {
      const linkedOrder = await prisma.order.findUnique({ where: { id: updated.orderId }, select: { status: true } })
      if (linkedOrder) {
        const nextOrderStatus = mapMontageStatusToOrderStatus(input.status, linkedOrder.status)
        if (nextOrderStatus) await updateOrderStatus(updated.orderId, nextOrderStatus)
      }
    }

    revalidateMontagePaths(updated.order?.clientId ?? updated.clientId)
    return { ok: true, data: toDTO(updated) }
  } catch (e) {
    console.error('[updateMontageProject]', e)
    return { ok: false, error: 'Не удалось обновить проект монтажа' }
  }
}

// Быстрое назначение монтажёра (виджет "Ответственный монтажёр", ТЗ п.7) —
// отдельная лёгкая мутация, чтобы назначить исполнителя можно было прямо из
// таблицы/дашборда без открытия полной карточки редактирования. Статус БОЛЬШЕ
// не двигается автоматически при назначении (значения "Назначен" не
// существует в новой 5-статусной схеме) — отсутствие монтажёра теперь просто
// исчезает из причин "Требует внимания" (NO_EDITOR, см. montage-model.ts) само
// по себе, как только editorId задан; переход в "В работе" — отдельное
// осознанное действие пользователя.
export async function assignMontageEditor(
  id: string, editorId: string | null
): Promise<{ ok: true; data: MontageProjectDTO } | { ok: false; error: string }> {
  return updateMontageProject(id, { editorId })
}

// ============================================================
// ПАУЗА / ОТМЕНА / АРХИВ — обратимый оверлей (пауза) и терминальные действия
// (отмена, архив) НЕ являются производственными статусами (см. MONTAGE_STATUS_
// ORDER, montage-model.ts) — у каждого своя выделенная мутация, а не значение
// поля status в updateMontageProject. Тот же overlay-принцип, что уже
// применяется для Order.isArchived (см. unarchiveOrder, actions/orders.ts).
// ============================================================

export async function pauseMontageProject(
  id: string, reason?: string | null
): Promise<{ ok: true; data: MontageProjectDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  try {
    const existing = await prisma.montageProject.findUnique({ where: { id } })
    if (!existing) return { ok: false, error: 'Проект монтажа не найден' }
    if (existing.status === 'CANCELLED') return { ok: false, error: 'Проект отменён — приостановить нельзя' }

    const updated = await prisma.montageProject.update({
      where: { id },
      data: { isPaused: true, pausedAt: new Date(), pauseReason: reason?.trim() || null },
      include: MONTAGE_INCLUDE,
    })

    await writeAuditLog({
      userId: authResult.userId, action: 'MONTAGE_PROJECT_PAUSED', entityType: 'MontageProject', entityId: id,
      metadata: { reason: reason?.trim() || null },
    })
    revalidateMontagePaths(updated.order?.clientId ?? updated.clientId)
    return { ok: true, data: toDTO(updated) }
  } catch (e) {
    console.error('[pauseMontageProject]', e)
    return { ok: false, error: 'Не удалось приостановить проект' }
  }
}

export async function resumeMontageProject(
  id: string
): Promise<{ ok: true; data: MontageProjectDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  try {
    const existing = await prisma.montageProject.findUnique({ where: { id } })
    if (!existing) return { ok: false, error: 'Проект монтажа не найден' }

    // pausedAt/pauseReason НЕ очищаются (см. схему, комментарий у
    // MontageProject.pausedAt) — остаются историей последней паузы, только
    // сам флаг isPaused переключается обратно.
    const updated = await prisma.montageProject.update({
      where: { id },
      data: { isPaused: false },
      include: MONTAGE_INCLUDE,
    })

    await writeAuditLog({
      userId: authResult.userId, action: 'MONTAGE_PROJECT_RESUMED', entityType: 'MontageProject', entityId: id,
    })
    revalidateMontagePaths(updated.order?.clientId ?? updated.clientId)
    return { ok: true, data: toDTO(updated) }
  } catch (e) {
    console.error('[resumeMontageProject]', e)
    return { ok: false, error: 'Не удалось возобновить проект' }
  }
}

export async function cancelMontageProject(
  id: string, reason?: string | null
): Promise<{ ok: true; data: MontageProjectDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  try {
    const existing = await prisma.montageProject.findUnique({ where: { id } })
    if (!existing) return { ok: false, error: 'Проект монтажа не найден' }
    if (existing.status === 'CANCELLED') return { ok: false, error: 'Проект уже отменён' }

    const updated = await prisma.montageProject.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: reason?.trim() || null,
        // Пауза больше не имеет смысла на отменённом проекте — снимаем активный
        // флаг, чтобы карточка не показывала одновременно "Отменён" и
        // "Приостановлен". pausedAt/pauseReason не трогаем — та же история,
        // что и при обычном resumeMontageProject (см. схему).
        isPaused: false,
      },
      include: MONTAGE_INCLUDE,
    })

    await writeAuditLog({
      userId: authResult.userId, action: 'MONTAGE_PROJECT_CANCELLED', entityType: 'MontageProject', entityId: id,
      metadata: { reason: reason?.trim() || null },
    })
    revalidateMontagePaths(updated.order?.clientId ?? updated.clientId)
    return { ok: true, data: toDTO(updated) }
  } catch (e) {
    console.error('[cancelMontageProject]', e)
    return { ok: false, error: 'Не удалось отменить проект' }
  }
}

export async function archiveMontageProject(
  id: string
): Promise<{ ok: true; data: MontageProjectDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  try {
    const existing = await prisma.montageProject.findUnique({ where: { id } })
    if (!existing) return { ok: false, error: 'Проект монтажа не найден' }
    if (!MONTAGE_ARCHIVABLE_STATUSES.includes(existing.status)) {
      return { ok: false, error: 'В архив можно отправить только сданный или отменённый проект' }
    }

    const updated = await prisma.montageProject.update({
      where: { id },
      data: { isArchived: true, archivedAt: new Date() },
      include: MONTAGE_INCLUDE,
    })

    await writeAuditLog({
      userId: authResult.userId, action: 'MONTAGE_PROJECT_ARCHIVED', entityType: 'MontageProject', entityId: id,
    })
    revalidateMontagePaths(updated.order?.clientId ?? updated.clientId)
    return { ok: true, data: toDTO(updated) }
  } catch (e) {
    console.error('[archiveMontageProject]', e)
    return { ok: false, error: 'Не удалось отправить проект в архив' }
  }
}

export async function unarchiveMontageProject(
  id: string
): Promise<{ ok: true; data: MontageProjectDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  try {
    const existing = await prisma.montageProject.findUnique({ where: { id } })
    if (!existing) return { ok: false, error: 'Проект монтажа не найден' }
    if (!existing.isArchived) return { ok: false, error: 'Проект не находится в архиве' }

    const updated = await prisma.montageProject.update({
      where: { id },
      data: { isArchived: false, archivedAt: null },
      include: MONTAGE_INCLUDE,
    })

    revalidateMontagePaths(updated.order?.clientId ?? updated.clientId)
    return { ok: true, data: toDTO(updated) }
  } catch (e) {
    console.error('[unarchiveMontageProject]', e)
    return { ok: false, error: 'Не удалось вернуть проект из архива' }
  }
}

// ============================================================
// АВТОСОЗДАНИЕ ПРОЕКТА ИЗ ЗАКАЗА (ТЗ п.6) — вызывается из upsertScheduleEvent
// (schedule.ts) и updateOrder (orders.ts) в момент, когда editingRequired
// становится true. Идемпотентно: если у заказа УЖЕ есть хотя бы один проект
// (созданный автоматически или вручную), новый не создаётся — повторное
// сохранение карточки заказа/записи не плодит дубли.
// ============================================================

export async function ensureMontageProjectForOrder(orderId: string): Promise<void> {
  try {
    const existingCount = await prisma.montageProject.count({ where: { orderId } })
    if (existingCount > 0) return

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        title: true, serviceType: true, clientId: true,
        client: { select: { name: true } },
        clientName: true,
      },
    })
    if (!order) return

    const clientLabel = order.client?.name ?? order.clientName
    // serviceType заказа — свободный текст ("Подкаст", "Видеовизитка" и т.п.),
    // не enum — прогоняем через тот же классификатор, что и исторический
    // импорт (classifyMontageContentType, montage-model.ts), а не заводим
    // вторую эвристику здесь (AGENTS.md, п.4: не дублировать логику).
    const classification = order.serviceType ? classifyMontageContentType(order.serviceType) : null
    await prisma.montageProject.create({
      data: {
        orderId,
        title: order.title ?? (clientLabel ? `Монтаж — ${clientLabel}` : null),
        contentType: classification?.contentType ?? null,
        customContentType: classification?.customContentType ?? null,
        // NEW — "ещё не начали", покрывает и то, что раньше было NEEDS_INFO
        // (см. MONTAGE_ATTENTION_EXEMPT_STATUSES, montage-model.ts).
        status: 'NEW',
        // "Дата поступления" — момент, когда решение "монтаж нужен" было
        // сохранено, а не дата съёмки (ТЗ п.14: "дата, когда проект был
        // передан в монтаж"). Суммы клиента/монтажёра НЕ переносятся из
        // preliminaryAmount заказа — это стоимость СЪЁМКИ, а не монтажа,
        // отдельного продукта с собственной ценой (см. ГЛАВНУЮ КОНЦЕПЦИЮ ТЗ).
        sourceReceivedAt: new Date(),
      },
    })

    revalidateMontagePaths(order.clientId)
  } catch (e) {
    // Намеренно не пробрасываем ошибку — автосоздание проекта монтажа не
    // должно заблокировать сохранение самого заказа/записи расписания
    // (тот же принцип осторожности, что у writeAuditLog в schedule.ts).
    console.error('[ensureMontageProjectForOrder]', e)
  }
}
