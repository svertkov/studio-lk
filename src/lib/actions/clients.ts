'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import { type ClientType, type ClientStatus, type ClientSource, Prisma } from '@prisma/client'
import { computeVisitStats } from '@/lib/visit-stats'
import { computeStatusFromVisitCount } from '@/lib/client-model'

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
        visits: { select: { date: true, room: true, format: true, durationHours: true, grossAmount: true, netAmount: true } },
      },
    })

    const data = clients.map(({ visits, ...c }) => {
      const stats = computeVisitStats(visits)
      return {
        ...c,
        visitsCount: stats.totalVisits,
        totalHours: stats.totalHours,
        totalGross: stats.grossTotal,
        lastVisitDate: stats.lastVisit,
      }
    })

    return { ok: true as const, data }
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
        where: { deletedAt: null, status: { in: ['ACTIVE', 'REPEAT', 'REGULAR'] } },
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
        visits: { orderBy: { date: 'desc' } },
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
  firstName: string
  lastName?: string
  patronymic?: string
  workplace?: string
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
  // Заполняется только при создании клиента из кнопки "Создать клиента" на
  // странице Telegram-диалога (см. ConversationView.tsx) — после создания
  // клиента диалог автоматически связывается с ним же (TelegramConversation
  // .linkedClientId), одной атомарной транзакцией. Тот же паттерн, что и
  // Order.telegramConversationId в actions/orders.ts.
  telegramConversationId?: string
}

function buildFullName(parts: { lastName?: string; firstName?: string; patronymic?: string }) {
  return [parts.lastName, parts.firstName, parts.patronymic]
    .map(p => p?.trim())
    .filter(Boolean)
    .join(' ')
}

export async function createClient(input: CreateClientInput) {
  const userId = await getAuthUserId()

  try {
    const client = await prisma.$transaction(async tx => {
      const created = await tx.client.create({
        data: {
          name: buildFullName(input),
          firstName: input.firstName.trim(),
          lastName: input.lastName?.trim() || null,
          patronymic: input.patronymic?.trim() || null,
          workplace: input.workplace?.trim() || null,
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

      if (input.telegramConversationId) {
        // Условие linkedClientId: null в where — атомарная защита от дублей:
        // если диалог уже успели связать с другим клиентом (повторный клик,
        // гонка двух одновременных отправок формы), count будет 0 и весь
        // transaction откатится — новый Client не останется висеть без связи.
        const linked = await tx.telegramConversation.updateMany({
          where: { id: input.telegramConversationId, linkedClientId: null },
          data: { linkedClientId: created.id },
        })
        if (linked.count === 0) {
          throw new Error('TELEGRAM_CONVERSATION_ALREADY_LINKED')
        }

        // У диалога уже может быть заявка в «Заказы» (заведённая автоматически
        // на первое сообщение, или вручную кнопкой «Создать заказ» ДО того, как
        // появилась карточка клиента) — привязываем её к только что созданному
        // клиенту, если она ещё ни к кому не привязана. Сама заявка не создаётся
        // здесь заново — только дописывается clientId к уже существующей.
        await tx.order.updateMany({
          where: { telegramConversationId: input.telegramConversationId, clientId: null },
          data: { clientId: created.id },
        })
      }

      return created
    })

    await writeAuditLog({
      userId,
      action: 'CLIENT_CREATED',
      entityId: client.id,
      metadata: { name: client.name, type: client.type },
    })

    revalidatePath('/admin/clients')
    if (input.telegramConversationId) {
      revalidatePath('/admin/telegram')
      revalidatePath(`/admin/telegram/${input.telegramConversationId}`)
      revalidatePath('/admin/orders')
    }
    return { ok: true as const, data: client }
  } catch (e) {
    if (e instanceof Error && e.message === 'TELEGRAM_CONVERSATION_ALREADY_LINKED') {
      return { ok: false as const, error: 'Этот Telegram-диалог уже связан с другим клиентом' }
    }
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
    const nameChanged = input.firstName !== undefined || input.lastName !== undefined || input.patronymic !== undefined
    let computedName: string | undefined
    if (nameChanged) {
      const current = await prisma.client.findUnique({
        where: { id },
        select: { firstName: true, lastName: true, patronymic: true },
      })
      computedName = buildFullName({
        firstName: input.firstName !== undefined ? input.firstName : current?.firstName ?? undefined,
        lastName: input.lastName !== undefined ? input.lastName : current?.lastName ?? undefined,
        patronymic: input.patronymic !== undefined ? input.patronymic : current?.patronymic ?? undefined,
      })
    }

    const client = await prisma.client.update({
      where: { id },
      data: {
        ...(computedName !== undefined && { name: computedName }),
        ...(input.firstName !== undefined && { firstName: input.firstName.trim() }),
        ...(input.lastName !== undefined && { lastName: input.lastName?.trim() || null }),
        ...(input.patronymic !== undefined && { patronymic: input.patronymic?.trim() || null }),
        ...(input.workplace !== undefined && { workplace: input.workplace?.trim() || null }),
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
// ОБЪЕДИНЕНИЕ КЛИЕНТОВ
// ============================================================

export async function mergeClients(sourceId: string, targetId: string) {
  if (sourceId === targetId) return { ok: false as const, error: 'Нельзя объединить клиента с самим собой' }
  const userId = await getAuthUserId()

  try {
    const [source, target] = await Promise.all([
      prisma.client.findFirst({ where: { id: sourceId, deletedAt: null } }),
      prisma.client.findFirst({ where: { id: targetId, deletedAt: null } }),
    ])
    if (!source || !target) {
      return { ok: false as const, error: 'Один из клиентов не найден' }
    }

    await prisma.$transaction(async tx => {
      // Сохраняем данные объединяемого клиента как доп. контакт на основной карточке — данные не теряются
      await tx.clientContact.create({
        data: {
          clientId: targetId,
          name: source.name,
          phone: source.phone,
          telegram: source.telegram,
          email: source.email,
          comment: `Объединено с карточкой «${source.name}»${source.workplace ? ` (${source.workplace})` : ''}`,
        },
      })

      // Переносим историю визитов, документы и заметки на основную карточку
      await tx.clientVisit.updateMany({ where: { clientId: sourceId }, data: { clientId: targetId } })
      await tx.document.updateMany({ where: { clientId: sourceId }, data: { clientId: targetId } })
      await tx.clientNote.updateMany({ where: { clientId: sourceId }, data: { clientId: targetId } })

      // Пересчитываем статус основной карточки по итоговому числу визитов после объединения
      const totalVisits = await tx.clientVisit.count({ where: { clientId: targetId } })
      await tx.client.update({ where: { id: targetId }, data: { status: computeStatusFromVisitCount(totalVisits) } })

      // Архивируем объединённую карточку (мягкое удаление, не насовсем)
      await tx.client.update({ where: { id: sourceId }, data: { deletedAt: new Date() } })
    })

    await writeAuditLog({
      userId,
      action: 'CLIENT_MERGED',
      entityId: targetId,
      metadata: { mergedFromId: sourceId, mergedFromName: source.name, targetName: target.name },
    })

    revalidatePath('/admin/clients')
    revalidatePath(`/admin/clients/${sourceId}`)
    revalidatePath(`/admin/clients/${targetId}`)
    return { ok: true as const }
  } catch (e) {
    console.error('[mergeClients]', e)
    return { ok: false as const, error: 'Не удалось объединить клиентов' }
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
