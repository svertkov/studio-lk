'use server'

// SMM — действия платформы для направления SMM-ведения студии (см.
// docs/business/SMM.md). Расширяет существующие Client/ScheduleEvent/
// MontageProject/EditorProfile/User — не дублирует их (AGENTS.md, п.1/4).

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import {
  Prisma,
  type SmmProjectStatus, type SmmBillingPeriodType, type SmmServiceType, type SmmPackageUnit, type SmmPackagePeriod,
  type SmmContentStatus, type SmmClientApprovalStatus, type SmmMaterialCategory, type SmmMaterialType, type SmmProjectRole, type SmmWorkType,
  type SmmWorkStatus, type SmmWorkPaymentStatus, type SmmPayoutType, type SmmClientPaymentStatus, type MontageStatus, type PaymentMethod, type EventType,
  type SmmPublicationPlatform, type SmmPublicationStatus, type SmmMetricType, type SmmMetricSource,
} from '@prisma/client'
import { createMontageProject } from '@/lib/actions/montage'
import { MONTAGE_STATUS_LABELS } from '@/lib/montage-model'
import { writeAuditLog, resolveValidUserId } from '@/lib/audit'
import {
  wouldCreateContentParentCycle, getContentMontageShortState, getNearestPublicationInfo, computeContentMaterialsIndicator,
  getSmmContentAttentionReasons, type SmmContentAttentionReason,
} from '@/lib/smm-model'

async function requireStaffSession(): Promise<{ ok: true; userId: string | null } | { ok: false; error: string }> {
  try {
    const session = await auth()
    if (!session?.user) return { ok: false, error: 'Требуется авторизация' }
    return { ok: true, userId: session.user.id ?? null }
  } catch {
    return { ok: false, error: 'Требуется авторизация' }
  }
}

// SMM затрагивает сразу несколько разделов платформы (сам SMM-модуль,
// карточку клиента, монтаж, дашборд) — единая точка инвалидации, тот же
// принцип, что revalidateOrderPaths/revalidateMontagePaths.
function revalidateSmmPaths(clientId?: string | null, smmProjectId?: string | null) {
  revalidatePath('/admin/smm')
  if (smmProjectId) revalidatePath(`/admin/smm/${smmProjectId}`)
  if (clientId) revalidatePath(`/admin/clients/${clientId}`)
  revalidatePath('/admin/dashboard')
}

// ============================================================
// SMM-ПРОЕКТ
// ============================================================

export interface SmmProjectDTO {
  id: string
  clientId: string
  clientName: string | null
  status: SmmProjectStatus
  monthlyFee: number | null
  currency: string
  startDate: string
  endDate: string | null
  billingPeriodType: SmmBillingPeriodType
  paymentTerms: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface SmmProjectInput {
  clientId?: string
  status?: SmmProjectStatus
  monthlyFee?: number | null
  currency?: string
  startDate?: string
  endDate?: string | null
  billingPeriodType?: SmmBillingPeriodType
  paymentTerms?: string | null
  notes?: string | null
  // Явное подтверждение "да, создать ещё один SMM-проект клиенту, у которого
  // уже есть активный" (SMM.md, п.28) — тот же приём, что
  // MontageProjectInput.confirmDuplicateForOrder (см. MONTAGE.md).
  confirmDuplicateForClient?: boolean
}

const SMM_PROJECT_INCLUDE = {
  client: { select: { name: true } },
} as const

type SmmProjectRow = Awaited<ReturnType<typeof prisma.smmProject.findFirstOrThrow<{ include: typeof SMM_PROJECT_INCLUDE }>>>

function toProjectDTO(row: SmmProjectRow): SmmProjectDTO {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.client?.name ?? null,
    status: row.status,
    monthlyFee: row.monthlyFee,
    currency: row.currency,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate?.toISOString() ?? null,
    billingPeriodType: row.billingPeriodType,
    paymentTerms: row.paymentTerms,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function getSmmProjects(): Promise<{ ok: true; data: SmmProjectDTO[] } | { ok: false; data: SmmProjectDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const rows = await prisma.smmProject.findMany({ include: SMM_PROJECT_INCLUDE, orderBy: { createdAt: 'desc' } })
    return { ok: true, data: rows.map(toProjectDTO) }
  } catch (e) {
    console.error('[getSmmProjects]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить SMM-проекты' }
  }
}

export async function getSmmProjectById(id: string): Promise<{ ok: true; data: SmmProjectDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const row = await prisma.smmProject.findUnique({ where: { id }, include: SMM_PROJECT_INCLUDE })
    if (!row) return { ok: false, error: 'SMM-проект не найден' }
    return { ok: true, data: toProjectDTO(row) }
  } catch (e) {
    console.error('[getSmmProjectById]', e)
    return { ok: false, error: 'Не удалось загрузить SMM-проект' }
  }
}

export async function createSmmProject(input: SmmProjectInput): Promise<{ ok: true; data: SmmProjectDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  if (!input.clientId) return { ok: false, error: 'Укажите клиента' }

  try {
    // Защита от случайного дубля активного проекта (SMM.md, п.28) — та же
    // "финальная защита + явное подтверждение", что createMontageProject
    // делает для MontageProject.orderId (см. MONTAGE.md).
    const existingActive = await prisma.smmProject.count({ where: { clientId: input.clientId, status: 'ACTIVE' } })
    if (existingActive > 0 && !input.confirmDuplicateForClient) {
      return { ok: false, error: 'У этого клиента уже есть активный SMM-проект. Подтвердите создание ещё одного.' }
    }

    const created = await prisma.smmProject.create({
      data: {
        clientId: input.clientId,
        status: input.status ?? 'ACTIVE',
        monthlyFee: input.monthlyFee ?? null,
        currency: input.currency?.trim() || 'RUB',
        startDate: input.startDate ? new Date(input.startDate) : new Date(),
        endDate: input.endDate ? new Date(input.endDate) : null,
        billingPeriodType: input.billingPeriodType ?? 'CALENDAR_MONTH',
        paymentTerms: input.paymentTerms?.trim() || null,
        notes: input.notes?.trim() || null,
      },
      include: SMM_PROJECT_INCLUDE,
    })

    await writeAuditLog({ userId: authResult.userId, action: 'SMM_PROJECT_CREATED', entityType: 'SmmProject', entityId: created.id, metadata: { clientId: created.clientId } })
    revalidateSmmPaths(created.clientId, created.id)
    return { ok: true, data: toProjectDTO(created) }
  } catch (e) {
    console.error('[createSmmProject]', e)
    return { ok: false, error: 'Не удалось создать SMM-проект' }
  }
}

export async function updateSmmProject(id: string, input: SmmProjectInput): Promise<{ ok: true; data: SmmProjectDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const updated = await prisma.smmProject.update({
      where: { id },
      data: {
        ...(input.status !== undefined && { status: input.status }),
        ...(input.monthlyFee !== undefined && { monthlyFee: input.monthlyFee }),
        ...(input.currency !== undefined && { currency: input.currency.trim() || 'RUB' }),
        ...(input.startDate !== undefined && { startDate: new Date(input.startDate) }),
        ...(input.endDate !== undefined && { endDate: input.endDate ? new Date(input.endDate) : null }),
        ...(input.billingPeriodType !== undefined && { billingPeriodType: input.billingPeriodType }),
        ...(input.paymentTerms !== undefined && { paymentTerms: input.paymentTerms?.trim() || null }),
        ...(input.notes !== undefined && { notes: input.notes?.trim() || null }),
      },
      include: SMM_PROJECT_INCLUDE,
    })
    await writeAuditLog({ userId: authResult.userId, action: 'SMM_PROJECT_UPDATED', entityType: 'SmmProject', entityId: id, metadata: { fields: Object.keys(input) } })
    revalidateSmmPaths(updated.clientId, id)
    return { ok: true, data: toProjectDTO(updated) }
  } catch (e) {
    console.error('[updateSmmProject]', e)
    return { ok: false, error: 'Не удалось обновить SMM-проект' }
  }
}

// Обогащённая строка списка SMM → Клиенты (SMM.md, п.6) — считается ОДНОЙ
// пакетной выборкой на все проекты разом (не N+1 на строку), тот же принцип
// экономии запросов, что у getAllOrders/getAllMontageProjects.
export interface SmmProjectSummaryDTO extends SmmProjectDTO {
  primaryResponsibleName: string | null
  nextPaymentDate: string | null
  nextPaymentAmount: number | null
  packageDoneCount: number
  packageTargetCount: number
  hasOverdueContent: boolean
}

export async function getSmmProjectsSummary(): Promise<{ ok: true; data: SmmProjectSummaryDTO[] } | { ok: false; data: SmmProjectSummaryDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const projects = await prisma.smmProject.findMany({ include: SMM_PROJECT_INCLUDE, orderBy: { createdAt: 'desc' } })
    const projectIds = projects.map(p => p.id)
    const now = new Date()

    const [members, upcomingPayments, packageItems, contentItems] = await Promise.all([
      prisma.smmProjectMember.findMany({ where: { smmProjectId: { in: projectIds }, activeTo: null }, include: MEMBER_INCLUDE }),
      prisma.smmClientPayment.findMany({ where: { smmProjectId: { in: projectIds }, status: { in: ['PLANNED', 'DUE'] } }, orderBy: { plannedDate: 'asc' } }),
      prisma.smmPackageItem.findMany({ where: { smmProjectId: { in: projectIds }, included: true } }),
      prisma.smmContentItem.findMany({ where: { smmProjectId: { in: projectIds } }, select: { smmProjectId: true, serviceType: true, status: true, deadline: true, plannedPublishDate: true, createdAt: true } }),
    ])

    const data = projects.map(project => {
      const projectMembers = members.filter(m => m.smmProjectId === project.id).map(toMemberDTO)
      const primary = [...projectMembers].sort((a, b) => (a.role === 'OWNER' ? 0 : 1) - (b.role === 'OWNER' ? 0 : 1))[0]
      const nextPayment = upcomingPayments.find(p => p.smmProjectId === project.id)
      const period = computeSmmBillingPeriodInline(project.startDate, project.billingPeriodType, now)
      const projectPackage = packageItems.filter(p => p.smmProjectId === project.id)
      const projectContent = contentItems.filter(c => c.smmProjectId === project.id)
      const packageTargetCount = projectPackage.reduce((sum, p) => sum + (p.quantity ?? 0), 0)
      const packageDoneCount = projectPackage.reduce((sum, p) => {
        const done = projectContent.filter(c => {
          const d = c.plannedPublishDate ?? c.createdAt
          return c.serviceType === p.serviceType && c.status !== 'CANCELLED' && d >= period.start && d <= period.end
        }).length
        return sum + Math.min(done, p.quantity ?? done)
      }, 0)
      const hasOverdueContent = projectContent.some(c => c.deadline && c.deadline < now && c.status !== 'PUBLISHED' && c.status !== 'CANCELLED')

      return {
        ...toProjectDTO(project),
        primaryResponsibleName: primary?.userName ?? null,
        nextPaymentDate: nextPayment?.plannedDate.toISOString() ?? null,
        nextPaymentAmount: nextPayment?.plannedAmount ?? null,
        packageDoneCount,
        packageTargetCount,
        hasOverdueContent,
      }
    })
    return { ok: true, data }
  } catch (e) {
    console.error('[getSmmProjectsSummary]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить сводку по SMM-проектам' }
  }
}

