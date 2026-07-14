'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import { Prisma, type DocumentType, type DocumentStatus, type InvoicePurpose, type ClientContractState, type DocumentFlowType, type MontageDocumentMode, type ClientType } from '@prisma/client'
import { writeAuditLog, resolveValidUserId } from '@/lib/audit'
import { getDocumentDisplayNumber, getWorkDocumentAttentionReasons, getClientContractAttentionReasons, getDocumentPaymentState, type DocumentAttentionReason } from '@/lib/document-model'

// ============================================================
// АВТОРИЗАЦИЯ — та же локальная проверка, что в actions/orders.ts,
// actions/montage.ts и т.д. (в проекте нет общего requireRole-хелпера).
// RBAC для документов сознательно не реализован на этом этапе (см. AGENTS.md).
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

// Реестр документов затрагивает клиента, заказ/монтаж, CRM, финансы и
// дашборд — любая мутация обязана инвалидировать все разом (AGENTS.md, п.5/9),
// тот же принцип, что и revalidateMontagePaths/revalidateOrderPaths.
function revalidateDocumentPaths(refs: { clientId?: string | null; orderId?: string | null; montageProjectId?: string | null }): void {
  revalidatePath('/admin/documents')
  revalidatePath('/admin/orders')
  revalidatePath('/admin/crm')
  revalidatePath('/admin/editing')
  revalidatePath('/admin/finance')
  revalidatePath('/admin/dashboard')
  if (refs.clientId) revalidatePath(`/admin/clients/${refs.clientId}`)
}

// ============================================================
// СЧЁТЧИКИ — атомарное получение следующего числа безопасно под конкурентными
// транзакциями (upsert+increment — одна SQL-команда, row-level lock Postgres,
// тот же эффект что у обычного SEQUENCE). "contract_number" и
// "document_package_number" — общий механизм, разные ключи.
// ============================================================

async function getNextCounterValue(tx: Prisma.TransactionClient, counterId: string): Promise<number> {
  const row = await tx.documentCounter.upsert({
    where: { id: counterId },
    create: { id: counterId, value: 1 },
    update: { value: { increment: 1 } },
  })
  return row.value
}

// Исторический ручной номер (ТЗ "перенос старых данных") не идёт через
// счётчик — но счётчик обязан "подтянуться" вверх, иначе следующий
// автоматический номер рискует столкнуться с уже занятым историческим.
async function bumpCounterIfLower(tx: Prisma.TransactionClient, counterId: string, assignedValue: number): Promise<void> {
  const existing = await tx.documentCounter.findUnique({ where: { id: counterId } })
  if (!existing) {
    await tx.documentCounter.create({ data: { id: counterId, value: assignedValue } })
  } else if (existing.value < assignedValue) {
    await tx.documentCounter.update({ where: { id: counterId }, data: { value: assignedValue } })
  }
}

async function ensureDocumentPackageNumber(
  tx: Prisma.TransactionClient,
  work: { orderId: string } | { montageProjectId: string },
): Promise<number> {
  if ('orderId' in work) {
    const order = await tx.order.findUnique({ where: { id: work.orderId }, select: { documentPackageNumber: true } })
    if (order?.documentPackageNumber != null) return order.documentPackageNumber
    const next = await getNextCounterValue(tx, 'document_package_number')
    await tx.order.update({ where: { id: work.orderId }, data: { documentPackageNumber: next } })
    return next
  }
  const project = await tx.montageProject.findUnique({ where: { id: work.montageProjectId }, select: { documentPackageNumber: true } })
  if (project?.documentPackageNumber != null) return project.documentPackageNumber
  const next = await getNextCounterValue(tx, 'document_package_number')
  await tx.montageProject.update({ where: { id: work.montageProjectId }, data: { documentPackageNumber: next } })
  return next
}

// Номер приложения — сквозной В РАМКАХ ОДНОГО ДОГОВОРА (не через
// DocumentCounter, тот обслуживает только платформенные сквозные номера:
// договор, комплект работы). Простой count+1 достаточен — конкуренция за
// один и тот же договор практически невозможна (один администратор),
// @@unique([contractId, number]) ловит гипотетическую гонку через P2002.
async function getNextAppendixNumber(tx: Prisma.TransactionClient, contractId: string): Promise<number> {
  const count = await tx.document.count({ where: { type: 'APPENDIX', contractId } })
  return count + 1
}

