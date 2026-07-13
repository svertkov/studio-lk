'use server'

import { revalidatePath } from 'next/cache'
import { get as getBlob, del as deleteBlob } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import {
  sendTelegramMessage, sendTelegramPhoto, sendTelegramDocument, sendTelegramVideo,
  getTelegramWebhookInfo, getTelegramBotInfo, isTelegramBotTokenConfigured,
} from '@/lib/telegram'
import { revokeConsent } from '@/lib/telegram-consent'
import { DEFAULT_CONSENT_TEXT, DEFAULT_MANAGER_HANDOFF_MESSAGE, computeChatPriority, type TelegramChatPriority } from '@/lib/telegram-model'
import { extractLinks } from '@/lib/telegram-ui-utils'
import type {
  TelegramConversation, TelegramMessage, TelegramMessageAttachment, TelegramSettings, Client, User,
  TelegramConversationStatus, TelegramConsentStatus, TelegramMessageDirection, TelegramMessageStatus, TelegramMessageType, TelegramSenderType,
} from '@prisma/client'
import { writeAuditLog as writeAuditLogEntry } from '@/lib/audit'

// ============================================================
// АВТОРИЗАЦИЯ — доступ к разделу "Telegram" только у Owner/Admin (как у
// "Заказов"). Настройки/токен — только Owner. Это первое место в проекте,
// где действие проверяет конкретную роль, а не только наличие сессии.
// ============================================================

const TELEGRAM_ACCESS_ROLES = ['OWNER', 'ADMIN']

async function requireTelegramAccess(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  try {
    const session = await auth()
    if (!session?.user) return { ok: false, error: 'Требуется авторизация' }
    if (!TELEGRAM_ACCESS_ROLES.includes(session.user.role)) {
      return { ok: false, error: 'Доступ к разделу Telegram есть только у владельца и администратора' }
    }
    return { ok: true, userId: session.user.id }
  } catch {
    return { ok: false, error: 'Требуется авторизация' }
  }
}

async function requireTelegramOwnerAccess(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const access = await requireTelegramAccess()
  if (!access.ok) return access
  const session = await auth()
  if (session?.user.role !== 'OWNER') {
    return { ok: false, error: 'Настройки Telegram-модуля может менять только владелец' }
  }
  return access
}

function writeAuditLog(params: { userId: string | null; action: string; entityId: string; metadata?: Record<string, unknown> }) {
  return writeAuditLogEntry({ ...params, entityType: 'TelegramConversation' })
}

// ============================================================
// СЕРИАЛИЗАЦИЯ
// ============================================================

type ConversationWithRelations = TelegramConversation & {
  linkedClient: Pick<Client, 'id' | 'name'> | null
  assignedAdmin: Pick<User, 'id' | 'name' | 'email'> | null
  order: { id: string } | null
  messages: TelegramMessage[]
}

export interface TelegramMessageAttachmentDTO {
  id: string
  fileName: string | null
  mimeType: string | null
  fileSize: number | null
  duration: number | null
  width: number | null
  height: number | null
  isAnimatedSticker: boolean
  fileUrl: string
  downloadUrl: string
}

export interface TelegramMessageDTO {
  id: string
  // Telegram-овский message_id (не наш cuid) — нужен ConversationView, чтобы
  // найти среди сообщений то самое, где была кнопка «Принять согласие»
  // (сверяется с TelegramConversationDetailDTO.consentRequestMessageId).
  telegramMessageId: string | null
  direction: TelegramMessageDirection
  senderType: TelegramSenderType
  messageType: TelegramMessageType
  text: string | null
  senderName: string | null
  status: TelegramMessageStatus
  errorMessage: string | null
  createdAt: string
  sentAt: string | null
  attachment: TelegramMessageAttachmentDTO | null
}

export interface TelegramConversationListItemDTO {
  id: string
  telegramUsername: string | null
  telegramUserId: string | null
  clientNameGuess: string | null
  linkedClientId: string | null
  linkedClientName: string | null
  orderId: string | null
  assignedAdminId: string | null
  assignedAdminName: string | null
  status: TelegramConversationStatus
  consentStatus: TelegramConsentStatus
  // Нужен для getConsentDisplayStatus() — отличить "не запрошено" от
  // "ожидаем" (оба технически consentStatus=NONE).
  consentRequestSentAt: string | null
  // Вычисляется computeChatPriority() из уже существующих полей — см.
  // telegram-model.ts. Не хранится отдельной колонкой: пересчитывается на
  // каждый список, поэтому не может "протухнуть" (например, порог 7 дней
  // неактивности сам по себе меняется со временем без каких-либо действий).
  chatPriority: TelegramChatPriority
  unreadCount: number
  isPinned: boolean
  archivedAt: string | null
  lastMessageAt: string | null
  lastMessageText: string | null
  createdAt: string
  updatedAt: string
}

export interface TelegramConsentRecordDTO {
  id: string
  consentVersion: string
  policyUrl: string | null
  status: string
  givenAt: string | null
  revokedAt: string | null
}