// Локальная копия расчёта периода (без импорта smm-model.ts из actions —
// тот же приём предотвращения цикла, что MontageProjectDTO/type-only импорт
// в montage-model.ts, но здесь проще держать один маленький расчёт инлайн,
// чем городить type-only реэкспорт ради одной функции, используемой только
// в этом агрегате).
function computeSmmBillingPeriodInline(startDate: Date, billingPeriodType: SmmBillingPeriodType, now: Date): { start: Date; end: Date } {
  if (billingPeriodType === 'CALENDAR_MONTH') {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
    }
  }
  const anchorDay = startDate.getDate()
  let periodStart = new Date(now.getFullYear(), now.getMonth(), anchorDay)
  if (periodStart > now) periodStart = new Date(now.getFullYear(), now.getMonth() - 1, anchorDay)
  const periodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, anchorDay)
  periodEnd.setDate(periodEnd.getDate() - 1)
  periodEnd.setHours(23, 59, 59, 999)
  return { start: periodStart, end: periodEnd }
}

// ============================================================
// ПАКЕТ УСЛУГ — конструктор (SMM.md, п.9)
// ============================================================

export interface SmmPackageItemDTO {
  id: string
  smmProjectId: string
  serviceType: SmmServiceType
  customName: string | null
  quantity: number | null
  unit: SmmPackageUnit
  period: SmmPackagePeriod
  description: string | null
  included: boolean
  sortOrder: number
}

export interface SmmPackageItemInput {
  serviceType: SmmServiceType
  customName?: string | null
  quantity?: number | null
  unit?: SmmPackageUnit
  period?: SmmPackagePeriod
  description?: string | null
  included?: boolean
  sortOrder?: number
}

function toPackageItemDTO(row: {
  id: string; smmProjectId: string; serviceType: SmmServiceType; customName: string | null
  quantity: number | null; unit: SmmPackageUnit; period: SmmPackagePeriod; description: string | null
  included: boolean; sortOrder: number
}): SmmPackageItemDTO {
  return { ...row }
}

export async function getSmmPackageItems(smmProjectId: string): Promise<{ ok: true; data: SmmPackageItemDTO[] } | { ok: false; data: SmmPackageItemDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const rows = await prisma.smmPackageItem.findMany({ where: { smmProjectId }, orderBy: { sortOrder: 'asc' } })
    return { ok: true, data: rows.map(toPackageItemDTO) }
  } catch (e) {
    console.error('[getSmmPackageItems]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить пакет услуг' }
  }
}

export async function addSmmPackageItem(smmProjectId: string, input: SmmPackageItemInput): Promise<{ ok: true; data: SmmPackageItemDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const maxSort = await prisma.smmPackageItem.aggregate({ where: { smmProjectId }, _max: { sortOrder: true } })
    const project = await prisma.smmProject.findUnique({ where: { id: smmProjectId }, select: { clientId: true } })
    const created = await prisma.smmPackageItem.create({
      data: {
        smmProjectId,
        serviceType: input.serviceType,
        customName: input.serviceType === 'OTHER' ? (input.customName?.trim() || null) : null,
        quantity: input.quantity ?? null,
        unit: input.unit ?? 'PIECE',
        period: input.period ?? 'MONTH',
        description: input.description?.trim() || null,
        included: input.included ?? true,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
    })
    revalidateSmmPaths(project?.clientId, smmProjectId)
    return { ok: true, data: toPackageItemDTO(created) }
  } catch (e) {
    console.error('[addSmmPackageItem]', e)
    return { ok: false, error: 'Не удалось добавить пункт пакета' }
  }
}

export async function updateSmmPackageItem(id: string, input: SmmPackageItemInput): Promise<{ ok: true; data: SmmPackageItemDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const nextServiceType = input.serviceType
    const updated = await prisma.smmPackageItem.update({
      where: { id },
      data: {
        ...(input.serviceType !== undefined && { serviceType: input.serviceType }),
        ...(input.customName !== undefined && { customName: nextServiceType === 'OTHER' ? (input.customName?.trim() || null) : null }),
        ...(input.quantity !== undefined && { quantity: input.quantity }),
        ...(input.unit !== undefined && { unit: input.unit }),
        ...(input.period !== undefined && { period: input.period }),
        ...(input.description !== undefined && { description: input.description?.trim() || null }),
        ...(input.included !== undefined && { included: input.included }),
      },
      include: { smmProject: { select: { clientId: true } } },
    })
    revalidateSmmPaths(updated.smmProject.clientId, updated.smmProjectId)
    return { ok: true, data: toPackageItemDTO(updated) }
  } catch (e) {
    console.error('[updateSmmPackageItem]', e)
    return { ok: false, error: 'Не удалось обновить пункт пакета' }
  }
}

export async function deleteSmmPackageItem(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const deleted = await prisma.smmPackageItem.delete({ where: { id }, include: { smmProject: { select: { clientId: true } } } })
    revalidateSmmPaths(deleted.smmProject.clientId, deleted.smmProjectId)
    return { ok: true }
  } catch (e) {
    console.error('[deleteSmmPackageItem]', e)
    return { ok: false, error: 'Не удалось удалить пункт пакета' }
  }
}

// ============================================================
// ЕДИНИЦЫ КОНТЕНТА (SMM.md, п.11/12/13)
// ============================================================

export interface SmmContentItemDTO {
  id: string
  smmProjectId: string
  serviceType: SmmServiceType
  customServiceType: string | null
  title: string | null
  description: string | null
  // ТЗ исполнителю ("Монтаж с 2:58...") — отдельно от description
  // (концепция/идея материала), см. schema.prisma.
  productionBrief: string | null
  plannedPublishDate: string | null
  deadline: string | null
  status: SmmContentStatus
  responsibleUserId: string | null
  responsibleUserName: string | null
  editorId: string | null
  editorName: string | null
  // Связанный проект монтажа (SMM.md, п.13) — статус/готовый файл читаются
  // ЧЕРЕЗ реальный MontageProject, не копируются в отдельные поля здесь
  // (иначе два места правды для одного и того же ролика).
  editingProjectId: string | null
  editingProjectStatus: MontageStatus | null
  editingProjectStatusLabel: string | null
  editingProjectDeliveryUrl: string | null
  // [DEPRECATED, 2A] см. schema.prisma — источник правды теперь scheduleEvents ниже.
  scheduleEventId: string | null
  scheduleEvents: { linkId: string; scheduleEventId: string; title: string | null; startAt: string | null }[]
  // [DEPRECATED, 2A] источник правды теперь SmmMaterialLink (см. schema.prisma).
  sourceUrl: string | null
  // [DEPRECATED, 2A] источник правды теперь editingProjectDeliveryUrl или
  // SmmMaterialLink с materialType=MASTER (см. schema.prisma).
  resultUrl: string | null
  // [DEPRECATED, 2A] источник правды теперь publications[].url (см. schema.prisma).
  publishedUrl: string | null
  // Постоянный человекочитаемый бизнес-идентификатор ("Д186") — НЕ индекс
  // файла монтажёра, физически та же колонка, что раньше называлась
  // indexCode (см. schema.prisma).
  contentCode: string | null
  parentContentId: string | null
  parentContentTitle: string | null
  parentContentCode: string | null
  childContent: { id: string; title: string | null; contentCode: string | null }[]
  publications: SmmPublicationDTO[]
  clientApprovalStatus: SmmClientApprovalStatus
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface SmmContentItemInput {
  serviceType?: SmmServiceType
  customServiceType?: string | null
  title?: string | null
  description?: string | null
  productionBrief?: string | null
  plannedPublishDate?: string | null
  deadline?: string | null
  status?: SmmContentStatus
  responsibleUserId?: string | null
  editorId?: string | null
  parentContentId?: string | null
  contentCode?: string | null
  // Legacy-поля (2A, deprecated) — принимаются на вход только ради обратной
  // совместимости уже написанного кода/будущих скриптов миграции истории;
  // новый UI их больше не выставляет (см. SmmProjectContentTab.tsx).
  scheduleEventId?: string | null
  sourceUrl?: string | null
  resultUrl?: string | null
  publishedUrl?: string | null
  clientApprovalStatus?: SmmClientApprovalStatus
  notes?: string | null
}

const CONTENT_ITEM_INCLUDE = {
  responsibleUser: { select: { name: true, email: true } },
  editor: { select: { displayName: true } },
  editingProject: { select: { status: true, deliveryUrl: true } },
  parentContent: { select: { title: true, contentCode: true } },
  childContent: { select: { id: true, title: true, contentCode: true }, orderBy: { createdAt: 'asc' } },
  scheduleLinks: { include: { scheduleEvent: { select: { id: true, title: true, startAt: true } } }, orderBy: { createdAt: 'desc' } },
  publications: { include: { metrics: { orderBy: { capturedAt: 'desc' } } }, orderBy: { createdAt: 'asc' } },
} as const

type ContentItemRow = Awaited<ReturnType<typeof prisma.smmContentItem.findFirstOrThrow<{ include: typeof CONTENT_ITEM_INCLUDE }>>>

function toContentItemDTO(row: ContentItemRow): SmmContentItemDTO {
  return {
    id: row.id,
    smmProjectId: row.smmProjectId,
    serviceType: row.serviceType,
    customServiceType: row.customServiceType,
    title: row.title,
    description: row.description,
    productionBrief: row.productionBrief,
    plannedPublishDate: row.plannedPublishDate?.toISOString() ?? null,
    deadline: row.deadline?.toISOString() ?? null,
    status: row.status,
    responsibleUserId: row.responsibleUserId,
    responsibleUserName: row.responsibleUser?.name ?? row.responsibleUser?.email ?? null,
    editorId: row.editorId,
    editorName: row.editor?.displayName ?? null,
    editingProjectId: row.editingProjectId,
    editingProjectStatus: row.editingProject?.status ?? null,
    editingProjectStatusLabel: row.editingProject ? MONTAGE_STATUS_LABELS[row.editingProject.status] : null,
    editingProjectDeliveryUrl: row.editingProject?.deliveryUrl ?? null,
    scheduleEventId: row.scheduleEventId,
    scheduleEvents: row.scheduleLinks.map(l => ({
      linkId: l.id, scheduleEventId: l.scheduleEventId, title: l.scheduleEvent.title, startAt: l.scheduleEvent.startAt?.toISOString() ?? null,
    })),
    sourceUrl: row.sourceUrl,
    resultUrl: row.resultUrl,
    publishedUrl: row.publishedUrl,
    contentCode: row.contentCode,
    parentContentId: row.parentContentId,
    parentContentTitle: row.parentContent?.title ?? null,
    parentContentCode: row.parentContent?.contentCode ?? null,
    childContent: row.childContent.map(c => ({ id: c.id, title: c.title, contentCode: c.contentCode })),
    publications: row.publications.map(toPublicationDTO),
    clientApprovalStatus: row.clientApprovalStatus,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function getSmmContentItems(smmProjectId: string): Promise<{ ok: true; data: SmmContentItemDTO[] } | { ok: false; data: SmmContentItemDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const rows = await prisma.smmContentItem.findMany({ where: { smmProjectId }, include: CONTENT_ITEM_INCLUDE, orderBy: { createdAt: 'desc' } })
    return { ok: true, data: rows.map(toContentItemDTO) }
  } catch (e) {
    console.error('[getSmmContentItems]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить контент' }
  }
}

// Все единицы контента платформы, с фильтрами — основа будущего общего
// контент-плана (SMM.md, п.23), используется страницей SMM → Контент.
export async function getAllSmmContentItems(): Promise<{ ok: true; data: SmmContentItemDTO[] } | { ok: false; data: SmmContentItemDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const rows = await prisma.smmContentItem.findMany({ include: CONTENT_ITEM_INCLUDE, orderBy: { createdAt: 'desc' } })
    return { ok: true, data: rows.map(toContentItemDTO) }
  } catch (e) {
    console.error('[getAllSmmContentItems]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить контент' }
  }
}

export async function createSmmContentItem(smmProjectId: string, input: SmmContentItemInput): Promise<{ ok: true; data: SmmContentItemDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  if (!input.serviceType) return { ok: false, error: 'Укажите тип контента' }
  try {
    const project = await prisma.smmProject.findUnique({ where: { id: smmProjectId }, select: { clientId: true } })
    if (!project) return { ok: false, error: 'SMM-проект не найден' }
    // Новая единица контента не может быть чьим-то предком (id ещё не
    // существует) — цикл здесь невозможен по определению, достаточно
    // проверить, что родитель принадлежит тому же проекту.
    if (input.parentContentId) {
      const parent = await prisma.smmContentItem.findUnique({ where: { id: input.parentContentId }, select: { smmProjectId: true } })
      if (!parent || parent.smmProjectId !== smmProjectId) return { ok: false, error: 'Родительская единица контента не найдена в этом проекте' }
    }
    const created = await prisma.smmContentItem.create({
      data: {
        smmProjectId,
        serviceType: input.serviceType,
        customServiceType: input.serviceType === 'OTHER' ? (input.customServiceType?.trim() || null) : null,
        title: input.title?.trim() || null,
        description: input.description?.trim() || null,
        productionBrief: input.productionBrief?.trim() || null,
        plannedPublishDate: input.plannedPublishDate ? new Date(input.plannedPublishDate) : null,
        deadline: input.deadline ? new Date(input.deadline) : null,
        status: input.status ?? 'IDEA',
        responsibleUserId: input.responsibleUserId || null,
        editorId: input.editorId || null,
        parentContentId: input.parentContentId || null,
        contentCode: input.contentCode?.trim() || null,
        scheduleEventId: input.scheduleEventId || null,
        sourceUrl: input.sourceUrl?.trim() || null,
        resultUrl: input.resultUrl?.trim() || null,
        publishedUrl: input.publishedUrl?.trim() || null,
        clientApprovalStatus: input.clientApprovalStatus ?? 'NOT_REQUIRED',
        notes: input.notes?.trim() || null,
      },
      include: CONTENT_ITEM_INCLUDE,
    })
    revalidateSmmPaths(project.clientId, smmProjectId)
    return { ok: true, data: toContentItemDTO(created) }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { ok: false, error: 'Такой Content Code уже используется в этом проекте' }
    }
    console.error('[createSmmContentItem]', e)
    return { ok: false, error: 'Не удалось создать единицу контента' }
  }
}

