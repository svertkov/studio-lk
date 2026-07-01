'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import { type ClientType, type ClientStatus, type ClientSource, Prisma } from '@prisma/client'

// ============================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================

async function getAuthUserId(): Promise<string | null> {
  try {
    const session = await auth()
    return session?.user?.id ?? null
  } catch {
    return null
  }
}

async function writeAuditLog(params: {
  userId: string | null
  action: string
  entityId: string
  metadata?: Record<string, unknown>
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entityType: 'Client',
        entityId: params.entityId,
        metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
      },
    })
  } catch {
    // Не блокируем основную операцию если лог не записался
  }
}

// ============================================================
// СПИСОК КЛИЕНТОВ
// ============================================================

export interface ClientFilters {
  search?: string
  type?: ClientType | null
  status?: ClientStatus | null
  source?: ClientSource | null
  withDebt?: boolean
  onlyLegal?: boolean  // не физлица
  onlyRegular?: boolean  // total_sessions > 1 (пока не реализовано в Prisma)
}

export async function getClients(filters: ClientFilters = {}) {
  try {
    const where: Prisma.ClientWhereInput = {
      deletedAt: null,
    }

    if (filters.search) {
      const q = filters.search.trim()
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { companyName: { contains: q, mode: 'insensitive' } },
        { telegram: { contains: q, mode: 'insensitive' } },
        { contactPerson: { contains: q, mode: 'insensitive' } },
      ]
    }

    if (filters.type) where.type = filters.type
    if (filters.status) where.status = filters.status
    if (filters.source) where.source = filters.source
    if (filters.onlyLegal) where.type = { not: 'INDIVIDUAL' }

    const clients = await prisma.client.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        contacts: { take: 1, orderBy: { createdAt: 'asc' } },
      },
    })

    return { ok: true as const, data: clients }
  } catch (e) {
    console.error('[getClients]', e)
    return { ok: false as const, data: [], error: 'DB не подключена или произошла ошибка' }
  }
}

// ============================================================
// СТАТИСТИКА ДЛЯ ДАШБОРДА
// ============================================================

export async function getClientsStats() {
  try {
    const [total, active, legal] = await Promise.all([
      prisma.client.count({ where: { deletedAt: null } }),
      prisma.client.count({
        where: { deletedAt: null, status: { in: ['ACTIVE', 'REGULAR'] } },
      }),
      prisma.client.count({
        where: { deletedAt: null, type: { not: 'INDIVIDUAL' } },
      }),
    ])
    return { ok: true as const, total, active, legal, debt: 0 }
  } catch {
    return { ok: false as const, total: 0, active: 0, legal: 0, debt: 0 }
  }
}

// ============================================================
// ОДИН КЛИЕНТ
// ============================================================

export async function getClientById(id: string) {
  try {
    const client = await prisma.client.findFirst({
      where: { id, deletedAt: null },
      include: {
        contacts: { orderBy: { createdAt: 'asc' } },
        clientNotes: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        documents: { orderBy: { createdAt: 'desc' } },
      },
    })
    return { ok: true as const, data: client }
  } catch (e) {
    console.error('[getClientById]', e)
    return { ok: false as const, data: null, error: 'Ошибка загрузки клиента' }
  }
}

// ============================================================
// СОЗДАТЬ КЛИЕНТА
// ============================================================

export interface CreateClientInput {
  name: string
  type?: ClientType
  status?: ClientStatus
  source?: ClientSource | null
  customSource?: string
  contactPerson?: string
  phone?: string
  telegram?: string
  email?: string
  companyName?: string
  inn?: string
  kpp?: string
  ogrn?: string
  legalAddress?: string
  documentComment?: string
  notes?: string
  responsibleUserId?: string
}