export interface TelegramInternalNoteDTO {
  id: string
  authorUserId: string
  authorName: string | null
  text: string
  createdAt: string
  updatedAt: string
}

export interface TelegramConversationDetailDTO extends TelegramConversationListItemDTO {
  telegramChatId: string
  phone: string | null
  // Раздельные first/last из Telegram-профиля (в отличие от clientNameGuess
  // на списковом DTO, который их уже склеил) — используются только для
  // предзаполнения формы "Создать клиента", см. ConversationView.tsx.
  telegramFirstName: string | null
  telegramLastName: string | null
  consentRequestVersion: string | null
  // Telegram message_id сообщения с кнопкой «Принять согласие» — ConversationView
  // сверяет его с TelegramMessageDTO.telegramMessageId, чтобы нарисовать
  // визуальный предпросмотр кнопки под нужным сообщением в ленте.
  consentRequestMessageId: string | null
  messages: TelegramMessageDTO[]
  consents: TelegramConsentRecordDTO[]
  internalNotes: TelegramInternalNoteDTO[]
}

function toMessageDTO(m: TelegramMessage & { attachment: TelegramMessageAttachment | null }): TelegramMessageDTO {
  return {
    id: m.id,
    telegramMessageId: m.telegramMessageId,
    direction: m.direction,
    senderType: m.senderType,
    messageType: m.messageType,
    text: m.text,
    senderName: m.senderName,
    status: m.status,
    errorMessage: m.errorMessage,
    attachment: m.attachment
      ? {
          id: m.attachment.id,
          fileName: m.attachment.fileName,
          mimeType: m.attachment.mimeType,
          fileSize: m.attachment.fileSize,
          duration: m.attachment.duration,
          width: m.attachment.width,
          height: m.attachment.height,
          isAnimatedSticker: m.attachment.isAnimatedSticker,
          fileUrl: `/api/telegram/file/${m.attachment.id}`,
          downloadUrl: `/api/telegram/file/${m.attachment.id}?download=1`,
        }
      : null,
    createdAt: m.createdAt.toISOString(),
    sentAt: m.sentAt ? m.sentAt.toISOString() : null,
  }
}