export async function updateSmmContentItem(id: string, input: SmmContentItemInput): Promise<{ ok: true; data: SmmContentItemDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const nextServiceType = input.serviceType
    // Защита от self-reference/цикла (ТЗ 2A, п.16) — только когда parent
    // реально меняется на непустое значение; снятие родителя (null) цикл
    // создать не может.
    if (input.parentContentId !== undefined && input.parentContentId) {
      const current = await prisma.smmContentItem.findUnique({ where: { id }, select: { smmProjectId: true } })
      if (!current) return { ok: false, error: 'Единица контента не найдена' }
      const siblings = await prisma.smmContentItem.findMany({ where: { smmProjectId: current.smmProjectId }, select: { id: true, parentContentId: true } })
      if (!siblings.some(s => s.id === input.parentContentId)) {
        return { ok: false, error: 'Родительская единица контента не найдена в этом проекте' }
      }
      if (wouldCreateContentParentCycle(siblings, id, input.parentContentId)) {
        return { ok: false, error: 'Нельзя назначить эту единицу родителем — это создаст цикл' }
      }
    }
    const updated = await prisma.smmContentItem.update({
      where: { id },
      data: {
        ...(input.serviceType !== undefined && { serviceType: input.serviceType }),
        ...(input.customServiceType !== undefined && { customServiceType: nextServiceType === 'OTHER' ? (input.customServiceType?.trim() || null) : null }),
        ...(input.title !== undefined && { title: input.title?.trim() || null }),
        ...(input.description !== undefined && { description: input.description?.trim() || null }),
        ...(input.productionBrief !== undefined && { productionBrief: input.productionBrief?.trim() || null }),
        ...(input.plannedPublishDate !== undefined && { plannedPublishDate: input.plannedPublishDate ? new Date(input.plannedPublishDate) : null }),
        ...(input.deadline !== undefined && { deadline: input.deadline ? new Date(input.deadline) : null }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.responsibleUserId !== undefined && { responsibleUserId: input.responsibleUserId || null }),
        ...(input.editorId !== undefined && { editorId: input.editorId || null }),
        ...(input.parentContentId !== undefined && { parentContentId: input.parentContentId || null }),
        ...(input.contentCode !== undefined && { contentCode: input.contentCode?.trim() || null }),
        ...(input.scheduleEventId !== undefined && { scheduleEventId: input.scheduleEventId || null }),
        ...(input.sourceUrl !== undefined && { sourceUrl: input.sourceUrl?.trim() || null }),
        ...(input.resultUrl !== undefined && { resultUrl: input.resultUrl?.trim() || null }),
        ...(input.publishedUrl !== undefined && { publishedUrl: input.publishedUrl?.trim() || null }),
        ...(input.clientApprovalStatus !== undefined && { clientApprovalStatus: input.clientApprovalStatus }),
        ...(input.notes !== undefined && { notes: input.notes?.trim() || null }),
      },
      include: { ...CONTENT_ITEM_INCLUDE, smmProject: { select: { clientId: true } } },
    })
    revalidateSmmPaths(updated.smmProject.clientId, updated.smmProjectId)
    return { ok: true, data: toContentItemDTO(updated) }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { ok: false, error: 'Такой Content Code уже используется в этом проекте' }
    }
    console.error('[updateSmmContentItem]', e)
    return { ok: false, error: 'Не удалось обновить единицу контента' }
  }
}

export async function deleteSmmContentItem(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const deleted = await prisma.smmContentItem.delete({ where: { id }, include: { smmProject: { select: { clientId: true } } } })
    revalidateSmmPaths(deleted.smmProject.clientId, deleted.smmProjectId)
    return { ok: true }
  } catch (e) {
    console.error('[deleteSmmContentItem]', e)
    return { ok: false, error: 'Не удалось удалить единицу контента' }
  }
}

// "Контент передан монтажёру" (SMM.md, п.13) — создаёт САМОСТОЯТЕЛЬНЫЙ
// MontageProject (переиспользует createMontageProject из actions/montage.ts
// напрямую, не копирует его логику) и связывает его с этой единицей
// контента. Не создаёт вторую независимую систему монтажа внутри SMM.
// Статусы, из которых передача в монтаж переводит контент в IN_EDIT
// автоматически (ТЗ 2B, «Передать в монтаж») — расширено с этапа 1
// (раньше только IDEA/PLANNED) реальным найденным пробелом: контент,
// переданный в монтаж уже ПОСЛЕ съёмки (WAITING_FOR_SHOOT/SHOT — обычный
// рабочий путь), раньше оставался в старом статусе, хотя монтаж уже начался.
const STATUSES_AUTO_TRANSITION_TO_IN_EDIT: SmmContentStatus[] = ['IDEA', 'PLANNED', 'WAITING_FOR_SHOOT', 'SHOT']

export interface LinkSmmContentToMontageInput {
  // undefined — использовать уже назначенного ContentItem.editorId (если
  // есть); null — явно передать в монтаж без монтажёра; string — назначить.
  editorId?: string | null
  deadlineDate?: string | null
  // Оплачиваемая работа создаётся ТОЛЬКО когда пользователь явно указал
  // сумму — ТЗ 2B, п.26: "не создавать неоплачиваемую работу с 0₽ просто
  // ради автоматизации". Без workAmount SmmWorkItem не создаётся вовсе.
  workAmount?: number | null
  workType?: SmmWorkType
}

// "Контент передан монтажёру" (SMM.md, п.13) — создаёт САМОСТОЯТЕЛЬНЫЙ
// MontageProject (переиспользует createMontageProject из actions/montage.ts
// напрямую, не копирует его логику) и связывает его с этой единицей
// контента. Не создаёт вторую независимую систему монтажа внутри SMM.
export async function linkSmmContentToMontage(
  contentItemId: string, input: LinkSmmContentToMontageInput = {},
): Promise<{ ok: true; data: SmmContentItemDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const content = await prisma.smmContentItem.findUnique({
      where: { id: contentItemId },
      include: { smmProject: { select: { clientId: true } } },
    })
    if (!content) return { ok: false, error: 'Единица контента не найдена' }
    if (content.editingProjectId) return { ok: false, error: 'Контент уже связан с проектом монтажа' }

    const montageEditorId = input.editorId !== undefined ? input.editorId : content.editorId

    const montageResult = await createMontageProject({
      clientId: content.smmProject.clientId,
      title: content.title || undefined,
      description: content.description || undefined,
      requirements: content.productionBrief || undefined,
      editorId: montageEditorId || undefined,
      deadlineType: input.deadlineDate ? 'FIXED_DATE' : undefined,
      deadlineDate: input.deadlineDate || undefined,
    })
    if (!montageResult.ok) return { ok: false, error: montageResult.error }

    const updated = await prisma.smmContentItem.update({
      where: { id: contentItemId },
      data: {
        editingProjectId: montageResult.data.id,
        status: STATUSES_AUTO_TRANSITION_TO_IN_EDIT.includes(content.status) ? 'IN_EDIT' : content.status,
      },
      include: CONTENT_ITEM_INCLUDE,
    })

    if (input.workAmount != null && montageEditorId) {
      const createdById = await resolveValidUserId(prisma, authResult.userId)
      await prisma.smmWorkItem.create({
        data: {
          smmProjectId: content.smmProjectId,
          performerId: montageEditorId,
          contentItemId,
          editingProjectId: montageResult.data.id,
          workType: input.workType ?? 'EDITING',
          workDate: new Date(),
          amount: input.workAmount,
          status: 'DRAFT',
          createdById,
        },
      })
      revalidatePath('/admin/smm/payouts')
    }

    revalidateSmmPaths(content.smmProject.clientId, content.smmProjectId)
    revalidatePath('/admin/editing')
    return { ok: true, data: toContentItemDTO(updated) }
  } catch (e) {
    console.error('[linkSmmContentToMontage]', e)
    return { ok: false, error: 'Не удалось связать с проектом монтажа' }
  }
}

