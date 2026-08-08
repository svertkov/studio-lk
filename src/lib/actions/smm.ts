'use server'

// SMM — действия платформы для направления SMM-ведения студии (см.
// docs/business/SMM.md). Расширяет существующие Client/ScheduleEvent/
// MontageProject/EditorProfile/User — не дублирует их (AGENTS.md, п.1/4).

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import type {
  SmmProjectStatus, SmmBillingPeriodType, SmmServiceType, SmmPackageUnit, SmmPackagePeriod,
  SmmContentStatus, SmmClientApprovalStatus, SmmMaterialCategory, SmmProjectRole, SmmWorkType,
  SmmWorkStatus, SmmWorkPaymentStatus, SmmPayoutType, SmmClientPaymentStatus, MontageStatus, PaymentMethod, EventType,
} from '@prisma/client'
import { createMontageProject } from '@/lib/actions/montage'
import { MONTAGE_STATUS_LABELS } from '@/lib/montage-model'
import { writeAuditLog, resolveValidUserId } from '@/lib/audit'

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
  scheduleEventId: string | null
  sourceUrl: string | null
  resultUrl: string | null
  publishedUrl: string | null
  indexCode: string | null
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
  plannedPublishDate?: string | null
  deadline?: string | null
  status?: SmmContentStatus
  responsibleUserId?: string | null
  editorId?: string | null
  scheduleEventId?: string | null
  sourceUrl?: string | null
  resultUrl?: string | null
  publishedUrl?: string | null
  indexCode?: string | null
  clientApprovalStatus?: SmmClientApprovalStatus
  notes?: string | null
}

const CONTENT_ITEM_INCLUDE = {
  responsibleUser: { select: { name: true, email: true } },
  editor: { select: { displayName: true } },
  editingProject: { select: { status: true, deliveryUrl: true } },
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
    sourceUrl: row.sourceUrl,
    resultUrl: row.resultUrl,
    publishedUrl: row.publishedUrl,
    indexCode: row.indexCode,
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
    const created = await prisma.smmContentItem.create({
      data: {
        smmProjectId,
        serviceType: input.serviceType,
        customServiceType: input.serviceType === 'OTHER' ? (input.customServiceType?.trim() || null) : null,
        title: input.title?.trim() || null,
        description: input.description?.trim() || null,
        plannedPublishDate: input.plannedPublishDate ? new Date(input.plannedPublishDate) : null,
        deadline: input.deadline ? new Date(input.deadline) : null,
        status: input.status ?? 'IDEA',
        responsibleUserId: input.responsibleUserId || null,
        editorId: input.editorId || null,
        scheduleEventId: input.scheduleEventId || null,
        sourceUrl: input.sourceUrl?.trim() || null,
        resultUrl: input.resultUrl?.trim() || null,
        publishedUrl: input.publishedUrl?.trim() || null,
        indexCode: input.indexCode?.trim() || null,
        clientApprovalStatus: input.clientApprovalStatus ?? 'NOT_REQUIRED',
        notes: input.notes?.trim() || null,
      },
      include: CONTENT_ITEM_INCLUDE,
    })
    revalidateSmmPaths(project.clientId, smmProjectId)
    return { ok: true, data: toContentItemDTO(created) }
  } catch (e) {
    console.error('[createSmmContentItem]', e)
    return { ok: false, error: 'Не удалось создать единицу контента' }
  }
}

export async function updateSmmContentItem(id: string, input: SmmContentItemInput): Promise<{ ok: true; data: SmmContentItemDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const nextServiceType = input.serviceType
    const updated = await prisma.smmContentItem.update({
      where: { id },
      data: {
        ...(input.serviceType !== undefined && { serviceType: input.serviceType }),
        ...(input.customServiceType !== undefined && { customServiceType: nextServiceType === 'OTHER' ? (input.customServiceType?.trim() || null) : null }),
        ...(input.title !== undefined && { title: input.title?.trim() || null }),
        ...(input.description !== undefined && { description: input.description?.trim() || null }),
        ...(input.plannedPublishDate !== undefined && { plannedPublishDate: input.plannedPublishDate ? new Date(input.plannedPublishDate) : null }),
        ...(input.deadline !== undefined && { deadline: input.deadline ? new Date(input.deadline) : null }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.responsibleUserId !== undefined && { responsibleUserId: input.responsibleUserId || null }),
        ...(input.editorId !== undefined && { editorId: input.editorId || null }),
        ...(input.scheduleEventId !== undefined && { scheduleEventId: input.scheduleEventId || null }),
        ...(input.sourceUrl !== undefined && { sourceUrl: input.sourceUrl?.trim() || null }),
        ...(input.resultUrl !== undefined && { resultUrl: input.resultUrl?.trim() || null }),
        ...(input.publishedUrl !== undefined && { publishedUrl: input.publishedUrl?.trim() || null }),
        ...(input.indexCode !== undefined && { indexCode: input.indexCode?.trim() || null }),
        ...(input.clientApprovalStatus !== undefined && { clientApprovalStatus: input.clientApprovalStatus }),
        ...(input.notes !== undefined && { notes: input.notes?.trim() || null }),
      },
      include: { ...CONTENT_ITEM_INCLUDE, smmProject: { select: { clientId: true } } },
    })
    revalidateSmmPaths(updated.smmProject.clientId, updated.smmProjectId)
    return { ok: true, data: toContentItemDTO(updated) }
  } catch (e) {
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
export async function linkSmmContentToMontage(contentItemId: string): Promise<{ ok: true; data: SmmContentItemDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const content = await prisma.smmContentItem.findUnique({
      where: { id: contentItemId },
      include: { smmProject: { select: { clientId: true } } },
    })
    if (!content) return { ok: false, error: 'Единица контента не найдена' }
    if (content.editingProjectId) return { ok: false, error: 'Контент уже связан с проектом монтажа' }

    const montageResult = await createMontageProject({
      clientId: content.smmProject.clientId,
      title: content.title || undefined,
    })
    if (!montageResult.ok) return { ok: false, error: montageResult.error }

    const updated = await prisma.smmContentItem.update({
      where: { id: contentItemId },
      data: { editingProjectId: montageResult.data.id, status: content.status === 'IDEA' || content.status === 'PLANNED' ? 'IN_EDIT' : content.status },
      include: CONTENT_ITEM_INCLUDE,
    })
    revalidateSmmPaths(content.smmProject.clientId, content.smmProjectId)
    revalidatePath('/admin/editing')
    return { ok: true, data: toContentItemDTO(updated) }
  } catch (e) {
    console.error('[linkSmmContentToMontage]', e)
    return { ok: false, error: 'Не удалось связать с проектом монтажа' }
  }
}

// ============================================================
// МАТЕРИАЛЫ (SMM.md, п.16)
// ============================================================

export interface SmmMaterialLinkDTO {
  id: string
  smmProjectId: string
  category: SmmMaterialCategory
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
        title: input.title.trim(),
        url: input.url.trim(),
        description: input.description?.trim() || null,
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