function toListDTO(row: ConversationWithRelations): TelegramConversationListItemDTO {
  // Не полагаемся на row.messages[0] — вызывающие запросы сортируют историю
  // по-разному (список диалогов берёт только последнее сообщение, отсортировав
  // desc; getConversationDetail загружает всю историю asc для показа треда
  // сверху вниз, и там messages[0] — это САМОЕ СТАРОЕ сообщение). Ищем
  // максимум по createdAt явно, чтобы toListDTO корректно работал при любом
  // порядке входного массива.
  const lastMessage = row.messages.length > 0
    ? row.messages.reduce((latest, m) => (m.createdAt > latest.createdAt ? m : latest))
    : undefined
  const orderId = row.order?.id ?? null
  return {
    id: row.id,
    telegramUsername: row.telegramUsername,
    telegramUserId: row.telegramUserId,
    clientNameGuess: row.clientNameGuess,
    linkedClientId: row.linkedClient?.id ?? null,
    linkedClientName: row.linkedClient?.name ?? null,
    orderId,
    assignedAdminId: row.assignedAdmin?.id ?? null,
    assignedAdminName: row.assignedAdmin?.name ?? row.assignedAdmin?.email ?? null,
    status: row.status,
    consentStatus: row.consentStatus,
    consentRequestSentAt: row.consentRequestSentAt ? row.consentRequestSentAt.toISOString() : null,
    chatPriority: computeChatPriority({
      conversationStatus: row.status,
      unreadCount: row.unreadCount,
      linkedClientId: row.linkedClient?.id ?? null,
      orderId,
      lastMessageAt: row.lastMessageAt,
    }),
    unreadCount: row.unreadCount,
    isPinned: row.isPinned,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
    lastMessageText: lastMessage?.text ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

const CONVERSATION_INCLUDE_LIST = {
  linkedClient: { select: { id: true, name: true } },
  assignedAdmin: { select: { id: true, name: true, email: true } },
  order: { select: { id: true } },
  messages: { orderBy: { createdAt: 'desc' as const }, take: 1 },
}

// ============================================================
// СПИСОК ДИАЛОГОВ — фильтр по статусу + поиск
// ============================================================

export type TelegramConversationFilter = TelegramConversationStatus | 'ALL'

export async function getConversations(params: { filter?: TelegramConversationFilter; search?: string } = {}): Promise<
  { ok: true; data: TelegramConversationListItemDTO[] } | { ok: false; data: []; error: string }
> {
  const access = await requireTelegramAccess()
  if (!access.ok) return { ok: false, data: [], error: access.error }

  const q = params.search?.trim()

  try {
    const rows = await prisma.telegramConversation.findMany({
      where: {
        ...(params.filter && params.filter !== 'ALL' ? { status: params.filter } : {}),
        ...(q
          ? {
              OR: [
                { clientNameGuess: { contains: q, mode: 'insensitive' as const } },
                { telegramUsername: { contains: q, mode: 'insensitive' as const } },
                { telegramUserId: { contains: q } },
                { phone: { contains: q } },
                { linkedClient: { name: { contains: q, mode: 'insensitive' as const } } },
                { messages: { some: { text: { contains: q, mode: 'insensitive' as const } } } },
              ],
            }
          : {}),
      },
      orderBy: [{ isPinned: 'desc' }, { lastMessageAt: 'desc' }],
      include: CONVERSATION_INCLUDE_LIST,
    })
    return { ok: true, data: rows.map(toListDTO) }
  } catch (e) {
    console.error('[getConversations]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить список диалогов' }
  }
}

// ============================================================
// ДИАЛОГ + ИСТОРИЯ + СОГЛАСИЯ + ЗАМЕТКИ
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
        assignedAdmin: { select: { id: true, name: true, email: true } },
        order: { select: { id: true } },
        messages: { orderBy: { createdAt: 'asc' }, include: { attachment: true } },
        consents: { orderBy: { createdAt: 'desc' } },
        internalNotes: { orderBy: { createdAt: 'desc' }, include: { author: { select: { id: true, name: true, email: true } } } },
      },
    })
    if (!row) return { ok: false, error: 'Диалог не найден' }

    await writeAuditLog({ userId: access.userId, action: 'TELEGRAM_CONVERSATION_VIEWED', entityId: id })

    return {
      ok: true,
      data: {
        ...toListDTO(row),
        telegramChatId: row.telegramChatId,
        phone: row.phone,
        telegramFirstName: row.telegramFirstName,
        telegramLastName: row.telegramLastName,
        consentRequestVersion: row.consentRequestVersion,
        consentRequestMessageId: row.consentRequestMessageId,
        messages: row.messages.map(toMessageDTO),
        consents: row.consents.map(c => ({
          id: c.id,
          consentVersion: c.consentVersion,
          policyUrl: c.policyUrl,
          status: c.status,
          givenAt: c.givenAt ? c.givenAt.toISOString() : null,
          revokedAt: c.revokedAt ? c.revokedAt.toISOString() : null,
        })),
        internalNotes: row.internalNotes.map(n => ({
          id: n.id,
          authorUserId: n.authorUserId,
          authorName: n.author.name ?? n.author.email,
          text: n.text,
          createdAt: n.createdAt.toISOString(),
          updatedAt: n.updatedAt.toISOString(),
        })),
      },
    }
  } catch (e) {
    console.error('[getConversationDetail]', e)
    return { ok: false, error: 'Не удалось загрузить диалог' }
  }
}

// ============================================================
// РАБОЧИЕ ДЕЙСТВИЯ ИНБОКСА
// ============================================================

// Вызывается при открытии диалога — и из полного раздела Telegram
// (ConversationView), и из встроенной панели в карточке клиента
// (ClientTelegramPanel), см. их эффект на mount. Условный updateMany вместо
// безусловного update: если непрочитанных уже нет (админ уже смотрит этот же
// диалог и обновление подхватило новое сообщение прямо в момент чтения),
// затронутых строк 0 — не бампаем updatedAt и не инвалидируем страницы
// зазря (dataKey в page.tsx включает updatedAt, лишний бамп означал бы
// лишний remount ConversationView без реальной причины).
export async function markConversationRead(id: string) {
  const access = await requireTelegramAccess()
  if (!access.ok) return { ok: false as const, error: access.error }
  const result = await prisma.telegramConversation.updateMany({
    where: { id, unreadCount: { gt: 0 } },
    data: { unreadCount: 0 },
  })
  if (result.count > 0) {
    revalidatePath('/admin/telegram')
    revalidatePath(`/admin/telegram/${id}`)
  }
  return { ok: true as const }
}

export async function claimConversation(id: string) {
  const access = await requireTelegramAccess()
  if (!access.ok) return { ok: false as const, error: access.error }
  const conversation = await prisma.telegramConversation.update({
    where: { id },
    data: { assignedAdminId: access.userId, status: 'IN_PROGRESS' },
  })
  await writeAuditLog({ userId: access.userId, action: 'TELEGRAM_CONVERSATION_CLAIMED', entityId: id })
  revalidatePath('/admin/telegram')
  revalidatePath(`/admin/telegram/${id}`)
  return { ok: true as const, data: conversation.status }
}

export async function pinConversation(id: string, pinned: boolean) {
  const access = await requireTelegramAccess()
  if (!access.ok) return { ok: false as const, error: access.error }
  await prisma.telegramConversation.update({ where: { id }, data: { isPinned: pinned } })
  await writeAuditLog({ userId: access.userId, action: pinned ? 'TELEGRAM_CONVERSATION_PINNED' : 'TELEGRAM_CONVERSATION_UNPINNED', entityId: id })
  revalidatePath('/admin/telegram')
  return { ok: true as const }
}