// ============================================================
// ПУБЛИКАЦИИ (2A, SMM.md, «SmmContentItem → SmmPublication») — одна
// единица контента может быть опубликована на нескольких площадках
// одновременно (Instagram/Telegram/VK/YouTube — разные строки), у каждой
// своя дата/URL/статус, независимый от production-статуса ContentItem.
// ============================================================

export interface SmmPublicationMetricDTO {
  id: string
  publicationId: string
  metricType: SmmMetricType
  value: number
  capturedAt: string
  source: SmmMetricSource
  createdAt: string
}

export interface SmmPublicationMetricInput {
  metricType: SmmMetricType
  value: number
  capturedAt?: string
  source?: SmmMetricSource
}

export interface SmmPublicationDTO {
  id: string
  contentItemId: string
  platform: SmmPublicationPlatform
  customPlatform: string | null
  status: SmmPublicationStatus
  plannedPublishAt: string | null
  publishedAt: string | null
  url: string | null
  externalId: string | null
  titleOverride: string | null
  caption: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  metrics: SmmPublicationMetricDTO[]
}

export interface SmmPublicationInput {
  platform: SmmPublicationPlatform
  customPlatform?: string | null
  status?: SmmPublicationStatus
  plannedPublishAt?: string | null
  publishedAt?: string | null
  url?: string | null
  externalId?: string | null
  titleOverride?: string | null
  caption?: string | null
  notes?: string | null
}

function toMetricDTO(row: {
  id: string; publicationId: string; metricType: SmmMetricType; value: number
  capturedAt: Date; source: SmmMetricSource; createdAt: Date
}): SmmPublicationMetricDTO {
  return {
    id: row.id,
    publicationId: row.publicationId,
    metricType: row.metricType,
    value: row.value,
    capturedAt: row.capturedAt.toISOString(),
    source: row.source,
    createdAt: row.createdAt.toISOString(),
  }
}

const PUBLICATION_INCLUDE = { metrics: { orderBy: { capturedAt: 'desc' } } } as const
type PublicationRow = Awaited<ReturnType<typeof prisma.smmPublication.findFirstOrThrow<{ include: typeof PUBLICATION_INCLUDE }>>>

function toPublicationDTO(row: PublicationRow): SmmPublicationDTO {
  return {
    id: row.id,
    contentItemId: row.contentItemId,
    platform: row.platform,
    customPlatform: row.customPlatform,
    status: row.status,
    plannedPublishAt: row.plannedPublishAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    url: row.url,
    externalId: row.externalId,
    titleOverride: row.titleOverride,
    caption: row.caption,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    metrics: row.metrics.map(toMetricDTO),
  }
}

export async function addSmmPublication(contentItemId: string, input: SmmPublicationInput): Promise<{ ok: true; data: SmmPublicationDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const content = await prisma.smmContentItem.findUnique({ where: { id: contentItemId }, include: { smmProject: { select: { clientId: true } } } })
    if (!content) return { ok: false, error: 'Единица контента не найдена' }
    const created = await prisma.smmPublication.create({
      data: {
        contentItemId,
        platform: input.platform,
        customPlatform: input.platform === 'OTHER' ? (input.customPlatform?.trim() || null) : null,
        status: input.status ?? 'PLANNED',
        plannedPublishAt: input.plannedPublishAt ? new Date(input.plannedPublishAt) : null,
        publishedAt: input.publishedAt ? new Date(input.publishedAt) : null,
        url: input.url?.trim() || null,
        externalId: input.externalId?.trim() || null,
        titleOverride: input.titleOverride?.trim() || null,
        caption: input.caption?.trim() || null,
        notes: input.notes?.trim() || null,
      },
      include: PUBLICATION_INCLUDE,
    })
    revalidateSmmPaths(content.smmProject.clientId, content.smmProjectId)
    return { ok: true, data: toPublicationDTO(created) }
  } catch (e) {
    console.error('[addSmmPublication]', e)
    return { ok: false, error: 'Не удалось добавить публикацию' }
  }
}

// Partial<...> — эта функция ВСЕГДА была частичным обновлением (каждое
// поле применяется только когда input.field !== undefined, см. ниже), но
// была типизирована как требующая обязательный platform — реальная
// неточность типа, обнаруженная 2B при первом genuинно частичном вызове
// (быстрая публикация меняет только status/url/publishedAt). addSmmPublication
// (создание) продолжает требовать полный SmmPublicationInput — это разные
// сигнатуры не случайно.
export async function updateSmmPublication(id: string, input: Partial<SmmPublicationInput>): Promise<{ ok: true; data: SmmPublicationDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const nextPlatform = input.platform
    const updated = await prisma.smmPublication.update({
      where: { id },
      data: {
        ...(input.platform !== undefined && { platform: input.platform }),
        ...(input.customPlatform !== undefined && { customPlatform: nextPlatform === 'OTHER' ? (input.customPlatform?.trim() || null) : null }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.plannedPublishAt !== undefined && { plannedPublishAt: input.plannedPublishAt ? new Date(input.plannedPublishAt) : null }),
        ...(input.publishedAt !== undefined && { publishedAt: input.publishedAt ? new Date(input.publishedAt) : null }),
        ...(input.url !== undefined && { url: input.url?.trim() || null }),
        ...(input.externalId !== undefined && { externalId: input.externalId?.trim() || null }),
        ...(input.titleOverride !== undefined && { titleOverride: input.titleOverride?.trim() || null }),
        ...(input.caption !== undefined && { caption: input.caption?.trim() || null }),
        ...(input.notes !== undefined && { notes: input.notes?.trim() || null }),
      },
      include: { ...PUBLICATION_INCLUDE, contentItem: { include: { smmProject: { select: { clientId: true } } } } },
    })
    revalidateSmmPaths(updated.contentItem.smmProject.clientId, updated.contentItem.smmProjectId)
    return { ok: true, data: toPublicationDTO(updated) }
  } catch (e) {
    console.error('[updateSmmPublication]', e)
    return { ok: false, error: 'Не удалось обновить публикацию' }
  }
}

export async function deleteSmmPublication(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const deleted = await prisma.smmPublication.delete({ where: { id }, include: { contentItem: { include: { smmProject: { select: { clientId: true } } } } } })
    revalidateSmmPaths(deleted.contentItem.smmProject.clientId, deleted.contentItem.smmProjectId)
    return { ok: true }
  } catch (e) {
    console.error('[deleteSmmPublication]', e)
    return { ok: false, error: 'Не удалось удалить публикацию' }
  }
}

// Снимок метрики — ВСЕГДА добавление новой строки, никогда не
// перезаписывает существующую (SMM.md, «Metrics snapshots»): история
// набора просмотров/лайков сохраняется по capturedAt.
export async function addSmmPublicationMetric(publicationId: string, input: SmmPublicationMetricInput): Promise<{ ok: true; data: SmmPublicationMetricDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const publication = await prisma.smmPublication.findUnique({
      where: { id: publicationId },
      include: { contentItem: { include: { smmProject: { select: { clientId: true } } } } },
    })
    if (!publication) return { ok: false, error: 'Публикация не найдена' }
    const createdById = await resolveValidUserId(prisma, authResult.userId)
    const created = await prisma.smmPublicationMetric.create({
      data: {
        publicationId,
        metricType: input.metricType,
        value: input.value,
        capturedAt: input.capturedAt ? new Date(input.capturedAt) : new Date(),
        source: input.source ?? 'MANUAL',
        createdById,
      },
    })
    revalidateSmmPaths(publication.contentItem.smmProject.clientId, publication.contentItem.smmProjectId)
    return { ok: true, data: toMetricDTO(created) }
  } catch (e) {
    console.error('[addSmmPublicationMetric]', e)
    return { ok: false, error: 'Не удалось добавить метрику' }
  }
}

export async function deleteSmmPublicationMetric(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const deleted = await prisma.smmPublicationMetric.delete({
      where: { id },
      include: { publication: { include: { contentItem: { include: { smmProject: { select: { clientId: true } } } } } } },
    })
    revalidateSmmPaths(deleted.publication.contentItem.smmProject.clientId, deleted.publication.contentItem.smmProjectId)
    return { ok: true }
  } catch (e) {
    console.error('[deleteSmmPublicationMetric]', e)
    return { ok: false, error: 'Не удалось удалить метрику' }
  }
}

// ============================================================
// СВЯЗЬ ЕДИНИЦЫ КОНТЕНТА СО СЪЁМКАМИ — many-to-many (2A, SMM.md, «Content ↔
// ScheduleEvent»). НЕ то же самое, что SmmScheduleLink (тот на уровне
// ПРОЕКТА, для вкладки «Съёмки»/пакета) — здесь одна съёмка легитимно
// связана сразу с несколькими единицами контента, и наоборот.
// ============================================================

// Записи расписания клиента, ещё НЕ привязанные к ЭТОЙ конкретной единице
// контента (в отличие от getUnlinkedScheduleEventsForClient выше — та
// исключает съёмки, уже занятые ЛЮБЫМ SMM-проектом целиком; здесь одна и
// та же съёмка может быть законно предложена для нескольких ContentItem).
export async function getClientScheduleEventsForContentLink(
  clientId: string, contentItemId: string,
): Promise<{ ok: true; data: { id: string; title: string | null; startAt: string | null }[] } | { ok: false; data: never[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const rows = await prisma.scheduleEvent.findMany({
      where: { clientId, smmContentScheduleLinks: { none: { contentItemId } } },
      select: { id: true, title: true, startAt: true },
      orderBy: { startAt: 'desc' },
      take: 50,
    })
    return { ok: true, data: rows.map(r => ({ id: r.id, title: r.title, startAt: r.startAt?.toISOString() ?? null })) }
  } catch (e) {
    console.error('[getClientScheduleEventsForContentLink]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить съёмки клиента' }
  }
}