// Суффикс "1"/"2" при нескольких счетах одной работы — не хранится
// заранее, а назначается по факту создания ВТОРОГО счёта, задним числом
// подтягивая суффикс "1" первому (см. AGENTS.md, "Реестр документов": один
// и тот же номер комплекта не копируется, суффикс — вычисляемая деталь
// упорядочивания, а не отдельная сущность). Возвращает null, если счёт
// остаётся единственным для этой работы.
async function assignInvoiceSuffixIfNeeded(
  tx: Prisma.TransactionClient,
  work: { orderId: string } | { montageProjectId: string },
): Promise<string | null> {
  const where = 'orderId' in work
    ? { type: 'INVOICE' as const, orderId: work.orderId, status: { not: 'CANCELLED' as const } }
    : { type: 'INVOICE' as const, montageProjectId: work.montageProjectId, status: { not: 'CANCELLED' as const } }
  const existing = await tx.document.findMany({ where, orderBy: { createdAt: 'asc' } })
  if (existing.length === 0) return null
  for (let i = 0; i < existing.length; i++) {
    if (!existing[i].suffix) {
      await tx.document.update({ where: { id: existing[i].id }, data: { suffix: String(i + 1) } })
    }
  }
  return String(existing.length + 1)
}

// ============================================================
// DTO
// ============================================================

export interface DocumentDTO {
  id: string
  type: DocumentType
  number: number | null
  suffix: string | null
  isHistorical: boolean
  issueDate: string
  status: DocumentStatus
  purpose: InvoicePurpose | null
  amount: number | null
  dueDate: string | null
  comment: string | null
  serviceDescription: string | null
  clientId: string | null
  orderId: string | null
  montageProjectId: string | null
  contractId: string | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  displayNumber: string
  workTitle: string | null
  // Статус оплаты РАБОТЫ (не самого счёта — см. document-model.ts,
  // getDocumentPaymentState) — читается через getOrderPaymentSummary/
  // MontageProject.clientPaymentStatus на клиенте, не хранится здесь копией.
  orderPaymentStatus: string | null
  montagePaymentStatus: string | null
}

type DocumentRow = Prisma.DocumentGetPayload<{
  include: {
    order: { select: { documentPackageNumber: true; title: true; clientName: true; paymentStatus: true } }
    montageProject: { select: { documentPackageNumber: true; title: true; clientPaymentStatus: true } }
  }
}>

const DOCUMENT_INCLUDE = {
  order: { select: { documentPackageNumber: true, title: true, clientName: true, paymentStatus: true } },
  montageProject: { select: { documentPackageNumber: true, title: true, clientPaymentStatus: true } },
} satisfies Prisma.DocumentInclude

function toDocumentDTO(row: DocumentRow): DocumentDTO {
  const workPackageNumber = row.order?.documentPackageNumber ?? row.montageProject?.documentPackageNumber ?? null
  const workTitle = row.order?.title ?? row.order?.clientName ?? row.montageProject?.title ?? null
  return {
    id: row.id,
    type: row.type,
    number: row.number,
    suffix: row.suffix,
    isHistorical: row.isHistorical,
    issueDate: row.issueDate.toISOString(),
    status: row.status,
    purpose: row.purpose,
    amount: row.amount,
    dueDate: row.dueDate ? row.dueDate.toISOString() : null,
    comment: row.comment,
    serviceDescription: row.serviceDescription,
    clientId: row.clientId,
    orderId: row.orderId,
    montageProjectId: row.montageProjectId,
    contractId: row.contractId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    displayNumber: getDocumentDisplayNumber(row, workPackageNumber),
    workTitle,
    orderPaymentStatus: row.order?.paymentStatus ?? null,
    montagePaymentStatus: row.montageProject?.clientPaymentStatus ?? null,
  }
}

// ============================================================
// СОЗДАНИЕ / ИЗМЕНЕНИЕ
// ============================================================

export interface CreateDocumentInput {
  type: DocumentType
  clientId?: string | null
  orderId?: string | null
  montageProjectId?: string | null
  contractId?: string | null
  issueDate: string
  status?: DocumentStatus
  purpose?: InvoicePurpose | null
  amount?: number | null
  dueDate?: string | null
  comment?: string | null
  serviceDescription?: string | null
  isHistorical?: boolean
  historicalNumber?: number | null
}

export async function createDocument(input: CreateDocumentInput): Promise<
  { ok: true; data: DocumentDTO } | { ok: false; error: string }
> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  if (input.type === 'CONTRACT' && !input.clientId) {
    return { ok: false, error: 'Укажите клиента для договора' }
  }
  if (input.type === 'APPENDIX' && !input.contractId) {
    return { ok: false, error: 'Укажите договор для приложения' }
  }
  if (input.type === 'INVOICE' || input.type === 'ACT') {
    if (!input.orderId && !input.montageProjectId) {
      return { ok: false, error: 'Укажите заказ или проект монтажа' }
    }
  }

  try {
    const created = await prisma.$transaction(async tx => {
      let number: number | null = null
      let suffix: string | null = null

      if (input.type === 'CONTRACT') {
        if (input.isHistorical && input.historicalNumber != null) {
          number = input.historicalNumber
          await bumpCounterIfLower(tx, 'contract_number', number)
        } else {
          number = await getNextCounterValue(tx, 'contract_number')
        }
      } else if (input.type === 'APPENDIX') {
        number = await getNextAppendixNumber(tx, input.contractId as string)
      } else {
        const work = input.orderId ? { orderId: input.orderId } : { montageProjectId: input.montageProjectId as string }
        await ensureDocumentPackageNumber(tx, work)
        if (input.type === 'INVOICE') {
          suffix = await assignInvoiceSuffixIfNeeded(tx, work)
        }
      }

      const defaultStatus: DocumentStatus = input.type === 'CONTRACT' || input.type === 'APPENDIX' ? 'ACTIVE' : input.type === 'INVOICE' ? 'DRAFT' : 'NOT_PREPARED'
      const validUserId = await resolveValidUserId(tx, authResult.userId)

      const doc = await tx.document.create({
        data: {
          type: input.type,
          number,
          suffix,
          isHistorical: input.isHistorical ?? false,
          issueDate: new Date(input.issueDate),
          status: input.status ?? defaultStatus,
          purpose: input.type === 'INVOICE' ? (input.purpose ?? null) : null,
          amount: input.amount ?? null,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          comment: input.comment?.trim() || null,
          serviceDescription: input.serviceDescription?.trim() || null,
          clientId: input.type === 'CONTRACT' ? input.clientId : null,
          orderId: input.orderId ?? null,
          montageProjectId: input.montageProjectId ?? null,
          contractId: input.contractId ?? null,
          createdById: validUserId,
          updatedById: validUserId,
        },
        include: DOCUMENT_INCLUDE,
      })

      // Создание договора — единственное место, где contractState переходит в
      // ACTIVE автоматически (администратор только что осознанно создал
      // договор этим самым действием, это не "тихий" вывод, см. AGENTS.md).
      if (input.type === 'CONTRACT' && input.clientId) {
        await tx.client.update({ where: { id: input.clientId }, data: { contractState: 'ACTIVE' } })
      }

      return doc
    })

    await writeAuditLog({
      userId: authResult.userId, action: 'DOCUMENT_CREATED', entityType: 'Document', entityId: created.id,
      metadata: { type: created.type, number: created.number, suffix: created.suffix, isHistorical: created.isHistorical },
    })

    revalidateDocumentPaths({ clientId: input.clientId, orderId: input.orderId, montageProjectId: input.montageProjectId })
    return { ok: true, data: toDocumentDTO(created) }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { ok: false, error: 'Такой номер документа уже занят — проверьте уникальность' }
    }
    console.error('[createDocument]', e)
    return { ok: false, error: 'Не удалось создать документ' }
  }
}

export interface UpdateDocumentInput {
  id: string
  issueDate?: string
  status?: DocumentStatus
  purpose?: InvoicePurpose | null
  amount?: number | null
  dueDate?: string | null
  comment?: string | null
  serviceDescription?: string | null
}

export async function updateDocument(input: UpdateDocumentInput): Promise<
  { ok: true; data: DocumentDTO } | { ok: false; error: string }
> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  try {
    const before = await prisma.document.findUnique({ where: { id: input.id } })
    if (!before) return { ok: false, error: 'Документ не найден' }
    const validUserId = await resolveValidUserId(prisma, authResult.userId)

    const updated = await prisma.document.update({
      where: { id: input.id },
      data: {
        issueDate: input.issueDate ? new Date(input.issueDate) : undefined,
        status: input.status,
        purpose: input.purpose,
        amount: input.amount,
        dueDate: input.dueDate === undefined ? undefined : input.dueDate ? new Date(input.dueDate) : null,
        comment: input.comment === undefined ? undefined : (input.comment?.trim() || null),
        serviceDescription: input.serviceDescription === undefined ? undefined : (input.serviceDescription?.trim() || null),
        updatedById: validUserId,
      },
      include: DOCUMENT_INCLUDE,
    })

    await writeAuditLog({
      userId: authResult.userId, action: 'DOCUMENT_UPDATED', entityType: 'Document', entityId: updated.id,
      metadata: { fields: Object.keys(input).filter(k => k !== 'id'), statusBefore: before.status, statusAfter: updated.status },
    })

    revalidateDocumentPaths({ clientId: updated.clientId, orderId: updated.orderId, montageProjectId: updated.montageProjectId })
    return { ok: true, data: toDocumentDTO(updated) }
  } catch (e) {
    console.error('[updateDocument]', e)
    return { ok: false, error: 'Не удалось обновить документ' }
  }
}

export async function archiveDocument(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  try {
    const validUserId = await resolveValidUserId(prisma, authResult.userId)
    const doc = await prisma.document.update({
      where: { id },
      data: { archivedAt: new Date(), status: 'ARCHIVED', updatedById: validUserId },
    })
    await writeAuditLog({ userId: authResult.userId, action: 'DOCUMENT_ARCHIVED', entityType: 'Document', entityId: id })
    revalidateDocumentPaths({ clientId: doc.clientId, orderId: doc.orderId, montageProjectId: doc.montageProjectId })
    return { ok: true }
  } catch (e) {
    console.error('[archiveDocument]', e)
    return { ok: false, error: 'Не удалось архивировать документ' }
  }
}