export async function archiveConversation(id: string) {
  const access = await requireTelegramAccess()
  if (!access.ok) return { ok: false as const, error: access.error }
  await prisma.telegramConversation.update({ where: { id }, data: { status: 'ARCHIVED', archivedAt: new Date() } })
  await writeAuditLog({ userId: access.userId, action: 'TELEGRAM_CONVERSATION_ARCHIVED', entityId: id })
  revalidatePath('/admin/telegram')
  revalidatePath(`/admin/telegram/${id}`)
  return { ok: true as const }
}

export async function unarchiveConversation(id: string) {
  const access = await requireTelegramAccess()
  if (!access.ok) return { ok: false as const, error: access.error }
  const conversation = await prisma.telegramConversation.findUniqueOrThrow({ where: { id } })
  const nextStatus: TelegramConversationStatus = conversation.consentStatus === 'GIVEN' ? 'WAITING_MANAGER' : 'CONSENT_REQUIRED'
  await prisma.telegramConversation.update({ where: { id }, data: { status: nextStatus, archivedAt: null } })
  await writeAuditLog({ userId: access.userId, action: 'TELEGRAM_CONVERSATION_UNARCHIVED', entityId: id })
  revalidatePath('/admin/telegram')
  revalidatePath(`/admin/telegram/${id}`)
  return { ok: true as const }
}

// ============================================================
// СООБЩЕНИЯ АДМИНИСТРАТОРА
// ============================================================

export async function sendConversationMessage(conversationId: string, text: string) {
  const access = await requireTelegramAccess()
  if (!access.ok) return { ok: false as const, error: access.error }

  const trimmed = text.trim()
  if (!trimmed) return { ok: false as const, error: 'Пустое сообщение' }

  const conversation = await prisma.telegramConversation.findUnique({ where: { id: conversationId } })
  if (!conversation) return { ok: false as const, error: 'Диалог не найден' }

  const pending = await prisma.telegramMessage.create({
    data: {
      conversationId,
      telegramMessageId: `pending-${Date.now()}`, // временный уникальный плейсхолдер, заменяется ниже после ответа Telegram
      direction: 'OUTBOUND',
      senderType: 'ADMIN',
      senderAdminId: access.userId,
      text: trimmed,
      messageType: 'TEXT',
      status: 'PENDING',
      rawPayload: {},
    },
  })

  const result = await sendTelegramMessage(conversation.telegramChatId, trimmed)

  if (result.ok) {
    await prisma.telegramMessage.update({
      where: { id: pending.id },
      data: { status: 'SENT', telegramMessageId: result.telegramMessageId, sentAt: new Date() },
    })
    await prisma.telegramConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date(), ...(conversation.status === 'WAITING_MANAGER' ? { status: 'IN_PROGRESS' as const } : {}) },
    })
    await writeAuditLog({ userId: access.userId, action: 'TELEGRAM_MESSAGE_SENT', entityId: conversationId })
  } else {
    await prisma.telegramMessage.update({ where: { id: pending.id }, data: { status: 'FAILED', errorMessage: result.error } })
    await writeAuditLog({ userId: access.userId, action: 'TELEGRAM_MESSAGE_SEND_FAILED', entityId: conversationId, metadata: { error: result.error } })
  }

  revalidatePath(`/admin/telegram/${conversationId}`)
  return result.ok ? { ok: true as const } : { ok: false as const, error: result.error }
}

const TELEGRAM_BOT_UPLOAD_LIMIT_MB = 50 // лимит самого Telegram на загрузку файла ботом через multipart