export async function addSmmContentScheduleLink(
  contentItemId: string, scheduleEventId: string,
): Promise<{ ok: true; data: { linkId: string; scheduleEventId: string; title: string | null; startAt: string | null } } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const content = await prisma.smmContentItem.findUnique({ where: { id: contentItemId }, include: { smmProject: { select: { clientId: true } } } })
    if (!content) return { ok: false, error: 'Единица контента не найдена' }
    const created = await prisma.smmContentScheduleLink.create({
      data: { contentItemId, scheduleEventId },
      include: { scheduleEvent: { select: { title: true, startAt: true } } },
    })
    revalidateSmmPaths(content.smmProject.clientId, content.smmProjectId)
    return { ok: true, data: { linkId: created.id, scheduleEventId: created.scheduleEventId, title: created.scheduleEvent.title, startAt: created.scheduleEvent.startAt?.toISOString() ?? null } }
  } catch (e) {
    console.error('[addSmmContentScheduleLink]', e)
    return { ok: false, error: 'Не удалось привязать съёмку' }
  }
}

export async function removeSmmContentScheduleLink(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const deleted = await prisma.smmContentScheduleLink.delete({
      where: { id },
      include: { contentItem: { include: { smmProject: { select: { clientId: true } } } } },
    })
    revalidateSmmPaths(deleted.contentItem.smmProject.clientId, deleted.contentItem.smmProjectId)
    return { ok: true }
  } catch (e) {
    console.error('[removeSmmContentScheduleLink]', e)
    return { ok: false, error: 'Не удалось отвязать съёмку' }
  }
}

// ============================================================
// МАТЕРИАЛЫ (SMM.md, п.16)
// ============================================================

export interface SmmMaterialLinkDTO {
  id: string
  smmProjectId: string
  category: SmmMaterialCategory
  materialType: SmmMaterialType | null
  title: string
  url: string
  description: string | null
  relatedContentId: string | null
  relatedScheduleEventId: string | null
  createdByName: string | null
  createdAt: string
}

export interface SmmMaterialLinkInput {
  category: SmmMaterialCategory
  materialType?: SmmMaterialType | null
  title: string
  url: string
  description?: string | null
  relatedContentId?: string | null
  relatedScheduleEventId?: string | null
}

const MATERIAL_LINK_INCLUDE = { createdBy: { select: { name: true, email: true } } } as const
type MaterialLinkRow = Awaited<ReturnType<typeof prisma.smmMaterialLink.findFirstOrThrow<{ include: typeof MATERIAL_LINK_INCLUDE }>>>

function toMaterialLinkDTO(row: MaterialLinkRow): SmmMaterialLinkDTO {
  return {
    id: row.id,
    smmProjectId: row.smmProjectId,
    category: row.category,
    materialType: row.materialType,
    title: row.title,
    url: row.url,
    description: row.description,
    relatedContentId: row.relatedContentId,
    relatedScheduleEventId: row.relatedScheduleEventId,
    createdByName: row.createdBy?.name ?? row.createdBy?.email ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function getSmmMaterialLinks(smmProjectId: string): Promise<{ ok: true; data: SmmMaterialLinkDTO[] } | { ok: false; data: SmmMaterialLinkDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const rows = await prisma.smmMaterialLink.findMany({ where: { smmProjectId }, include: MATERIAL_LINK_INCLUDE, orderBy: { createdAt: 'desc' } })
    return { ok: true, data: rows.map(toMaterialLinkDTO) }
  } catch (e) {
    console.error('[getSmmMaterialLinks]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить материалы' }
  }
}

export async function addSmmMaterialLink(smmProjectId: string, input: SmmMaterialLinkInput): Promise<{ ok: true; data: SmmMaterialLinkDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  if (!input.title.trim() || !input.url.trim()) return { ok: false, error: 'Укажите название и ссылку' }
  try {
    const project = await prisma.smmProject.findUnique({ where: { id: smmProjectId }, select: { clientId: true } })
    if (!project) return { ok: false, error: 'SMM-проект не найден' }
    const createdById = await resolveValidUserId(prisma, authResult.userId)
    const created = await prisma.smmMaterialLink.create({
      data: {
        smmProjectId,
        category: input.category,
        materialType: input.materialType ?? null,
        title: input.title.trim(),
        url: input.url.trim(),
        description: input.description?.trim() || null,
        relatedContentId: input.relatedContentId || null,
        relatedScheduleEventId: input.relatedScheduleEventId || null,
        createdById,
      },
      include: MATERIAL_LINK_INCLUDE,
    })
    revalidateSmmPaths(project.clientId, smmProjectId)
    return { ok: true, data: toMaterialLinkDTO(created) }
  } catch (e) {
    console.error('[addSmmMaterialLink]', e)
    return { ok: false, error: 'Не удалось добавить материал' }
  }
}

export async function updateSmmMaterialLink(id: string, input: SmmMaterialLinkInput): Promise<{ ok: true; data: SmmMaterialLinkDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const updated = await prisma.smmMaterialLink.update({
      where: { id },
      data: {
        category: input.category,
        materialType: input.materialType ?? null,
        title: input.title.trim(),
        url: input.url.trim(),
        description: input.description?.trim() || null,
        relatedContentId: input.relatedContentId || null,
      },
      include: { ...MATERIAL_LINK_INCLUDE, smmProject: { select: { clientId: true } } },
    })
    revalidateSmmPaths(updated.smmProject.clientId, updated.smmProjectId)
    return { ok: true, data: toMaterialLinkDTO(updated) }
  } catch (e) {
    console.error('[updateSmmMaterialLink]', e)
    return { ok: false, error: 'Не удалось обновить материал' }
  }
}

export async function deleteSmmMaterialLink(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const deleted = await prisma.smmMaterialLink.delete({ where: { id }, include: { smmProject: { select: { clientId: true } } } })
    revalidateSmmPaths(deleted.smmProject.clientId, deleted.smmProjectId)
    return { ok: true }
  } catch (e) {
    console.error('[deleteSmmMaterialLink]', e)
    return { ok: false, error: 'Не удалось удалить материал' }
  }
}

// ============================================================
// КОМАНДА ПРОЕКТА (SMM.md, п.17)
// ============================================================

export interface SmmProjectMemberDTO {
  id: string
  smmProjectId: string
  userId: string
  userName: string
  role: SmmProjectRole
  activeFrom: string
  activeTo: string | null
  notes: string | null
}

const MEMBER_INCLUDE = { user: { select: { name: true, email: true } } } as const
type MemberRow = Awaited<ReturnType<typeof prisma.smmProjectMember.findFirstOrThrow<{ include: typeof MEMBER_INCLUDE }>>>

function toMemberDTO(row: MemberRow): SmmProjectMemberDTO {
  return {
    id: row.id,
    smmProjectId: row.smmProjectId,
    userId: row.userId,
    userName: row.user.name ?? row.user.email,
    role: row.role,
    activeFrom: row.activeFrom.toISOString(),
    activeTo: row.activeTo?.toISOString() ?? null,
    notes: row.notes,
  }
}

export async function getSmmProjectMembers(smmProjectId: string): Promise<{ ok: true; data: SmmProjectMemberDTO[] } | { ok: false; data: SmmProjectMemberDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const rows = await prisma.smmProjectMember.findMany({ where: { smmProjectId }, include: MEMBER_INCLUDE, orderBy: { activeFrom: 'asc' } })
    return { ok: true, data: rows.map(toMemberDTO) }
  } catch (e) {
    console.error('[getSmmProjectMembers]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить команду' }
  }
}

// Все активные участия по всем проектам разом — основа сводного раздела
// SMM → Команда (SMM.md, п.4/17): "кто на каких проектах", не по одному
// проекту за раз.
export interface SmmProjectMembershipDTO extends SmmProjectMemberDTO {
  clientName: string | null
}

export async function getAllActiveSmmProjectMembers(): Promise<{ ok: true; data: SmmProjectMembershipDTO[] } | { ok: false; data: SmmProjectMembershipDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const rows = await prisma.smmProjectMember.findMany({
      where: { activeTo: null },
      include: { ...MEMBER_INCLUDE, smmProject: { select: { client: { select: { name: true } } } } },
      orderBy: { activeFrom: 'asc' },
    })
    return { ok: true, data: rows.map(row => ({ ...toMemberDTO(row), clientName: row.smmProject.client?.name ?? null })) }
  } catch (e) {
    console.error('[getAllActiveSmmProjectMembers]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить команду SMM' }
  }
}

export async function addSmmProjectMember(smmProjectId: string, userId: string, role: SmmProjectRole): Promise<{ ok: true; data: SmmProjectMemberDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const project = await prisma.smmProject.findUnique({ where: { id: smmProjectId }, select: { clientId: true } })
    if (!project) return { ok: false, error: 'SMM-проект не найден' }
    const created = await prisma.smmProjectMember.create({
      data: { smmProjectId, userId, role },
      include: MEMBER_INCLUDE,
    })
    revalidateSmmPaths(project.clientId, smmProjectId)
    return { ok: true, data: toMemberDTO(created) }
  } catch (e) {
    console.error('[addSmmProjectMember]', e)
    return { ok: false, error: 'Не удалось добавить участника' }
  }
}

// Участник "покидает" проект — не удаляем строку (история участия), а
// закрываем activeTo, тот же overlay-принцип, что Order.isArchived/
// MontageProject.isPaused.
export async function removeSmmProjectMember(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const updated = await prisma.smmProjectMember.update({
      where: { id },
      data: { activeTo: new Date() },
      include: { smmProject: { select: { clientId: true } } },
    })
    revalidateSmmPaths(updated.smmProject.clientId, updated.smmProjectId)
    return { ok: true }
  } catch (e) {
    console.error('[removeSmmProjectMember]', e)
    return { ok: false, error: 'Не удалось убрать участника' }
  }
}

// ============================================================
// СЪЁМКИ — связь с уже существующим ScheduleEvent (SMM.md, п.15)
// ============================================================

export interface SmmScheduleLinkDTO {
  id: string
  smmProjectId: string
  scheduleEventId: string
  includedInPackage: boolean
  notes: string | null
  createdAt: string
  eventTitle: string | null
  eventStartAt: string | null
  eventEndAt: string | null
  eventType: EventType
  eventRoom: string | null
  orderId: string | null
}

const SCHEDULE_LINK_INCLUDE = {
  scheduleEvent: { select: { title: true, startAt: true, endAt: true, eventType: true, room: true, orderId: true } },
} as const
type ScheduleLinkRow = Awaited<ReturnType<typeof prisma.smmScheduleLink.findFirstOrThrow<{ include: typeof SCHEDULE_LINK_INCLUDE }>>>

function toScheduleLinkDTO(row: ScheduleLinkRow): SmmScheduleLinkDTO {
  return {
    id: row.id,
    smmProjectId: row.smmProjectId,
    scheduleEventId: row.scheduleEventId,
    includedInPackage: row.includedInPackage,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    eventTitle: row.scheduleEvent.title,
    eventStartAt: row.scheduleEvent.startAt?.toISOString() ?? null,
    eventEndAt: row.scheduleEvent.endAt?.toISOString() ?? null,
    eventType: row.scheduleEvent.eventType,
    eventRoom: row.scheduleEvent.room,
    orderId: row.scheduleEvent.orderId,
  }
}