export async function updateClientContractState(params: {
  clientId: string
  contractState: ClientContractState
  contractStateComment?: string | null
  contractPlannedDate?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  try {
    const before = await prisma.client.findUnique({ where: { id: params.clientId }, select: { contractState: true } })
    await prisma.client.update({
      where: { id: params.clientId },
      data: {
        contractState: params.contractState,
        contractStateComment: params.contractStateComment?.trim() || null,
        contractPlannedDate: params.contractPlannedDate ? new Date(params.contractPlannedDate) : null,
      },
    })
    await writeAuditLog({
      userId: authResult.userId, action: 'CLIENT_CONTRACT_STATE_CHANGED', entityType: 'Client', entityId: params.clientId,
      metadata: { before: before?.contractState, after: params.contractState },
    })
    revalidatePath(`/admin/clients/${params.clientId}`)
    revalidatePath('/admin/documents')
    revalidatePath('/admin/crm')
    return { ok: true }
  } catch (e) {
    console.error('[updateClientContractState]', e)
    return { ok: false, error: 'Не удалось обновить статус договора' }
  }
}

// ============================================================
// ЗАПРОСЫ
// ============================================================

export async function getDocumentsForOrder(orderId: string): Promise<{ ok: true; data: DocumentDTO[] } | { ok: false; data: DocumentDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const rows = await prisma.document.findMany({ where: { orderId }, include: DOCUMENT_INCLUDE, orderBy: { createdAt: 'asc' } })
    return { ok: true, data: rows.map(toDocumentDTO) }
  } catch (e) {
    console.error('[getDocumentsForOrder]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить документы заказа' }
  }
}

export async function getDocumentsForMontageProject(montageProjectId: string): Promise<{ ok: true; data: DocumentDTO[] } | { ok: false; data: DocumentDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const rows = await prisma.document.findMany({ where: { montageProjectId }, include: DOCUMENT_INCLUDE, orderBy: { createdAt: 'asc' } })
    return { ok: true, data: rows.map(toDocumentDTO) }
  } catch (e) {
    console.error('[getDocumentsForMontageProject]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить документы монтажа' }
  }
}

// Договоры клиента + все счета/акты по его заказам и проектам монтажа —
// тот же union-приём, что getMontageProjectsForClient (actions/montage.ts):
// клиент проекта монтажа читается либо напрямую, либо через order.clientId.
export async function getDocumentsForClient(clientId: string): Promise<{ ok: true; data: DocumentDTO[] } | { ok: false; data: DocumentDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const rows = await prisma.document.findMany({
      where: {
        OR: [
          { type: 'CONTRACT', clientId },
          // Приложение может быть привязано только к договору (без orderId/
          // montageProjectId) — без этой ветки оно не попало бы ни в одну из
          // остальных и было бы невидимо в карточке клиента.
          { type: 'APPENDIX', contract: { clientId } },
          { order: { clientId } },
          { montageProject: { OR: [{ clientId }, { order: { clientId } }] } },
        ],
      },
      include: DOCUMENT_INCLUDE,
      orderBy: { issueDate: 'desc' },
    })
    return { ok: true, data: rows.map(toDocumentDTO) }
  } catch (e) {
    console.error('[getDocumentsForClient]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить документы клиента' }
  }
}

export interface ContractRowDTO {
  id: string
  number: number | null
  issueDate: string
  status: DocumentStatus
  comment: string | null
  clientId: string
  clientName: string
  clientType: string
  ordersCount: number
  appendicesCount: number
  invoicesCount: number
  actsCount: number
}

export async function getContractsList(): Promise<{ ok: true; data: ContractRowDTO[] } | { ok: false; data: ContractRowDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const rows = await prisma.document.findMany({
      where: { type: 'CONTRACT' },
      include: { client: { select: { id: true, name: true, type: true, orders: { select: { id: true } } } } },
      orderBy: { number: 'desc' },
    })
    const data: ContractRowDTO[] = await Promise.all(rows.map(async r => {
      const [appendicesCount, invoicesCount, actsCount] = await Promise.all([
        prisma.document.count({ where: { contractId: r.id, type: 'APPENDIX' } }),
        prisma.document.count({ where: { contractId: r.id, type: 'INVOICE' } }),
        prisma.document.count({ where: { contractId: r.id, type: 'ACT' } }),
      ])
      return {
        id: r.id,
        number: r.number,
        issueDate: r.issueDate.toISOString(),
        status: r.status,
        comment: r.comment,
        clientId: r.client?.id ?? '',
        clientName: r.client?.name ?? '—',
        clientType: r.client?.type ?? 'INDIVIDUAL',
        ordersCount: r.client?.orders.length ?? 0,
        appendicesCount,
        invoicesCount,
        actsCount,
      }
    }))
    return { ok: true, data }
  } catch (e) {
    console.error('[getContractsList]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить договоры' }
  }
}