// Файл сначала уходит из браузера напрямую в Vercel Blob (см.
// /api/telegram/blob-upload и upload() в ConversationView.tsx) — это
// единственный способ обойти жёсткий лимит Vercel в 4.5 МБ на тело запроса к
// функции, который не связан с настройками Next.js (bodySizeLimit в
// next.config.ts на него не влияет). Сюда приходит уже готовый blob URL, а не
// сам файл: читаем байты из Blob, пересылаем в Telegram и сразу удаляем blob —
// он используется только как временный релей, постоянного хранения вложений
// в проекте по-прежнему нет (см. TelegramMessageAttachment — хранится только
// telegramFileId).
export async function sendConversationAttachmentFromBlob(conversationId: string, params: {
  blobUrl: string
  fileName: string
  mimeType: string
  caption?: string
}) {
  const access = await requireTelegramAccess()
  if (!access.ok) {
    await deleteBlob(params.blobUrl).catch(() => {})
    return { ok: false as const, error: access.error }
  }

  const conversation = await prisma.telegramConversation.findUnique({ where: { id: conversationId } })
  if (!conversation) {
    await deleteBlob(params.blobUrl).catch(() => {})
    return { ok: false as const, error: 'Диалог не найден' }
  }

  const messageType: TelegramMessageType = params.mimeType.startsWith('image/')
    ? 'PHOTO'
    : params.mimeType.startsWith('video/')
      ? 'VIDEO'
      : 'DOCUMENT'

  const pending = await prisma.telegramMessage.create({
    data: {
      conversationId,
      telegramMessageId: `pending-${Date.now()}`,
      direction: 'OUTBOUND',
      senderType: 'ADMIN',
      senderAdminId: access.userId,
      text: params.caption ?? null,
      messageType,
      status: 'PENDING',
      rawPayload: {},
    },
  })

  let buffer: Buffer
  try {
    const blob = await getBlob(params.blobUrl, { access: 'private' })
    if (!blob?.stream) throw new Error('Blob не найден')
    buffer = Buffer.from(await new Response(blob.stream).arrayBuffer())
    if (buffer.byteLength > TELEGRAM_BOT_UPLOAD_LIMIT_MB * 1024 * 1024) {
      throw new Error(`Файл больше ${TELEGRAM_BOT_UPLOAD_LIMIT_MB} МБ — Telegram не примет его от бота`)
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Не удалось прочитать загруженный файл'
    await prisma.telegramMessage.update({ where: { id: pending.id }, data: { status: 'FAILED', errorMessage: message } })
    await deleteBlob(params.blobUrl).catch(() => {})
    revalidatePath(`/admin/telegram/${conversationId}`)
    return { ok: false as const, error: message }
  }

  const sendFn = messageType === 'PHOTO' ? sendTelegramPhoto : messageType === 'VIDEO' ? sendTelegramVideo : sendTelegramDocument
  const result = await sendFn(conversation.telegramChatId, buffer, params.fileName || 'file', params.caption)

  if (result.ok) {
    await prisma.telegramMessage.update({
      where: { id: pending.id },
      data: { status: 'SENT', telegramMessageId: result.telegramMessageId, sentAt: new Date() },
    })
    await prisma.telegramMessageAttachment.create({
      data: {
        messageId: pending.id,
        telegramFileId: result.fileId,
        fileName: params.fileName || null,
        mimeType: params.mimeType || null,
        // Размер — от Telegram (после возможного пересжатия фото), а не
        // исходного файла из браузера: иначе прокси-роут отдаёт неверный
        // Content-Length, и браузер показывает "битую" картинку.
        fileSize: result.fileSize ?? buffer.byteLength,
        width: result.width ?? null,
        height: result.height ?? null,
        duration: result.duration ?? null,
      },
    })
    await prisma.telegramConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date(), ...(conversation.status === 'WAITING_MANAGER' ? { status: 'IN_PROGRESS' as const } : {}) },
    })
    await writeAuditLog({ userId: access.userId, action: 'TELEGRAM_ATTACHMENT_SENT', entityId: conversationId, metadata: { messageType } })
  } else {
    await prisma.telegramMessage.update({ where: { id: pending.id }, data: { status: 'FAILED', errorMessage: result.error } })
    await writeAuditLog({ userId: access.userId, action: 'TELEGRAM_ATTACHMENT_SEND_FAILED', entityId: conversationId, metadata: { error: result.error } })
  }

  await deleteBlob(params.blobUrl).catch(() => {})
  revalidatePath(`/admin/telegram/${conversationId}`)
  return result.ok ? { ok: true as const } : { ok: false as const, error: result.error }
}

export async function retryFailedMessage(messageId: string) {
  const access = await requireTelegramAccess()
  if (!access.ok) return { ok: false as const, error: access.error }

  const message = await prisma.telegramMessage.findUnique({ where: { id: messageId }, include: { conversation: true } })
  if (!message || message.status !== 'FAILED') return { ok: false as const, error: 'Сообщение недоступно для повтора' }
  if (message.messageType !== 'TEXT') {
    // Файл не хранится у нас после первой попытки отправки (архитектурное
    // решение — не держим байты вложений на своей стороне), повторно
    // отправить его без участия администратора нечем — только заново
    // прикрепить файл и отправить как новое сообщение.
    return { ok: false as const, error: 'Файл нужно прикрепить и отправить заново — повтор для вложений недоступен' }
  }

  await prisma.telegramMessage.update({ where: { id: messageId }, data: { status: 'PENDING', errorMessage: null } })
  const result = await sendTelegramMessage(message.conversation.telegramChatId, message.text ?? '')

  if (result.ok) {
    await prisma.telegramMessage.update({
      where: { id: messageId },
      data: { status: 'SENT', telegramMessageId: result.telegramMessageId, sentAt: new Date() },
    })
  } else {
    await prisma.telegramMessage.update({ where: { id: messageId }, data: { status: 'FAILED', errorMessage: result.error } })
  }

  revalidatePath(`/admin/telegram/${message.conversationId}`)
  return result.ok ? { ok: true as const } : { ok: false as const, error: result.error }
}

// ============================================================
// СОГЛАСИЕ — ручной отзыв администратором (страховка на случай, если клиент
// не написал ровно одну из ожидаемых фраз).
// ============================================================