export async function getSmmScheduleLinks(smmProjectId: string): Promise<{ ok: true; data: SmmScheduleLinkDTO[] } | { ok: false; data: SmmScheduleLinkDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const rows = await prisma.smmScheduleLink.findMany({ where: { smmProjectId }, include: SCHEDULE_LINK_INCLUDE, orderBy: { createdAt: 'desc' } })
    return { ok: true, data: rows.map(toScheduleLinkDTO) }
  } catch (e) {
    console.error('[getSmmScheduleLinks]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить съёмки' }
  }
}

// Записи расписания клиента, ещё НЕ привязанные ни к одному SMM-проекту —
// облегчает выбор (SMM.md, п.15: "система должна облегчать выбор его
// заказов"), не второй календарь.
export async function getUnlinkedScheduleEventsForClient(clientId: string): Promise<{ ok: true; data: { id: string; title: string | null; startAt: string | null }[] } | { ok: false; data: never[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const rows = await prisma.scheduleEvent.findMany({
      where: { clientId, smmScheduleLink: null },
      select: { id: true, title: true, startAt: true },
      orderBy: { startAt: 'desc' },
      take: 50,
    })
    return { ok: true, data: rows.map(r => ({ id: r.id, title: r.title, startAt: r.startAt?.toISOString() ?? null })) }
  } catch (e) {
    console.error('[getUnlinkedScheduleEventsForClient]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить съёмки клиента' }
  }
}

export async function linkSmmScheduleEvent(smmProjectId: string, scheduleEventId: string, includedInPackage: boolean): Promise<{ ok: true; data: SmmScheduleLinkDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const project = await prisma.smmProject.findUnique({ where: { id: smmProjectId }, select: { clientId: true } })
    if (!project) return { ok: false, error: 'SMM-проект не найден' }
    const created = await prisma.smmScheduleLink.create({
      data: { smmProjectId, scheduleEventId, includedInPackage },
      include: SCHEDULE_LINK_INCLUDE,
    })
    revalidateSmmPaths(project.clientId, smmProjectId)
    return { ok: true, data: toScheduleLinkDTO(created) }
  } catch (e) {
    console.error('[linkSmmScheduleEvent]', e)
    return { ok: false, error: 'Не удалось привязать съёмку' }
  }
}

export async function unlinkSmmScheduleEvent(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const deleted = await prisma.smmScheduleLink.delete({ where: { id }, include: { smmProject: { select: { clientId: true } } } })
    revalidateSmmPaths(deleted.smmProject.clientId, deleted.smmProjectId)
    return { ok: true }
  } catch (e) {
    console.error('[unlinkSmmScheduleEvent]', e)
    return { ok: false, error: 'Не удалось отвязать съёмку' }
  }
}

// ============================================================
// ВЫПОЛНЕННАЯ РАБОТА / ВЫПЛАТЫ (SMM.md, п.18–20)
// ============================================================

export interface SmmWorkItemDTO {
  id: string
  smmProjectId: string
  smmProjectClientName: string | null
  performerId: string
  performerName: string
  contentItemId: string | null
  contentItemTitle: string | null
  editingProjectId: string | null
  workType: SmmWorkType
  customWorkType: string | null
  description: string | null
  workDate: string
  quantity: number
  rate: number | null
  amount: number
  status: SmmWorkStatus
  paymentStatus: SmmWorkPaymentStatus
  paymentId: string | null
  createdAt: string
}

export interface SmmWorkItemInput {
  performerId: string
  contentItemId?: string | null
  editingProjectId?: string | null
  workType: SmmWorkType
  customWorkType?: string | null
  description?: string | null
  workDate: string
  quantity?: number
  rate?: number | null
  amount: number
  status?: SmmWorkStatus
}

const WORK_ITEM_INCLUDE = {
  performer: { select: { displayName: true } },
  contentItem: { select: { title: true } },
  smmProject: { select: { clientId: true, client: { select: { name: true } } } },
} as const
type WorkItemRow = Awaited<ReturnType<typeof prisma.smmWorkItem.findFirstOrThrow<{ include: typeof WORK_ITEM_INCLUDE }>>>

function toWorkItemDTO(row: WorkItemRow): SmmWorkItemDTO {
  return {
    id: row.id,
    smmProjectId: row.smmProjectId,
    smmProjectClientName: row.smmProject.client?.name ?? null,
    performerId: row.performerId,
    performerName: row.performer.displayName,
    contentItemId: row.contentItemId,
    contentItemTitle: row.contentItem?.title ?? null,
    editingProjectId: row.editingProjectId,
    workType: row.workType,
    customWorkType: row.customWorkType,
    description: row.description,
    workDate: row.workDate.toISOString(),
    quantity: row.quantity,
    rate: row.rate,
    amount: row.amount,
    status: row.status,
    paymentStatus: row.paymentStatus,
    paymentId: row.paymentId,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function getSmmWorkItems(smmProjectId: string): Promise<{ ok: true; data: SmmWorkItemDTO[] } | { ok: false; data: SmmWorkItemDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const rows = await prisma.smmWorkItem.findMany({ where: { smmProjectId }, include: WORK_ITEM_INCLUDE, orderBy: { workDate: 'desc' } })
    return { ok: true, data: rows.map(toWorkItemDTO) }
  } catch (e) {
    console.error('[getSmmWorkItems]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить работы' }
  }
}

// APPROVED и ещё не оплачено — основа "К выплате" (SMM.md, п.20).
export async function getUnpaidApprovedWorkItems(): Promise<{ ok: true; data: SmmWorkItemDTO[] } | { ok: false; data: SmmWorkItemDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const rows = await prisma.smmWorkItem.findMany({
      where: { status: 'APPROVED', paymentStatus: 'UNPAID' },
      include: WORK_ITEM_INCLUDE,
      orderBy: { workDate: 'asc' },
    })
    return { ok: true, data: rows.map(toWorkItemDTO) }
  } catch (e) {
    console.error('[getUnpaidApprovedWorkItems]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить неоплаченные работы' }
  }
}

export async function createSmmWorkItem(smmProjectId: string, input: SmmWorkItemInput): Promise<{ ok: true; data: SmmWorkItemDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  if (!input.performerId) return { ok: false, error: 'Укажите исполнителя' }
  try {
    const project = await prisma.smmProject.findUnique({ where: { id: smmProjectId }, select: { clientId: true } })
    if (!project) return { ok: false, error: 'SMM-проект не найден' }
    const createdById = await resolveValidUserId(prisma, authResult.userId)
    const created = await prisma.smmWorkItem.create({
      data: {
        smmProjectId,
        performerId: input.performerId,
        contentItemId: input.contentItemId || null,
        editingProjectId: input.editingProjectId || null,
        workType: input.workType,
        customWorkType: input.workType === 'OTHER' ? (input.customWorkType?.trim() || null) : null,
        description: input.description?.trim() || null,
        workDate: new Date(input.workDate),
        quantity: input.quantity ?? 1,
        rate: input.rate ?? null,
        amount: input.amount,
        status: input.status ?? 'DRAFT',
        createdById,
      },
      include: WORK_ITEM_INCLUDE,
    })
    revalidateSmmPaths(project.clientId, smmProjectId)
    revalidatePath('/admin/smm/payouts')
    return { ok: true, data: toWorkItemDTO(created) }
  } catch (e) {
    console.error('[createSmmWorkItem]', e)
    return { ok: false, error: 'Не удалось добавить выполненную работу' }
  }
}

export async function updateSmmWorkItemStatus(id: string, status: SmmWorkStatus): Promise<{ ok: true; data: SmmWorkItemDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const updated = await prisma.smmWorkItem.update({ where: { id }, data: { status }, include: WORK_ITEM_INCLUDE })
    revalidateSmmPaths(updated.smmProject.clientId, updated.smmProjectId)
    revalidatePath('/admin/smm/payouts')
    return { ok: true, data: toWorkItemDTO(updated) }
  } catch (e) {
    console.error('[updateSmmWorkItemStatus]', e)
    return { ok: false, error: 'Не удалось изменить статус работы' }
  }
}

export interface SmmPaymentDTO {
  id: string
  performerId: string
  performerName: string
  type: SmmPayoutType
  amount: number
  paidAt: string
  periodStart: string | null
  periodEnd: string | null
  method: PaymentMethod | null
  comment: string | null
  createdAt: string
  workItems: SmmWorkItemDTO[]
}

const PAYMENT_INCLUDE = {
  performer: { select: { displayName: true } },
  workItems: { include: WORK_ITEM_INCLUDE },
} as const
type PaymentRow = Awaited<ReturnType<typeof prisma.smmPayment.findFirstOrThrow<{ include: typeof PAYMENT_INCLUDE }>>>

function toPaymentDTO(row: PaymentRow): SmmPaymentDTO {
  return {
    id: row.id,
    performerId: row.performerId,
    performerName: row.performer.displayName,
    type: row.type,
    amount: row.amount,
    paidAt: row.paidAt.toISOString(),
    periodStart: row.periodStart?.toISOString() ?? null,
    periodEnd: row.periodEnd?.toISOString() ?? null,
    method: row.method,
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
    workItems: row.workItems.map(toWorkItemDTO),
  }
}

export async function getSmmPayments(): Promise<{ ok: true; data: SmmPaymentDTO[] } | { ok: false; data: SmmPaymentDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const rows = await prisma.smmPayment.findMany({ include: PAYMENT_INCLUDE, orderBy: { paidAt: 'desc' } })
    return { ok: true, data: rows.map(toPaymentDTO) }
  } catch (e) {
    console.error('[getSmmPayments]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить историю выплат' }
  }
}

export interface CreateSmmPaymentInput {
  performerId: string
  workItemIds: string[]
  type?: SmmPayoutType
  amount?: number
  method?: PaymentMethod | null
  comment?: string | null
}