export interface ClientWithoutContractRowDTO {
  clientId: string
  clientName: string
  clientType: string
  contractState: ClientContractState
  contractStateComment: string | null
  contractPlannedDate: string | null
  ordersCount: number
}

export async function getClientsWithoutContract(): Promise<{ ok: true; data: ClientWithoutContractRowDTO[] } | { ok: false; data: ClientWithoutContractRowDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const rows = await prisma.client.findMany({
      where: { deletedAt: null, contractState: { not: 'ACTIVE' } },
      select: { id: true, name: true, type: true, contractState: true, contractStateComment: true, contractPlannedDate: true, orders: { select: { id: true } } },
      orderBy: { name: 'asc' },
    })
    return {
      ok: true,
      data: rows.map(r => ({
        clientId: r.id,
        clientName: r.name,
        clientType: r.type,
        contractState: r.contractState,
        contractStateComment: r.contractStateComment,
        contractPlannedDate: r.contractPlannedDate ? r.contractPlannedDate.toISOString() : null,
        ordersCount: r.orders.length,
      })),
    }
  } catch (e) {
    console.error('[getClientsWithoutContract]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить клиентов без договора' }
  }
}

export interface DocumentsDashboardStats {
  contractsTotal: number
  contractsActive: number
  clientsWithoutContract: number
  appendicesTotal: number
  invoicesTotal: number
  invoicesUnpaid: number
  actsTotal: number
  ordersWithoutInvoice: number
  completedWorksWithoutAct: number
  attentionCount: number
  appendixAmountMismatches: number
}

export async function getDocumentsDashboardStats(): Promise<{ ok: true; data: DocumentsDashboardStats } | { ok: false; data: null; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: null, error: authResult.error }

  try {
    const [contractsTotal, contractsActive, clientsWithoutContract, appendicesTotal, invoices, acts, orders, montageProjects] = await Promise.all([
      prisma.document.count({ where: { type: 'CONTRACT' } }),
      prisma.client.count({ where: { deletedAt: null, contractState: 'ACTIVE' } }),
      prisma.client.count({ where: { deletedAt: null, contractState: { not: 'ACTIVE' } } }),
      prisma.document.count({ where: { type: 'APPENDIX' } }),
      prisma.document.findMany({ where: { type: 'INVOICE' }, select: { orderId: true, montageProjectId: true, order: { select: { paymentStatus: true } }, montageProject: { select: { clientPaymentStatus: true } } } }),
      prisma.document.count({ where: { type: 'ACT' } }),
      prisma.order.findMany({
        where: { isArchived: false, status: { notIn: ['CANCELLED'] } },
        select: { id: true, status: true, documentFlowType: true, preliminaryAmount: true, documents: { select: { type: true, amount: true } } },
      }),
      prisma.montageProject.findMany({
        where: { isArchived: false, status: { not: 'CANCELLED' } },
        select: { id: true, status: true, documentMode: true, clientAmount: true, documents: { select: { type: true, amount: true } } },
      }),
    ])

    const invoicesUnpaid = invoices.filter(inv => {
      const state = getDocumentPaymentState(inv.order?.paymentStatus ?? null, inv.montageProject?.clientPaymentStatus ?? null)
      return state === 'PENDING' || state === 'PARTIALLY_PAID'
    }).length

    let ordersWithoutInvoice = 0
    let completedWorksWithoutAct = 0
    let attentionCount = 0
    // Только предупреждение для сверки (см. AGENTS.md) — источник финансовой
    // истины остаётся Order.preliminaryAmount/MontageProject.clientAmount,
    // ничего не пересчитывается и не перезаписывается автоматически.
    let appendixAmountMismatches = 0

    for (const o of orders) {
      const hasInvoice = o.documents.some(d => d.type === 'INVOICE')
      const hasAct = o.documents.some(d => d.type === 'ACT')
      const needsInvoice = o.documentFlowType === 'INVOICE_ONLY' || o.documentFlowType === 'INVOICE_AND_ACT' || o.documentFlowType === 'CONTRACT_INVOICE_ACT'
      const needsAct = o.documentFlowType === 'INVOICE_AND_ACT' || o.documentFlowType === 'CONTRACT_INVOICE_ACT'
      if (needsInvoice && !hasInvoice) ordersWithoutInvoice += 1
      if (needsAct && o.status === 'COMPLETED' && !hasAct) completedWorksWithoutAct += 1
      const reasons = getWorkDocumentAttentionReasons({
        documentFlowType: o.documentFlowType, montageDocumentMode: null,
        isCompleted: o.status === 'COMPLETED', isCancelledOrArchived: false,
        hasInvoice, hasAct, paymentState: 'UNKNOWN',
      })
      if (reasons.length > 0) attentionCount += 1
      const appendix = o.documents.find(d => d.type === 'APPENDIX' && d.amount != null)
      if (appendix && o.preliminaryAmount != null && Math.abs(appendix.amount! - o.preliminaryAmount) > 0.01) {
        appendixAmountMismatches += 1
      }
    }
    for (const m of montageProjects) {
      const hasInvoice = m.documents.some(d => d.type === 'INVOICE')
      const hasAct = m.documents.some(d => d.type === 'ACT')
      const reasons = getWorkDocumentAttentionReasons({
        documentFlowType: null, montageDocumentMode: m.documentMode,
        isCompleted: m.status === 'DELIVERED', isCancelledOrArchived: false,
        hasInvoice, hasAct, paymentState: 'UNKNOWN',
      })
      if (reasons.length > 0) attentionCount += 1
      if (m.documentMode === 'SEPARATE' && m.status === 'DELIVERED' && !hasAct) completedWorksWithoutAct += 1
      const appendix = m.documents.find(d => d.type === 'APPENDIX' && d.amount != null)
      if (appendix && m.clientAmount != null && Math.abs(appendix.amount! - m.clientAmount) > 0.01) {
        appendixAmountMismatches += 1
      }
    }

    // Клиенты-юрлица без указанного статуса договора тоже считаются в общем attentionCount
    const legalClientsUnspecified = await prisma.client.findMany({
      where: { deletedAt: null, type: { in: ['LLC', 'IP'] }, contractState: 'UNSPECIFIED' },
      select: { id: true, type: true, contractState: true },
    })
    for (const c of legalClientsUnspecified) {
      if (getClientContractAttentionReasons(c.type, c.contractState).length > 0) attentionCount += 1
    }

    return {
      ok: true,
      data: {
        contractsTotal, contractsActive, clientsWithoutContract, appendicesTotal,
        invoicesTotal: invoices.length, invoicesUnpaid,
        actsTotal: acts, ordersWithoutInvoice, completedWorksWithoutAct, attentionCount,
        appendixAmountMismatches,
      },
    }
  } catch (e) {
    console.error('[getDocumentsDashboardStats]', e)
    return { ok: false, data: null, error: 'Не удалось загрузить статистику документов' }
  }
}