export async function revokeConsentManually(conversationId: string) {
  const access = await requireTelegramAccess()
  if (!access.ok) return { ok: false as const, error: access.error }

  const conversation = await prisma.telegramConversation.findUnique({ where: { id: conversationId } })
  if (!conversation) return { ok: false as const, error: 'Диалог не найден' }

  await revokeConsent(conversationId, conversation.telegramChatId)
  await writeAuditLog({ userId: access.userId, action: 'TELEGRAM_CONSENT_REVOKED_MANUALLY', entityId: conversationId })

  revalidatePath(`/admin/telegram/${conversationId}`)
  revalidatePath('/admin/telegram')
  return { ok: true as const }
}

// ============================================================
// СВЯЗЬ С КЛИЕНТОМ
// ============================================================

async function findPotentialClientMatch(telegramUsername: string | null, phone: string | null) {
  if (!telegramUsername && !phone) return null
  return prisma.client.findFirst({
    where: {
      deletedAt: null,
      OR: [
        ...(phone ? [{ phone }] : []),
        ...(telegramUsername ? [{ telegram: { contains: telegramUsername, mode: 'insensitive' as const } }] : []),
      ],
    },
    select: { id: true, name: true, phone: true, telegram: true },
  })
}

export async function findClientMatchForConversation(conversationId: string) {
  const access = await requireTelegramAccess()
  if (!access.ok) return { ok: false as const, error: access.error }

  const conversation = await prisma.telegramConversation.findUnique({ where: { id: conversationId } })
  if (!conversation) return { ok: false as const, error: 'Диалог не найден' }

  const match = await findPotentialClientMatch(conversation.telegramUsername, conversation.phone)
  return { ok: true as const, data: match }
}


export async function linkConversationToClient(conversationId: string, clientId: string) {
  const access = await requireTelegramAccess()
  if (!access.ok) return { ok: false as const, error: access.error }

  await prisma.telegramConversation.update({ where: { id: conversationId }, data: { linkedClientId: clientId } })
  await writeAuditLog({ userId: access.userId, action: 'TELEGRAM_CLIENT_LINKED', entityId: conversationId, metadata: { clientId } })

  revalidatePath(`/admin/telegram/${conversationId}`)
  revalidatePath('/admin/telegram')
  // Диалог теперь виден и во встроенной Telegram-панели карточки клиента.
  revalidatePath(`/admin/clients/${clientId}`)
  return { ok: true as const }
}

// ============================================================
// СВЯЗЬ С ЗАКАЗОМ — сам заказ создаётся обычной формой (createOrder с
// telegramConversationId, см. OrderFormModal); здесь только фиксируем это
// в статусе диалога сразу после успешного сохранения формы.
// ============================================================

export async function markConversationOrderCreated(conversationId: string) {
  const access = await requireTelegramAccess()
  if (!access.ok) return { ok: false as const, error: access.error }

  await prisma.telegramConversation.update({ where: { id: conversationId }, data: { status: 'ORDER_CREATED' } })
  await writeAuditLog({ userId: access.userId, action: 'TELEGRAM_ORDER_CREATED', entityId: conversationId })

  revalidatePath(`/admin/telegram/${conversationId}`)
  revalidatePath('/admin/telegram')
  return { ok: true as const }
}

// ============================================================
// ВНУТРЕННИЕ ЗАМЕТКИ — видны только сотрудникам, никогда не уходят клиенту.
// ============================================================

export async function addInternalNote(conversationId: string, text: string) {
  const access = await requireTelegramAccess()
  if (!access.ok) return { ok: false as const, error: access.error }
  const trimmed = text.trim()
  if (!trimmed) return { ok: false as const, error: 'Пустая заметка' }

  await prisma.telegramInternalNote.create({ data: { conversationId, authorUserId: access.userId, text: trimmed } })
  await writeAuditLog({ userId: access.userId, action: 'TELEGRAM_NOTE_ADDED', entityId: conversationId })

  revalidatePath(`/admin/telegram/${conversationId}`)
  return { ok: true as const }
}

export async function updateInternalNote(noteId: string, text: string) {
  const access = await requireTelegramAccess()
  if (!access.ok) return { ok: false as const, error: access.error }

  const note = await prisma.telegramInternalNote.findUnique({ where: { id: noteId } })
  if (!note) return { ok: false as const, error: 'Заметка не найдена' }
  if (note.authorUserId !== access.userId) return { ok: false as const, error: 'Редактировать можно только свои заметки' }

  await prisma.telegramInternalNote.update({ where: { id: noteId }, data: { text: text.trim() } })
  revalidatePath(`/admin/telegram/${note.conversationId}`)
  return { ok: true as const }
}

// ============================================================
// НАСТРОЙКИ МОДУЛЯ (только Owner) — токен бота сюда не входит, он только в
// TELEGRAM_BOT_TOKEN (env) и никогда не сериализуется на фронтенд.
// ============================================================