// Формирует выплату (SMM.md, п.20) — считает сумму из переданных APPROVED/
// UNPAID work items (если amount не передан явно, как для SALARY/BONUS), в
// одной транзакции переводит их в PAID и проставляет paymentId — исключает
// ситуацию "работа осталась в «К выплате», хотя выплата уже создана".
export async function createSmmPayment(input: CreateSmmPaymentInput): Promise<{ ok: true; data: SmmPaymentDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  if (!input.performerId) return { ok: false, error: 'Укажите исполнителя' }
  try {
    const payment = await prisma.$transaction(async tx => {
      let amount = input.amount ?? 0
      if (input.workItemIds.length > 0) {
        const items = await tx.smmWorkItem.findMany({ where: { id: { in: input.workItemIds } } })
        const invalid = items.find(i => i.performerId !== input.performerId || i.paymentStatus === 'PAID')
        if (invalid) throw new Error('WORK_ITEM_MISMATCH')
        if (input.amount === undefined) amount = items.reduce((sum, i) => sum + i.amount, 0)
      }

      const createdById = await resolveValidUserId(tx, authResult.userId)
      const created = await tx.smmPayment.create({
        data: {
          performerId: input.performerId,
          type: input.type ?? 'PIECEWORK',
          amount,
          method: input.method ?? null,
          comment: input.comment?.trim() || null,
          createdById,
        },
      })

      if (input.workItemIds.length > 0) {
        await tx.smmWorkItem.updateMany({
          where: { id: { in: input.workItemIds } },
          data: { paymentStatus: 'PAID', paymentId: created.id },
        })
      }

      return tx.smmPayment.findUniqueOrThrow({ where: { id: created.id }, include: PAYMENT_INCLUDE })
    })

    await writeAuditLog({ userId: authResult.userId, action: 'SMM_PAYMENT_CREATED', entityType: 'SmmPayment', entityId: payment.id, metadata: { performerId: payment.performerId, amount: payment.amount } })
    revalidatePath('/admin/smm/payouts')
    revalidatePath('/admin/smm')
    revalidatePath('/admin/dashboard')
    return { ok: true, data: toPaymentDTO(payment) }
  } catch (e) {
    if (e instanceof Error && e.message === 'WORK_ITEM_MISMATCH') {
      return { ok: false, error: 'Выбранные работы принадлежат другому исполнителю или уже оплачены' }
    }
    console.error('[createSmmPayment]', e)
    return { ok: false, error: 'Не удалось сформировать выплату' }
  }
}

// ============================================================
// ПЛАТЕЖИ SMM-КЛИЕНТА (SMM.md, п.22)
// ============================================================

export interface SmmClientPaymentDTO {
  id: string
  smmProjectId: string
  smmProjectClientName: string | null
  plannedDate: string
  plannedAmount: number
  actualDate: string | null
  actualAmount: number | null
  method: PaymentMethod | null
  status: SmmClientPaymentStatus
  comment: string | null
  createdAt: string
}

export interface SmmClientPaymentInput {
  plannedDate: string
  plannedAmount: number
  method?: PaymentMethod | null
  status?: SmmClientPaymentStatus
  comment?: string | null
}

const CLIENT_PAYMENT_INCLUDE = { smmProject: { select: { client: { select: { name: true } } } } } as const
type ClientPaymentRow = Awaited<ReturnType<typeof prisma.smmClientPayment.findFirstOrThrow<{ include: typeof CLIENT_PAYMENT_INCLUDE }>>>

function toClientPaymentDTO(row: ClientPaymentRow): SmmClientPaymentDTO {
  return {
    id: row.id,
    smmProjectId: row.smmProjectId,
    smmProjectClientName: row.smmProject.client?.name ?? null,
    plannedDate: row.plannedDate.toISOString(),
    plannedAmount: row.plannedAmount,
    actualDate: row.actualDate?.toISOString() ?? null,
    actualAmount: row.actualAmount,
    method: row.method,
    status: row.status,
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function getSmmClientPayments(smmProjectId: string): Promise<{ ok: true; data: SmmClientPaymentDTO[] } | { ok: false; data: SmmClientPaymentDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const rows = await prisma.smmClientPayment.findMany({ where: { smmProjectId }, include: CLIENT_PAYMENT_INCLUDE, orderBy: { plannedDate: 'asc' } })
    return { ok: true, data: rows.map(toClientPaymentDTO) }
  } catch (e) {
    console.error('[getSmmClientPayments]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить платежи' }
  }
}

export async function getUpcomingSmmClientPayments(): Promise<{ ok: true; data: SmmClientPaymentDTO[] } | { ok: false; data: SmmClientPaymentDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const rows = await prisma.smmClientPayment.findMany({
      where: { status: { in: ['PLANNED', 'DUE'] } },
      include: CLIENT_PAYMENT_INCLUDE,
      orderBy: { plannedDate: 'asc' },
      take: 20,
    })
    return { ok: true, data: rows.map(toClientPaymentDTO) }
  } catch (e) {
    console.error('[getUpcomingSmmClientPayments]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить ближайшие платежи' }
  }
}

export async function createSmmClientPayment(smmProjectId: string, input: SmmClientPaymentInput): Promise<{ ok: true; data: SmmClientPaymentDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const project = await prisma.smmProject.findUnique({ where: { id: smmProjectId }, select: { clientId: true } })
    if (!project) return { ok: false, error: 'SMM-проект не найден' }
    const created = await prisma.smmClientPayment.create({
      data: {
        smmProjectId,
        plannedDate: new Date(input.plannedDate),
        plannedAmount: input.plannedAmount,
        method: input.method ?? null,
        status: input.status ?? 'PLANNED',
        comment: input.comment?.trim() || null,
      },
      include: CLIENT_PAYMENT_INCLUDE,
    })
    revalidateSmmPaths(project.clientId, smmProjectId)
    return { ok: true, data: toClientPaymentDTO(created) }
  } catch (e) {
    console.error('[createSmmClientPayment]', e)
    return { ok: false, error: 'Не удалось создать плановый платёж' }
  }
}

export async function markSmmClientPaymentPaid(id: string, actualDate: string, actualAmount: number): Promise<{ ok: true; data: SmmClientPaymentDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const updated = await prisma.smmClientPayment.update({
      where: { id },
      data: { status: 'PAID', actualDate: new Date(actualDate), actualAmount },
      include: CLIENT_PAYMENT_INCLUDE,
    })
    revalidateSmmPaths(undefined, updated.smmProjectId)
    revalidatePath('/admin/dashboard')
    return { ok: true, data: toClientPaymentDTO(updated) }
  } catch (e) {
    console.error('[markSmmClientPaymentPaid]', e)
    return { ok: false, error: 'Не удалось отметить платёж оплаченным' }
  }
}

// ============================================================
// DASHBOARD (SMM.md, п.5)
// ============================================================

export interface SmmDashboardStats {
  activeProjectsCount: number
  monthlyRevenue: number
  receivedThisMonth: number
  expectedFromClients: number
  payableToTeam: number
  contentInProduction: number
  overdueContent: number
}

export async function getSmmDashboardStats(): Promise<{ ok: true; data: SmmDashboardStats } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

    const [activeProjects, receivedAgg, expectedAgg, unpaidWorkAgg, contentInProduction, overdueContent] = await Promise.all([
      prisma.smmProject.findMany({ where: { status: 'ACTIVE' }, select: { monthlyFee: true } }),
      prisma.smmClientPayment.aggregate({
        where: { status: 'PAID', actualDate: { gte: monthStart, lte: monthEnd } },
        _sum: { actualAmount: true },
      }),
      prisma.smmClientPayment.aggregate({
        where: { status: { in: ['PLANNED', 'DUE'] }, plannedDate: { lte: monthEnd } },
        _sum: { plannedAmount: true },
      }),
      prisma.smmWorkItem.aggregate({
        where: { status: 'APPROVED', paymentStatus: 'UNPAID' },
        _sum: { amount: true },
      }),
      prisma.smmContentItem.count({
        where: { status: { in: ['PLANNED', 'WAITING_FOR_SHOOT', 'SHOT', 'IN_EDIT', 'REVIEW'] } },
      }),
      prisma.smmContentItem.count({
        where: { deadline: { lt: now }, status: { notIn: ['PUBLISHED', 'CANCELLED'] } },
      }),
    ])

    return {
      ok: true,
      data: {
        activeProjectsCount: activeProjects.length,
        monthlyRevenue: activeProjects.reduce((sum, p) => sum + (p.monthlyFee ?? 0), 0),
        receivedThisMonth: receivedAgg._sum.actualAmount ?? 0,
        expectedFromClients: expectedAgg._sum.plannedAmount ?? 0,
        payableToTeam: unpaidWorkAgg._sum.amount ?? 0,
        contentInProduction,
        overdueContent,
      },
    }
  } catch (e) {
    console.error('[getSmmDashboardStats]', e)
    return { ok: false, error: 'Не удалось загрузить статистику SMM' }
  }
}

// ============================================================
// PRODUCTION (2B, docs/business/SMM.md, «Production») — глобальный
// операционный экран SMM → Производство, читает SmmContentItem ВСЕХ
// активных SmmProject разом. Два РАЗНЫХ query/DTO по объёму данных (ТЗ 2B,
// п.4/51): getSmmProductionItems — лёгкая строка таблицы (без
// productionBrief/полных метрик/содержимого материалов/WorkItem),
// getSmmContentItemDetail — полная карточка (для канонического
// SmmContentItemCard), запрашивается только при открытии ОДНОЙ единицы
// контента, не для всего списка разом.
// ============================================================

export interface SmmProductionRowDTO {
  id: string
  smmProjectId: string
  smmProjectClientId: string
  clientName: string | null
  contentCode: string | null
  title: string | null
  serviceType: SmmServiceType
  customServiceType: string | null
  status: SmmContentStatus
  responsibleUserName: string | null
  // Эффективный монтажёр (editingProject.editorId ?? ContentItem.editorId,
  // тот же приоритет, что у editorName) — нужен отдельно от имени для
  // фильтра "Монтажёр" в таблице (ТЗ 2B, п.7).
  editorId: string | null
  editorName: string | null
  editingProjectId: string | null
  editingProjectStatus: MontageStatus | null
  montageShortState: string
  deadline: string | null
  editingProjectDeadlineDate: string | null
  sortDeadline: string | null
  nearestPublicationDate: string | null
  publicationPlatformCount: number
  // Уникальные площадки среди НЕ-CANCELLED публикаций — фильтр "Площадка"
  // означает наличие соответствующей Publication (ТЗ 2B, п.7).
  publicationPlatforms: SmmPublicationPlatform[]
  hasSourceMaterials: boolean
  hasMasterMaterial: boolean
  isOverdue: boolean
  attentionReasons: SmmContentAttentionReason[]
  createdAt: string
}

const PRODUCTION_ROW_INCLUDE = {
  smmProject: { select: { clientId: true, client: { select: { name: true } } } },
  responsibleUser: { select: { name: true, email: true } },
  editor: { select: { displayName: true } },
  editingProject: {
    select: { status: true, editorId: true, editor: { select: { displayName: true } }, deadlineDate: true, deliveryUrl: true },
  },
  publications: { select: { platform: true, status: true, plannedPublishAt: true, url: true } },
  materialLinks: { select: { materialType: true, category: true } },
} as const

type ProductionRow = Awaited<ReturnType<typeof prisma.smmContentItem.findFirstOrThrow<{ include: typeof PRODUCTION_ROW_INCLUDE }>>>