// ============================================================
// СВОДКА ДОГОВОРА КЛИЕНТА — компактная версия getDocumentsForClient для
// встраиваемого блока "Документы" в карточке заказа/монтажа (WorkDocumentsSection):
// там не нужен полный список всех документов клиента, только текущее
// состояние договора и номер активного, если есть.
// ============================================================

export interface ClientContractSummary {
  contractState: ClientContractState
  contractStateComment: string | null
  activeContractDisplayNumber: string | null
  // Реальный id действующего договора — нужен, чтобы WorkDocumentsSection мог
  // создать приложение с правильным contractId (display-номер для этого не
  // годится, это уже отформатированная строка "№18").
  activeContractId: string | null
  clientType: ClientType
}

// Текущий режим документооборота работы — читается отдельно от списка
// документов, чтобы WorkDocumentsSection показывал верное значение селектора
// независимо от того, есть ли у родительской модалки (EventCardModal не
// всегда грузит OrderDTO целиком) уже эти данные под рукой.
export async function getOrderDocumentFlowType(orderId: string): Promise<{ ok: true; data: DocumentFlowType } | { ok: false; data: null; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: null, error: authResult.error }
  try {
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { documentFlowType: true } })
    return { ok: true, data: order?.documentFlowType ?? 'UNKNOWN' }
  } catch (e) {
    console.error('[getOrderDocumentFlowType]', e)
    return { ok: false, data: null, error: 'Не удалось загрузить режим документооборота' }
  }
}

export async function getMontageDocumentMode(montageProjectId: string): Promise<{ ok: true; data: MontageDocumentMode } | { ok: false; data: null; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: null, error: authResult.error }
  try {
    const project = await prisma.montageProject.findUnique({ where: { id: montageProjectId }, select: { documentMode: true } })
    return { ok: true, data: project?.documentMode ?? 'UNKNOWN' }
  } catch (e) {
    console.error('[getMontageDocumentMode]', e)
    return { ok: false, data: null, error: 'Не удалось загрузить режим документов монтажа' }
  }
}

export async function getClientContractSummary(clientId: string): Promise<
  { ok: true; data: ClientContractSummary } | { ok: false; data: null; error: string }
> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: null, error: authResult.error }
  try {
    const [client, activeContract] = await Promise.all([
      prisma.client.findUnique({ where: { id: clientId }, select: { contractState: true, contractStateComment: true, type: true } }),
      prisma.document.findFirst({ where: { type: 'CONTRACT', clientId, status: 'ACTIVE' }, orderBy: { number: 'desc' } }),
    ])
    return {
      ok: true,
      data: {
        contractState: client?.contractState ?? 'UNSPECIFIED',
        contractStateComment: client?.contractStateComment ?? null,
        activeContractDisplayNumber: activeContract ? getDocumentDisplayNumber(activeContract, null) : null,
        activeContractId: activeContract?.id ?? null,
        clientType: client?.type ?? 'INDIVIDUAL',
      },
    }
  } catch (e) {
    console.error('[getClientContractSummary]', e)
    return { ok: false, data: null, error: 'Не удалось загрузить статус договора' }
  }
}