export interface TelegramSettingsDTO {
  privacyPolicyUrl: string | null
  consentRequired: boolean
  consentText: string
  consentVersion: string
  managerHandoffMessage: string
  dataRetentionMode: string
  dataRetentionDays: number | null
  archiveWarningThresholdMessages: number
  archiveWarningThresholdStorageMb: number
  maxAttachmentSizeMb: number
}

function toSettingsDTO(s: TelegramSettings): TelegramSettingsDTO {
  return {
    privacyPolicyUrl: s.privacyPolicyUrl,
    consentRequired: s.consentRequired,
    consentText: s.consentText,
    consentVersion: s.consentVersion,
    managerHandoffMessage: s.managerHandoffMessage,
    dataRetentionMode: s.dataRetentionMode,
    dataRetentionDays: s.dataRetentionDays,
    archiveWarningThresholdMessages: s.archiveWarningThresholdMessages,
    archiveWarningThresholdStorageMb: s.archiveWarningThresholdStorageMb,
    maxAttachmentSizeMb: s.maxAttachmentSizeMb,
  }
}

export interface TelegramWebhookStatusDTO {
  botTokenConfigured: boolean
  botUsername: string | null
  webhookUrl: string | null
  pendingUpdateCount: number | null
  lastErrorMessage: string | null
}

export async function getTelegramSettings(): Promise<
  { ok: true; data: TelegramSettingsDTO; webhookStatus: TelegramWebhookStatusDTO } | { ok: false; error: string }
> {
  const access = await requireTelegramAccess()
  if (!access.ok) return { ok: false, error: access.error }

  const settings = await prisma.telegramSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', consentText: DEFAULT_CONSENT_TEXT, managerHandoffMessage: DEFAULT_MANAGER_HANDOFF_MESSAGE },
    update: {},
  })

  const tokenConfigured = isTelegramBotTokenConfigured()
  const [botInfo, webhookInfo] = tokenConfigured
    ? await Promise.all([getTelegramBotInfo(), getTelegramWebhookInfo()])
    : [null, null]

  return {
    ok: true,
    data: toSettingsDTO(settings),
    webhookStatus: {
      botTokenConfigured: tokenConfigured,
      botUsername: botInfo?.username ?? null,
      webhookUrl: webhookInfo?.url || null,
      pendingUpdateCount: webhookInfo?.pending_update_count ?? null,
      lastErrorMessage: webhookInfo?.last_error_message ?? null,
    },
  }
}

export async function updateTelegramSettings(input: Partial<TelegramSettingsDTO>) {
  const access = await requireTelegramOwnerAccess()
  if (!access.ok) return { ok: false as const, error: access.error }

  await prisma.telegramSettings.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      consentText: input.consentText ?? DEFAULT_CONSENT_TEXT,
      managerHandoffMessage: input.managerHandoffMessage ?? DEFAULT_MANAGER_HANDOFF_MESSAGE,
      ...input,
    },
    update: { ...input },
  })

  await writeAuditLog({ userId: access.userId, action: 'TELEGRAM_SETTINGS_UPDATED', entityId: 'singleton' })
  revalidatePath('/admin/telegram/settings')
  return { ok: true as const }
}

// ============================================================
// ПРЕДУПРЕЖДЕНИЕ О РАЗМЕРЕ АРХИВА — считается "лениво" при загрузке
// страницы настроек, без фонового задания (в проекте нет настроенного cron).
// ============================================================

export async function getArchiveWarning(): Promise<string | null> {
  const access = await requireTelegramAccess()
  if (!access.ok) return null

  const settings = await prisma.telegramSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', consentText: DEFAULT_CONSENT_TEXT, managerHandoffMessage: DEFAULT_MANAGER_HANDOFF_MESSAGE },
    update: {},
  })

  const messageCount = await prisma.telegramMessage.count()
  if (messageCount >= settings.archiveWarningThresholdMessages) {
    return 'В Telegram-архиве накопилось много переписок и файлов. Проверьте политику хранения и при необходимости архивируйте или обезличьте старые данные.'
  }
  return null
}

// ============================================================
// TELEGRAM-ДИАЛОГ ВНУТРИ КАРТОЧКИ КЛИЕНТА — та же getConversationDetail(),
// просто найденная по clientId, а не по id диалога напрямую. Один клиент
// может исторически иметь несколько связанных диалогов (linkConversationToClient
// вызывался несколько раз) — берём самый свежий по lastMessageAt.
// ============================================================

export async function getConversationForClient(
  clientId: string
): Promise<{ ok: true; data: TelegramConversationDetailDTO | null } | { ok: false; error: string }> {
  const access = await requireTelegramAccess()
  if (!access.ok) return { ok: false, error: access.error }

  const conversation = await prisma.telegramConversation.findFirst({
    where: { linkedClientId: clientId },
    orderBy: { lastMessageAt: 'desc' },
    select: { id: true },
  })
  if (!conversation) return { ok: true, data: null }

  return getConversationDetail(conversation.id)
}

