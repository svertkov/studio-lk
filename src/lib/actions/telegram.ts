'use server'

import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import type {
  TelegramConversation, TelegramMessage, Client,
  TelegramConversationStatus, TelegramMessageDirection,
} from '@prisma/client'

// ============================================================
// АВТОРИЗАЦИЯ — доступ к разделу "Telegram" только у Owner/Admin, так как
// переписки с клиентами это персональные данные. Это первое место в проекте,
// где серверное действие проверяет конкретную роль, а не только наличие
// сессии (см. requireStaffSession в orders.ts — там проверяется только вход).
// ============================================================

const ALLOWED_ROLES = ['OWNER', 'ADMIN']

async function requireTelegramAccess(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await auth()
    if (!session?.user) return { ok: false, error: 'Требуется авторизация' }
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return { ok: false, error: 'Доступ к разделу Telegram есть только у владельца и администратора' }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: 'Требуется авторизация' }
  }
}

// ============================================================
// СЕРИАЛИЗАЦИЯ
// ============================================================

type ConversationWithRelations = TelegramConversation & {
  linkedClient: Pick<Client, 'id' | 'name'> | null
  order: { id: string } | null
  aiDraft: { id: string } | null
  messages: TelegramMessage[]
}

export interface TelegramMessageDTO {
  id: string
  direction: TelegramMessageDirection
  text: string | null
  senderName: string | null
  createdAt: string
}

export interface TelegramConversationListItemDTO {
  id: string
  telegramUsername: string | null
  clientNameGuess: string | null
  linkedClientId: string | null
  linkedClientName: string | null
  status: TelegramConversationStatus
  lastMessageAt: string | null
  lastMessageText: string | null
  hasOrder: boolean
  hasDraft: boolean
  createdAt: string
}

export interface TelegramConversationDetailDTO extends TelegramConversationListItemDTO {
  telegramUserId: string | null
  phone: string | null
  orderId: string | null
  messages: TelegramMessageDTO[]
}

function toMessageDTO(m: TelegramMessage): TelegramMessageDTO {
  return {
    id: m.id,
    direction: m.direction,
    text: m.text,
    senderName: m.senderName,
    createdAt: m.createdAt.toISOString(),
  }
}

function toListDTO(row: ConversationWithRelations): TelegramConversationListItemDTO {
  const lastMessage = row.messages[0]
  return {
    id: row.id,
    telegramUsername: row.telegramUsername,
    clientNameGuess: row.clientNameGuess,
    linkedClientId: row.linkedClient?.id ?? null,
    linkedClientName: row.linkedClient?.name ?? null,
    status: row.status,
    lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
    lastMessageText: lastMessage?.text ?? null,
    hasOrder: !!row.order,
    hasDraft: !!row.aiDraft,
    createdAt: row.createdAt.toISOString(),
  }
}

function toDetailDTO(row: ConversationWithRelations): TelegramConversationDetailDTO {
  return {
    ...toListDTO(row),
    telegramUserId: row.telegramUserId,
    phone: row.phone,
    orderId: row.order?.id ?? null,
    messages: row.messages.map(toMessageDTO),
  }
}

const CONVERSATION_INCLUDE_LIST = {
  linkedClient: { select: { id: true, name: true } },
  order: { select: { id: true } },
  aiDraft: { select: { id: true } },
  messages: { orderBy: { createdAt: 'desc' as const }, take: 1 },
}

// ============================================================
// СПИСОК ДИАЛОГОВ
// ============================================================

export async function getConversations(): Promise<
  { ok: true; data: TelegramConversationListItemDTO[] } | { ok: false; data: []; error: string }
> {
  const access = await requireTelegramAccess()
  if (!access.ok) return { ok: false, data: [], error: access.error }

  try {
    const rows = await prisma.telegramConversation.findMany({
      orderBy: { lastMessageAt: 'desc' },
      include: CONVERSATION_INCLUDE_LIST,
    })
    return { ok: true, data: rows.map(toListDTO) }
  } catch (e) {
    console.error('[getConversations]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить список диалогов' }
  }
}

// ============================================================
// ДИАЛОГ + ИСТОРИЯ СООБЩЕНИЙ
// ============================================================

export async function getConversationDetail(
  id: string
): Promise<{ ok: true; data: TelegramConversationDetailDTO } | { ok: false; error: string }> {
  const access = await requireTelegramAccess()
  if (!access.ok) return { ok: false, error: access.error }

  try {
    const row = await prisma.telegramConversation.findUnique({
      where: { id },
      include: {
        linkedClient: { select: { id: true, name: true } },
        order: { select: { id: true } },
        aiDraft: { select: { id: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    })
    if (!row) return { ok: false, error: 'Диалог не найден' }
    return { ok: true, data: toDetailDTO(row) }
  } catch (e) {
    console.error('[getConversationDetail]', e)
    return { ok: false, error: 'Не удалось загрузить диалог' }
  }
}