// ============================================================
// РЕЖИМ ДОКУМЕНТООБОРОТА РАБОТЫ — точечное изменение одного поля, отдельное
// от общей формы заказа/монтажа (см. WorkDocumentsSection: тот же принцип,
// что overlay-действия паузы/отмены/архива в MontageProjectModal — не
// заведено в общий Save формы, чтобы не трогать её большую логику сохранения).
// ============================================================

export async function updateOrderDocumentFlowType(orderId: string, documentFlowType: DocumentFlowType): Promise<{ ok: true } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const order = await prisma.order.update({ where: { id: orderId }, data: { documentFlowType } })
    await writeAuditLog({ userId: authResult.userId, action: 'ORDER_DOCUMENT_FLOW_TYPE_CHANGED', entityType: 'Order', entityId: orderId, metadata: { documentFlowType } })
    revalidateDocumentPaths({ orderId, clientId: order.clientId })
    return { ok: true }
  } catch (e) {
    console.error('[updateOrderDocumentFlowType]', e)
    return { ok: false, error: 'Не удалось обновить режим документооборота' }
  }
}

export async function updateMontageDocumentMode(montageProjectId: string, documentMode: MontageDocumentMode): Promise<{ ok: true } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  try {
    const project = await prisma.montageProject.update({ where: { id: montageProjectId }, data: { documentMode } })
    await writeAuditLog({ userId: authResult.userId, action: 'MONTAGE_DOCUMENT_MODE_CHANGED', entityType: 'MontageProject', entityId: montageProjectId, metadata: { documentMode } })
    revalidateDocumentPaths({ montageProjectId, clientId: project.clientId })
    return { ok: true }
  } catch (e) {
    console.error('[updateMontageDocumentMode]', e)
    return { ok: false, error: 'Не удалось обновить режим документов монтажа' }
  }
}

// ============================================================
// ТАБЛИЦЫ "СЧЕТА" / "АКТЫ" — единая таблица по всем работам (раздел 24/25 ТЗ)
// ============================================================

export interface WorkDocumentRowDTO {
  id: string
  displayNumber: string
  issueDate: string
  status: DocumentStatus
  purpose: InvoicePurpose | null
  amount: number | null
  clientName: string
  workTitle: string
  workKind: 'ORDER' | 'MONTAGE'
  workHref: string
  paymentState: ReturnType<typeof getDocumentPaymentState>
}

async function listWorkDocuments(type: 'INVOICE' | 'ACT'): Promise<WorkDocumentRowDTO[]> {
  const rows = await prisma.document.findMany({
    where: { type },
    orderBy: { issueDate: 'desc' },
    include: {
      order: { select: { documentPackageNumber: true, title: true, clientName: true, paymentStatus: true, client: { select: { name: true } } } },
      montageProject: { select: { documentPackageNumber: true, title: true, clientPaymentStatus: true, clientName: true, client: { select: { name: true } }, order: { select: { client: { select: { name: true } }, clientName: true } } } },
    },
  })
  return rows.map(r => {
    const workPackageNumber = r.order?.documentPackageNumber ?? r.montageProject?.documentPackageNumber ?? null
    const clientName = r.order?.client?.name ?? r.order?.clientName
      ?? r.montageProject?.client?.name ?? r.montageProject?.order?.client?.name ?? r.montageProject?.order?.clientName ?? r.montageProject?.clientName
      ?? '—'
    return {
      id: r.id,
      displayNumber: getDocumentDisplayNumber(r, workPackageNumber),
      issueDate: r.issueDate.toISOString(),
      status: r.status,
      purpose: r.purpose,
      amount: r.amount,
      clientName,
      workTitle: r.order?.title ?? r.montageProject?.title ?? '—',
      workKind: r.orderId ? 'ORDER' : 'MONTAGE',
      workHref: r.orderId ? '/admin/orders' : '/admin/editing',
      paymentState: getDocumentPaymentState(r.order?.paymentStatus ?? null, r.montageProject?.clientPaymentStatus ?? null),
    }
  })
}

export async function getInvoicesList(): Promise<{ ok: true; data: WorkDocumentRowDTO[] } | { ok: false; data: WorkDocumentRowDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    return { ok: true, data: await listWorkDocuments('INVOICE') }
  } catch (e) {
    console.error('[getInvoicesList]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить счета' }
  }
}

export async function getActsList(): Promise<{ ok: true; data: WorkDocumentRowDTO[] } | { ok: false; data: WorkDocumentRowDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    return { ok: true, data: await listWorkDocuments('ACT') }
  } catch (e) {
    console.error('[getActsList]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить акты' }
  }
}