function toProductionRowDTO(row: ProductionRow, now: Date): SmmProductionRowDTO {
  const materials = computeContentMaterialsIndicator(row.materialLinks)
  const hasMasterMaterial = materials.hasMaster || !!row.editingProject?.deliveryUrl
  const publicationPlatforms = [...new Set(row.publications.filter(p => p.status !== 'CANCELLED').map(p => p.platform))]
  const publicationsIso = row.publications.map(p => ({ status: p.status, plannedPublishAt: p.plannedPublishAt?.toISOString() ?? null, url: p.url }))
  const nearest = getNearestPublicationInfo(publicationsIso)
  const deadlineIso = row.deadline?.toISOString() ?? null
  const editingDeadlineIso = row.editingProject?.deadlineDate?.toISOString() ?? null
  const sortDeadline = row.status === 'IN_EDIT' && editingDeadlineIso ? editingDeadlineIso : deadlineIso

  const attentionReasons = getSmmContentAttentionReasons({
    status: row.status,
    deadline: deadlineIso,
    editingProjectStatus: row.editingProject?.status ?? null,
    editingProjectDeadlineDate: editingDeadlineIso,
    editingProjectEditorId: row.editingProject?.editorId ?? null,
    hasSourceMaterials: materials.hasSource,
    publications: publicationsIso,
  }, now)

  return {
    id: row.id,
    smmProjectId: row.smmProjectId,
    smmProjectClientId: row.smmProject.clientId,
    clientName: row.smmProject.client?.name ?? null,
    contentCode: row.contentCode,
    title: row.title,
    serviceType: row.serviceType,
    customServiceType: row.customServiceType,
    status: row.status,
    responsibleUserName: row.responsibleUser?.name ?? row.responsibleUser?.email ?? null,
    // "Монтажёр" — реальный MontageProject.editor, если монтаж уже создан
    // (source of truth), иначе pre-assignment ContentItem.editorId (SMM.md,
    // «Editing: MontageProject» + ТЗ 2B, п.5).
    editorId: row.editingProject?.editorId ?? row.editorId,
    editorName: row.editingProject?.editor?.displayName ?? row.editor?.displayName ?? null,
    editingProjectId: row.editingProjectId,
    editingProjectStatus: row.editingProject?.status ?? null,
    montageShortState: getContentMontageShortState(row.editingProject?.status ?? null),
    deadline: deadlineIso,
    editingProjectDeadlineDate: editingDeadlineIso,
    sortDeadline,
    nearestPublicationDate: nearest?.date ?? null,
    publicationPlatformCount: nearest?.platformCount ?? 0,
    publicationPlatforms,
    hasSourceMaterials: materials.hasSource,
    hasMasterMaterial,
    isOverdue: attentionReasons.includes('OVERDUE_PRODUCTION') || attentionReasons.includes('OVERDUE_PUBLICATION'),
    attentionReasons,
    createdAt: row.createdAt.toISOString(),
  }
}

// Читает ТОЛЬКО контент активных SmmProject (ТЗ 2B, п.4) — приостановленные/
// архивные проекты не засоряют повседневную рабочую панель.
export async function getSmmProductionItems(): Promise<{ ok: true; data: SmmProductionRowDTO[] } | { ok: false; data: SmmProductionRowDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const now = new Date()
    const rows = await prisma.smmContentItem.findMany({
      where: { smmProject: { status: 'ACTIVE' } },
      include: PRODUCTION_ROW_INCLUDE,
      orderBy: { createdAt: 'desc' },
    })
    return { ok: true, data: rows.map(r => toProductionRowDTO(r, now)) }
  } catch (e) {
    console.error('[getSmmProductionItems]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить производство' }
  }
}

// ============================================================
// КАНОНИЧЕСКАЯ КАРТОЧКА ЕДИНИЦЫ КОНТЕНТА (2B) — полная детализация для
// SmmContentItemCard.tsx, единственного компонента карточки, открываемого
// и из Production, и из вкладки «Контент» карточки SMM-проекта (SMM.md,
// «Единый canonical ContentItem card»). НЕ переиспользует
// CONTENT_ITEM_INCLUDE (тот лёгкий, для списков) — отдельный, более полный
// include, но и он не тянет всю SMM domain-модель одним гигантским
// запросом: только то, что реально показывает карточка.
// ============================================================

export interface SmmContentItemDetailDTO {
  id: string
  smmProjectId: string
  smmProjectClientId: string
  smmProjectClientName: string | null
  smmProjectStatus: SmmProjectStatus
  serviceType: SmmServiceType
  customServiceType: string | null
  contentCode: string | null
  title: string | null
  description: string | null
  productionBrief: string | null
  plannedPublishDate: string | null
  deadline: string | null
  status: SmmContentStatus
  responsibleUserId: string | null
  responsibleUserName: string | null
  editorId: string | null
  editorName: string | null
  editingProjectId: string | null
  editingProjectStatus: MontageStatus | null
  editingProjectStatusLabel: string | null
  editingProjectDeliveryUrl: string | null
  editingProjectEditorId: string | null
  editingProjectEditorName: string | null
  editingProjectDeadlineDate: string | null
  editingProjectClientAmount: number | null
  editingProjectEditorAmount: number | null
  editingProjectDescription: string | null
  editingProjectRequirements: string | null
  parentContentId: string | null
  parentContentTitle: string | null
  parentContentCode: string | null
  childContent: { id: string; title: string | null; contentCode: string | null }[]
  scheduleEvents: {
    linkId: string; scheduleEventId: string; title: string | null; startAt: string | null; endAt: string | null
    eventType: EventType; room: string | null; orderId: string | null
  }[]
  publications: SmmPublicationDTO[]
  materialLinks: SmmMaterialLinkDTO[]
  workItems: SmmWorkItemDTO[]
  clientApprovalStatus: SmmClientApprovalStatus
  notes: string | null
  createdAt: string
  updatedAt: string
  attentionReasons: SmmContentAttentionReason[]
  isOverdue: boolean
}

const CONTENT_ITEM_DETAIL_INCLUDE = {
  smmProject: { select: { status: true, client: { select: { id: true, name: true } } } },
  responsibleUser: { select: { name: true, email: true } },
  editor: { select: { displayName: true } },
  editingProject: {
    select: {
      status: true, editorId: true, editor: { select: { displayName: true } }, deadlineDate: true, deliveryUrl: true,
      clientAmount: true, editorAmount: true, description: true, requirements: true,
    },
  },
  parentContent: { select: { title: true, contentCode: true } },
  childContent: { select: { id: true, title: true, contentCode: true }, orderBy: { createdAt: 'asc' } },
  scheduleLinks: {
    include: { scheduleEvent: { select: { id: true, title: true, startAt: true, endAt: true, eventType: true, room: true, orderId: true } } },
    orderBy: { createdAt: 'desc' },
  },
  publications: { include: { metrics: { orderBy: { capturedAt: 'desc' } } }, orderBy: { createdAt: 'asc' } },
  materialLinks: { include: MATERIAL_LINK_INCLUDE },
  workItems: { include: WORK_ITEM_INCLUDE, orderBy: { workDate: 'desc' } },
} as const

type ContentItemDetailRow = Awaited<ReturnType<typeof prisma.smmContentItem.findFirstOrThrow<{ include: typeof CONTENT_ITEM_DETAIL_INCLUDE }>>>

function toContentItemDetailDTO(row: ContentItemDetailRow, now: Date): SmmContentItemDetailDTO {
  const materialLinks = row.materialLinks.map(toMaterialLinkDTO)
  const materialsIndicator = computeContentMaterialsIndicator(row.materialLinks)
  const publications = row.publications.map(toPublicationDTO)

  const attentionReasons = getSmmContentAttentionReasons({
    status: row.status,
    deadline: row.deadline?.toISOString() ?? null,
    editingProjectStatus: row.editingProject?.status ?? null,
    editingProjectDeadlineDate: row.editingProject?.deadlineDate?.toISOString() ?? null,
    editingProjectEditorId: row.editingProject?.editorId ?? null,
    hasSourceMaterials: materialsIndicator.hasSource,
    publications: publications.map(p => ({ status: p.status, plannedPublishAt: p.plannedPublishAt, url: p.url })),
  }, now)

  return {
    id: row.id,
    smmProjectId: row.smmProjectId,
    smmProjectClientId: row.smmProject.client?.id ?? '',
    smmProjectClientName: row.smmProject.client?.name ?? null,
    smmProjectStatus: row.smmProject.status,
    serviceType: row.serviceType,
    customServiceType: row.customServiceType,
    contentCode: row.contentCode,
    title: row.title,
    description: row.description,
    productionBrief: row.productionBrief,
    plannedPublishDate: row.plannedPublishDate?.toISOString() ?? null,
    deadline: row.deadline?.toISOString() ?? null,
    status: row.status,
    responsibleUserId: row.responsibleUserId,
    responsibleUserName: row.responsibleUser?.name ?? row.responsibleUser?.email ?? null,
    editorId: row.editorId,
    editorName: row.editor?.displayName ?? null,
    editingProjectId: row.editingProjectId,
    editingProjectStatus: row.editingProject?.status ?? null,
    editingProjectStatusLabel: row.editingProject ? MONTAGE_STATUS_LABELS[row.editingProject.status] : null,
    editingProjectDeliveryUrl: row.editingProject?.deliveryUrl ?? null,
    editingProjectEditorId: row.editingProject?.editorId ?? null,
    editingProjectEditorName: row.editingProject?.editor?.displayName ?? null,
    editingProjectDeadlineDate: row.editingProject?.deadlineDate?.toISOString() ?? null,
    editingProjectClientAmount: row.editingProject?.clientAmount ?? null,
    editingProjectEditorAmount: row.editingProject?.editorAmount ?? null,
    editingProjectDescription: row.editingProject?.description ?? null,
    editingProjectRequirements: row.editingProject?.requirements ?? null,
    parentContentId: row.parentContentId,
    parentContentTitle: row.parentContent?.title ?? null,
    parentContentCode: row.parentContent?.contentCode ?? null,
    childContent: row.childContent.map(c => ({ id: c.id, title: c.title, contentCode: c.contentCode })),
    scheduleEvents: row.scheduleLinks.map(l => ({
      linkId: l.id,
      scheduleEventId: l.scheduleEventId,
      title: l.scheduleEvent.title,
      startAt: l.scheduleEvent.startAt?.toISOString() ?? null,
      endAt: l.scheduleEvent.endAt?.toISOString() ?? null,
      eventType: l.scheduleEvent.eventType,
      room: l.scheduleEvent.room,
      orderId: l.scheduleEvent.orderId,
    })),
    publications,
    materialLinks,
    workItems: row.workItems.map(toWorkItemDTO),
    clientApprovalStatus: row.clientApprovalStatus,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    attentionReasons,
    isOverdue: attentionReasons.includes('OVERDUE_PRODUCTION') || attentionReasons.includes('OVERDUE_PUBLICATION'),
  }
}

export async function getSmmContentItemDetail(id: string): Promise<{ ok: true; data: SmmContentItemDetailDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const row = await prisma.smmContentItem.findUnique({ where: { id }, include: CONTENT_ITEM_DETAIL_INCLUDE })
    if (!row) return { ok: false, error: 'Единица контента не найдена' }
    return { ok: true, data: toContentItemDetailDTO(row, new Date()) }
  } catch (e) {
    console.error('[getSmmContentItemDetail]', e)
    return { ok: false, error: 'Не удалось загрузить карточку контента' }
  }
}
