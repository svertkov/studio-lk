'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import type {
  MontageProject, MontageStatus, MontageClientPaymentStatus, MontageEditorPaymentStatus, MontageDeadlineType,
  Order, Client, EditorProfile,
} from '@prisma/client'
import {
  computeMontageProfit, computeMontageDeadline, isMontageOverdue, montageDeadlineLabel,
  getMontageSourceMaterialsUrl, getMontageAttentionReasons, mapMontageStatusToOrderStatus,
  computeMontageDashboardStats, type MontageAttentionReason, type MontageDashboardStats,
} from '@/lib/montage-model'
import { updateOrderStatus } from '@/lib/actions/orders'

// ============================================================
// АВТОРИЗАЦИЯ — та же локальная проверка, что в actions/orders.ts и
// actions/schedule.ts (в проекте нет общего requireRole-хелпера, см.
// AGENTS.md/архитектурный разбор — не заводим здесь новый паттерн в обход
// уже существующего). Гранулярные права по ролям (Owner/Admin видят всё,
// будущий личный кабинет монтажёра видит только своё) — задел на будущее,
// сейчас раздел "Монтаж" доступен только сотрудникам с доступом в /admin,
// как и все остальные админ-разделы (см. src/app/(admin)/layout.tsx).
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

type MontageProjectWithRelations = MontageProject & {
  order: MontageOrder | null
  client: MontageClient | null
  editor: MontageEditor | null
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
  contentType: string | null
  status: MontageStatus
  editorId: string | null
  editorName: string | null
  additionalEditorIds: string[]
  assignedAt: string | null
  sourceReceivedAt: string | null
  startedAt: string | null
  deadlineType: MontageDeadlineType | null
  deadlineDate: string | null
  turnaroundDays: number | null
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
  effectiveSourceMaterialsUrl: string | null
  mountedMaterialNasUrl: string | null
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
  const deadlineState = { deadlineDate: row.deadlineDate, status: row.status, deliveredAt: row.deliveredAt }
  const hasNoClientLink = !row.orderId && !row.clientId

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
    status: row.status,
    editorId: row.editorId,
    editorName: row.editor?.displayName ?? null,
    additionalEditorIds: row.additionalEditorIds,
    assignedAt: row.assignedAt ? row.assignedAt.toISOString() : null,
    sourceReceivedAt: row.sourceReceivedAt ? row.sourceReceivedAt.toISOString() : null,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    deadlineType: row.deadlineType,
    deadlineDate: row.deadlineDate ? row.deadlineDate.toISOString() : null,
    turnaroundDays: row.turnaroundDays,
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
    mountedMaterialNasUrl: row.mountedMaterialNasUrl,
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
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    isOverdue: isMontageOverdue(deadlineState),
    deadlineLabel: montageDeadlineLabel(deadlineState),
    attentionReasons: getMontageAttentionReasons({
      status: row.status, editorId: row.editorId, deadlineDate: row.deadlineDate, deliveredAt: row.deliveredAt,
      effectiveSourceMaterialsUrl, mountedMaterialNasUrl: row.mountedMaterialNasUrl,
      clientAmount: row.clientAmount, clientPaymentStatus: row.clientPaymentStatus,
      title: row.title, description: row.description, hasNoClientLink,
    }),
    hasNoClientLink,
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
  contentType?: string
  status?: MontageStatus
  editorId?: string | null
  additionalEditorIds?: string[]
  sourceReceivedAt?: string | null
  startedAt?: string | null
  deadlineType?: MontageDeadlineType | null
  deadlineDate?: string | null
  turnaroundDays?: number | null
  completedAt?: string | null
  deliveredAt?: string | null
  clientAmount?: number | null
  editorAmount?: number | null
  clientPaymentStatus?: MontageClientPaymentStatus
  editorPaymentStatus?: MontageEditorPaymentStatus
  clientPaidAt?: string | null
  editorPaidAt?: string | null
  paymentComment?: string
  sourceMaterialsUrl?: string | null
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
    })

    const created = await prisma.montageProject.create({
      data: {
        orderId: input.orderId ?? null,
        clientId: input.orderId ? null : (input.clientId ?? null),
        title: input.title?.trim() || null,
        description: input.description?.trim() || null,
        contentType: input.contentType?.trim() || null,
        status: input.status ?? 'NEW',
        editorId: input.editorId ?? null,
        additionalEditorIds: input.additionalEditorIds ?? [],
        assignedAt: input.editorId ? new Date() : null,
        sourceReceivedAt: input.sourceReceivedAt ? new Date(input.sourceReceivedAt) : null,
        startedAt: input.startedAt ? new Date(input.startedAt) : null,
        deadlineType: input.deadlineType ?? null,
        deadlineDate,
        turnaroundDays: input.turnaroundDays ?? null,
        completedAt: input.completedAt ? new Date(input.completedAt) : null,
        deliveredAt: input.deliveredAt ? new Date(input.deliveredAt) : null,
        clientAmount: input.clientAmount ?? null,
        editorAmount: input.editorAmount ?? null,
        clientPaymentStatus: input.clientPaymentStatus ?? 'NOT_SPECIFIED',
        editorPaymentStatus: input.editorPaymentStatus ?? 'NOT_CALCULATED',
        clientPaidAt: input.clientPaidAt ? new Date(input.clientPaidAt) : null,
        editorPaidAt: input.editorPaidAt ? new Date(input.editorPaidAt) : null,
        paymentComment: input.paymentComment?.trim() || null,
        sourceMaterialsUrl: input.sourceMaterialsUrl?.trim() || null,
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
    const nextDeadlineDateInput = input.deadlineDate !== undefined ? input.deadlineDate : existing.deadlineDate?.toISOString() ?? null
    const deadlineDate = computeMontageDeadline({
      sourceReceivedAt: nextSourceReceivedAt ? nextSourceReceivedAt.toISOString() : null,
      deadlineType: nextDeadlineType, deadlineDate: nextDeadlineDateInput, turnaroundDays: nextTurnaroundDays,
    })

    const assignedAt = resolveAssignedAt(input.editorId, existing.editorId, existing.assignedAt)

    const updated = await prisma.montageProject.update({
      where: { id },
      data: {
        orderId: input.orderId !== undefined ? input.orderId : undefined,
        clientId: input.clientId !== undefined ? input.clientId : undefined,
        title: input.title !== undefined ? (input.title.trim() || null) : undefined,
        description: input.description !== undefined ? (input.description.trim() || null) : undefined,
        contentType: input.contentType !== undefined ? (input.contentType.trim() || null) : undefined,
        status: input.status ?? undefined,
        editorId: input.editorId !== undefined ? input.editorId : undefined,
        additionalEditorIds: input.additionalEditorIds ?? undefined,
        assignedAt,
        sourceReceivedAt: nextSourceReceivedAt,
        startedAt: input.startedAt !== undefined ? (input.startedAt ? new Date(input.startedAt) : null) : undefined,
        deadlineType: nextDeadlineType,
        deadlineDate,
        turnaroundDays: nextTurnaroundDays,
        completedAt: input.completedAt !== undefined ? (input.completedAt ? new Date(input.completedAt) : null) : undefined,
        deliveredAt: input.deliveredAt !== undefined ? (input.deliveredAt ? new Date(input.deliveredAt) : null) : undefined,
        clientAmount: input.clientAmount !== undefined ? input.clientAmount : undefined,
        editorAmount: input.editorAmount !== undefined ? input.editorAmount : undefined,
        clientPaymentStatus: input.clientPaymentStatus ?? undefined,
        editorPaymentStatus: input.editorPaymentStatus ?? undefined,
        clientPaidAt: input.clientPaidAt !== undefined ? (input.clientPaidAt ? new Date(input.clientPaidAt) : null) : undefined,
        editorPaidAt: input.editorPaidAt !== undefined ? (input.editorPaidAt ? new Date(input.editorPaidAt) : null) : undefined,
        paymentComment: input.paymentComment !== undefined ? (input.paymentComment.trim() || null) : undefined,
        sourceMaterialsUrl: input.sourceMaterialsUrl !== undefined ? (input.sourceMaterialsUrl?.trim() || null) : undefined,
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
// таблицы/дашборда без открытия полной карточки редактирования.
export async function assignMontageEditor(
  id: string, editorId: string | null
): Promise<{ ok: true; data: MontageProjectDTO } | { ok: false; error: string }> {
  return updateMontageProject(id, {
    editorId,
    // Первое назначение исполнителя сдвигает проект дальше по воронке, но
    // только если он ещё не продвинут вручную дальше "Назначен" — та же
    // защита "только вперёд", что у автоперехода editingRequired.
    status: editorId ? 'ASSIGNED' : undefined,
  })
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
    await prisma.montageProject.create({
      data: {
        orderId,
        title: order.title ?? (clientLabel ? `Монтаж — ${clientLabel}` : null),
        contentType: order.serviceType ?? null,
        status: 'NEEDS_INFO',
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