// ============================================================
// ПРИЛОЖЕНИЯ К ДОГОВОРУ — единый список для раздела "Документы" (таб
// "Приложения"). Клиент читается через contract.client (у самого APPENDIX
// clientId не проставляется — единый источник, не копия, см. AGENTS.md).
// Поиск/фильтры — на фронте (AppendicesTable.tsx), весь массив приходит сразу,
// тот же паттерн, что ClientsSection.tsx при текущем объёме данных.
// ============================================================

export interface AppendixRowDTO {
  id: string
  displayNumber: string
  issueDate: string
  amount: number | null
  serviceDescription: string | null
  comment: string | null
  contractId: string
  contractDisplayNumber: string
  clientId: string
  clientName: string
  orderId: string | null
  orderTitle: string | null
  montageProjectId: string | null
  montageTitle: string | null
  isArchived: boolean
}

export async function getAppendicesList(): Promise<{ ok: true; data: AppendixRowDTO[] } | { ok: false; data: AppendixRowDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const rows = await prisma.document.findMany({
      where: { type: 'APPENDIX' },
      orderBy: { issueDate: 'desc' },
      include: {
        contract: { include: { client: { select: { id: true, name: true } } } },
        order: { select: { title: true } },
        montageProject: { select: { title: true } },
      },
    })
    const data: AppendixRowDTO[] = rows
      .filter(r => r.contract)
      .map(r => ({
        id: r.id,
        displayNumber: getDocumentDisplayNumber(r, null),
        issueDate: r.issueDate.toISOString(),
        amount: r.amount,
        serviceDescription: r.serviceDescription,
        comment: r.comment,
        contractId: r.contract!.id,
        contractDisplayNumber: getDocumentDisplayNumber(r.contract!, null),
        clientId: r.contract!.client?.id ?? '',
        clientName: r.contract!.client?.name ?? '—',
        orderId: r.orderId,
        orderTitle: r.order?.title ?? null,
        montageProjectId: r.montageProjectId,
        montageTitle: r.montageProject?.title ?? null,
        isArchived: r.status === 'ARCHIVED',
      }))
    return { ok: true, data }
  } catch (e) {
    console.error('[getAppendicesList]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить приложения' }
  }
}

// ============================================================
// "ТРЕБУЮТ ВНИМАНИЯ" — единый список проблем всех работ + клиентов (раздел 26 ТЗ)
// ============================================================

export interface DocumentAttentionRowDTO {
  id: string
  workTitle: string
  workHref: string
  reasons: DocumentAttentionReason[]
}

export async function getDocumentAttentionList(): Promise<{ ok: true; data: DocumentAttentionRowDTO[] } | { ok: false; data: DocumentAttentionRowDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const [orders, montageProjects, legalClients] = await Promise.all([
      prisma.order.findMany({
        where: { isArchived: false, status: { notIn: ['CANCELLED'] } },
        select: { id: true, title: true, clientName: true, status: true, documentFlowType: true, documents: { select: { type: true } } },
      }),
      prisma.montageProject.findMany({
        where: { isArchived: false, status: { not: 'CANCELLED' } },
        select: { id: true, title: true, status: true, documentMode: true, documents: { select: { type: true } } },
      }),
      prisma.client.findMany({
        where: { deletedAt: null, type: { in: ['LLC', 'IP'] }, contractState: 'UNSPECIFIED' },
        select: { id: true, name: true, type: true, contractState: true },
      }),
    ])

    const rows: DocumentAttentionRowDTO[] = []
    for (const o of orders) {
      const hasInvoice = o.documents.some(d => d.type === 'INVOICE')
      const hasAct = o.documents.some(d => d.type === 'ACT')
      const reasons = getWorkDocumentAttentionReasons({
        documentFlowType: o.documentFlowType, montageDocumentMode: null,
        isCompleted: o.status === 'COMPLETED', isCancelledOrArchived: false,
        hasInvoice, hasAct, paymentState: 'UNKNOWN',
      })
      if (reasons.length > 0) rows.push({ id: o.id, workTitle: o.title ?? o.clientName ?? 'Заказ', workHref: '/admin/orders', reasons })
    }
    for (const m of montageProjects) {
      const hasInvoice = m.documents.some(d => d.type === 'INVOICE')
      const hasAct = m.documents.some(d => d.type === 'ACT')
      const reasons = getWorkDocumentAttentionReasons({
        documentFlowType: null, montageDocumentMode: m.documentMode,
        isCompleted: m.status === 'DELIVERED', isCancelledOrArchived: false,
        hasInvoice, hasAct, paymentState: 'UNKNOWN',
      })
      if (reasons.length > 0) rows.push({ id: m.id, workTitle: m.title ?? 'Проект монтажа', workHref: '/admin/editing', reasons })
    }
    for (const c of legalClients) {
      const reasons = getClientContractAttentionReasons(c.type, c.contractState)
      if (reasons.length > 0) rows.push({ id: c.id, workTitle: c.name, workHref: `/admin/clients/${c.id}?tab=documents`, reasons })
    }

    return { ok: true, data: rows }
  } catch (e) {
    console.error('[getDocumentAttentionList]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить список проблем' }
  }
}