export interface UnlinkedConversationOptionDTO {
  id: string
  telegramUsername: string | null
  telegramUserId: string | null
  telegramChatId: string
  clientNameGuess: string | null
  lastMessageAt: string | null
}

// Для пикера "Связать с диалогом" в карточке клиента (обратное направление
// от уже существующего "Связать с существующим клиентом" в разделе Telegram).
// Намеренно ищем только среди ЕЩЁ НЕ связанных диалогов — иначе можно было бы
// случайно "отобрать" диалог у другого клиента одним кликом в поиске.
export async function searchUnlinkedTelegramConversations(
  query: string
): Promise<{ ok: true; data: UnlinkedConversationOptionDTO[] } | { ok: false; data: []; error: string }> {
  const access = await requireTelegramAccess()
  if (!access.ok) return { ok: false, data: [], error: access.error }

  const q = query.trim()
  if (q.length < 2) return { ok: true, data: [] }

  const rows = await prisma.telegramConversation.findMany({
    where: {
      linkedClientId: null,
      OR: [
        { telegramUsername: { contains: q, mode: 'insensitive' as const } },
        { telegramUserId: { contains: q } },
        { telegramChatId: { contains: q } },
        { clientNameGuess: { contains: q, mode: 'insensitive' as const } },
      ],
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 10,
  })

  return {
    ok: true,
    data: rows.map(r => ({
      id: r.id,
      telegramUsername: r.telegramUsername,
      telegramUserId: r.telegramUserId,
      telegramChatId: r.telegramChatId,
      clientNameGuess: r.clientNameGuess,
      lastMessageAt: r.lastMessageAt ? r.lastMessageAt.toISOString() : null,
    })),
  }
}

// ============================================================
// ВЛОЖЕНИЯ ДИАЛОГА — классификация для панели "Вложения" (Медиа/Документы/
// Ссылки/Голосовые/Кружочки). Один источник данных для обоих мест, где эта
// панель открывается (раздел Telegram и встроенная панель карточки клиента).
// Ссылки не хранятся как отдельная сущность в БД — вычисляются на лету из
// текста сообщений (см. память проекта: "можно начать с вычисления ссылок
// из текста сообщений", отдельная сущность MessageLink оставлена на будущее).
// ============================================================

export type AttachmentCategory = 'media' | 'document' | 'voice' | 'video_note' | 'link'

export interface ConversationAttachmentItemDTO {
  id: string
  category: AttachmentCategory
  messageId: string
  createdAt: string
  senderType: TelegramSenderType
  senderName: string | null
  messageType?: TelegramMessageType
  fileUrl?: string
  downloadUrl?: string
  fileName?: string | null
  mimeType?: string | null
  fileSize?: number | null
  duration?: number | null
  width?: number | null
  height?: number | null
  isAnimatedSticker?: boolean
  url?: string
  messageSnippet?: string
}

function classifyMessageType(type: TelegramMessageType): AttachmentCategory | null {
  switch (type) {
    case 'PHOTO': case 'VIDEO': case 'STICKER': return 'media'
    case 'DOCUMENT': return 'document'
    case 'VOICE': case 'AUDIO': return 'voice'
    case 'VIDEO_NOTE': return 'video_note'
    default: return null
  }
}

export async function getConversationAttachments(
  conversationId: string
): Promise<{ ok: true; data: ConversationAttachmentItemDTO[] } | { ok: false; error: string }> {
  const access = await requireTelegramAccess()
  if (!access.ok) return { ok: false, error: access.error }

  const messages = await prisma.telegramMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    include: { attachment: true },
  })

  const items: ConversationAttachmentItemDTO[] = []
  for (const m of messages) {
    const createdAt = m.createdAt.toISOString()

    if (m.attachment) {
      const category = classifyMessageType(m.messageType)
      if (category) {
        items.push({
          id: m.attachment.id,
          category,
          messageId: m.id,
          createdAt,
          senderType: m.senderType,
          senderName: m.senderName,
          messageType: m.messageType,
          fileUrl: `/api/telegram/file/${m.attachment.id}`,
          downloadUrl: `/api/telegram/file/${m.attachment.id}?download=1`,
          fileName: m.attachment.fileName,
          mimeType: m.attachment.mimeType,
          fileSize: m.attachment.fileSize,
          duration: m.attachment.duration,
          width: m.attachment.width,
          height: m.attachment.height,
          isAnimatedSticker: m.attachment.isAnimatedSticker,
        })
      }
    }

    if (m.text) {
      for (const [i, url] of extractLinks(m.text).entries()) {
        items.push({
          id: `link-${m.id}-${i}`,
          category: 'link',
          messageId: m.id,
          createdAt,
          senderType: m.senderType,
          senderName: m.senderName,
          url,
          messageSnippet: m.text.length > 160 ? `${m.text.slice(0, 160)}…` : m.text,
        })
      }
    }
  }

  return { ok: true, data: items }
}