export async function createClient(input: CreateClientInput) {
  const userId = await getAuthUserId()

  try {
    const client = await prisma.client.create({
      data: {
        name: input.name.trim(),
        type: input.type ?? 'INDIVIDUAL',
        status: input.status ?? 'NEW',
        source: input.source ?? null,
        customSource: input.customSource?.trim() || null,
        contactPerson: input.contactPerson?.trim() || null,
        phone: input.phone?.trim() || null,
        telegram: input.telegram?.trim() || null,
        email: input.email?.trim() || null,
        companyName: input.companyName?.trim() || null,
        inn: input.inn?.trim() || null,
        kpp: input.kpp?.trim() || null,
        ogrn: input.ogrn?.trim() || null,
        legalAddress: input.legalAddress?.trim() || null,
        documentComment: input.documentComment?.trim() || null,
        notes: input.notes?.trim() || null,
        responsibleUserId: input.responsibleUserId || null,
      },
    })

    await writeAuditLog({
      userId,
      action: 'CLIENT_CREATED',
      entityId: client.id,
      metadata: { name: client.name, type: client.type },
    })

    revalidatePath('/admin/clients')
    return { ok: true as const, data: client }
  } catch (e) {
    console.error('[createClient]', e)
    return { ok: false as const, error: 'Не удалось создать клиента' }
  }
}

// ============================================================
// ОБНОВИТЬ КЛИЕНТА
// ============================================================

export type UpdateClientInput = Partial<CreateClientInput>

export async function updateClient(id: string, input: UpdateClientInput) {
  const userId = await getAuthUserId()

  try {
    const client = await prisma.client.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.source !== undefined && { source: input.source }),
        ...(input.customSource !== undefined && { customSource: input.customSource?.trim() || null }),
        ...(input.contactPerson !== undefined && { contactPerson: input.contactPerson?.trim() || null }),
        ...(input.phone !== undefined && { phone: input.phone?.trim() || null }),
        ...(input.telegram !== undefined && { telegram: input.telegram?.trim() || null }),
        ...(input.email !== undefined && { email: input.email?.trim() || null }),
        ...(input.companyName !== undefined && { companyName: input.companyName?.trim() || null }),
        ...(input.inn !== undefined && { inn: input.inn?.trim() || null }),
        ...(input.kpp !== undefined && { kpp: input.kpp?.trim() || null }),
        ...(input.ogrn !== undefined && { ogrn: input.ogrn?.trim() || null }),
        ...(input.legalAddress !== undefined && { legalAddress: input.legalAddress?.trim() || null }),
        ...(input.documentComment !== undefined && { documentComment: input.documentComment?.trim() || null }),
        ...(input.notes !== undefined && { notes: input.notes?.trim() || null }),
        ...(input.responsibleUserId !== undefined && { responsibleUserId: input.responsibleUserId || null }),
      },
    })

    await writeAuditLog({
      userId,
      action: 'CLIENT_UPDATED',
      entityId: id,
      metadata: { fields: Object.keys(input) },
    })

    revalidatePath('/admin/clients')
    revalidatePath(`/admin/clients/${id}`)
    return { ok: true as const, data: client }
  } catch (e) {
    console.error('[updateClient]', e)
    return { ok: false as const, error: 'Не удалось обновить клиента' }
  }
}

// ============================================================
// МЯГКОЕ УДАЛЕНИЕ (SOFT DELETE)
// Данные не удаляются физически — устанавливается deletedAt
// ============================================================

export async function softDeleteClient(id: string) {
  const userId = await getAuthUserId()

  try {
    await prisma.client.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    await writeAuditLog({
      userId,
      action: 'CLIENT_DELETED',
      entityId: id,
    })

    revalidatePath('/admin/clients')
    return { ok: true as const }
  } catch (e) {
    console.error('[softDeleteClient]', e)
    return { ok: false as const, error: 'Не удалось удалить клиента' }
  }
}

// ============================================================
// ЗАМЕТКИ
// ============================================================

export async function addClientNote(clientId: string, text: string) {
  const userId = await getAuthUserId()

  try {
    const note = await prisma.clientNote.create({
      data: { clientId, authorId: userId, text: text.trim() },
    })
    revalidatePath(`/admin/clients/${clientId}`)
    return { ok: true as const, data: note }
  } catch (e) {
    console.error('[addClientNote]', e)
    return { ok: false as const, error: 'Не удалось сохранить заметку' }
  }
}
