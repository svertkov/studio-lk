import { NextRequest, NextResponse } from 'next/server'
import type { TelegramMessageType, TelegramSettings } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  sendTelegramMessage, sendTelegramMessageWithButtons, answerCallbackQuery, removeInlineKeyboard,
  type TelegramUpdate, type TelegramMessagePayload,
} from '@/lib/telegram'
import { REVOKE_CONSENT_PHRASES, DEFAULT_CONSENT_TEXT, DEFAULT_MANAGER_HANDOFF_MESSAGE } from '@/lib/telegram-model'
import { revokeConsent } from '@/lib/telegram-consent'
import { createLeadOrderFromTelegramConversation } from '@/lib/telegram-order-sync'

interface DetectedAttachment {
  messageType: TelegramMessageType
  telegramFileId: string
  telegramFileUniqueId: string
  fileName: string | null
  mimeType: string | null
  fileSize: number | null
  duration: number | null
  width: number | null
  height: number | null
  isAnimatedSticker: boolean
}

// Определяет тип вложения по составу полей входящего сообщения Telegram —
// у сообщения заполнено ровно одно из photo/document/voice/video/sticker,
// либо ничего (текст/системное). Фото приходит массивом размеров одного и
// того же изображения — берём наибольший (последний в массиве по ширине).
function detectAttachment(message: TelegramMessagePayload): DetectedAttachment | null {
  if (message.photo && message.photo.length > 0) {
    const largest = message.photo.reduce((a, b) => (b.width > a.width ? b : a))
    return {
      messageType: 'PHOTO', telegramFileId: largest.file_id, telegramFileUniqueId: largest.file_unique_id,
      fileName: null, mimeType: null, fileSize: largest.file_size ?? null,
      duration: null, width: largest.width, height: largest.height, isAnimatedSticker: false,
    }
  }
  if (message.document) {
    const d = message.document
    return {
      messageType: 'DOCUMENT', telegramFileId: d.file_id, telegramFileUniqueId: d.file_unique_id,
      fileName: d.file_name ?? null, mimeType: d.mime_type ?? null, fileSize: d.file_size ?? null,
      duration: null, width: null, height: null, isAnimatedSticker: false,
    }
  }
  if (message.voice) {
    const v = message.voice
    return {
      messageType: 'VOICE', telegramFileId: v.file_id, telegramFileUniqueId: v.file_unique_id,
      fileName: null, mimeType: v.mime_type ?? null, fileSize: v.file_size ?? null,
      duration: v.duration, width: null, height: null, isAnimatedSticker: false,
    }
  }
  if (message.video) {
    const v = message.video
    return {
      messageType: 'VIDEO', telegramFileId: v.file_id, telegramFileUniqueId: v.file_unique_id,
      fileName: null, mimeType: v.mime_type ?? null, fileSize: v.file_size ?? null,
      duration: v.duration, width: v.width, height: v.height, isAnimatedSticker: false,
    }
  }
  if (message.sticker) {
    const s = message.sticker
    return {
      messageType: 'STICKER', telegramFileId: s.file_id, telegramFileUniqueId: s.file_unique_id,
      fileName: null, mimeType: null, fileSize: s.file_size ?? null,
      duration: null, width: s.width, height: s.height, isAnimatedSticker: s.is_animated || s.is_video,
    }
  }
  if (message.video_note) {
    const vn = message.video_note
    return {
      messageType: 'VIDEO_NOTE', telegramFileId: vn.file_id, telegramFileUniqueId: vn.file_unique_id,
      fileName: null, mimeType: null, fileSize: vn.file_size ?? null,
      duration: vn.duration, width: vn.length, height: vn.length, isAnimatedSticker: false,
    }
  }
  if (message.audio) {
    const a = message.audio
    return {
      messageType: 'AUDIO', telegramFileId: a.file_id, telegramFileUniqueId: a.file_unique_id,
      fileName: a.title ?? null, mimeType: a.mime_type ?? null, fileSize: a.file_size ?? null,
      duration: a.duration, width: null, height: null, isAnimatedSticker: false,
    }
  }
  return null
}

function isAttachmentTypeAllowed(settings: TelegramSettings, type: TelegramMessageType): boolean {
  const allowed = settings.allowedAttachmentTypes
  if (!Array.isArray(allowed) || allowed.length === 0) return true // [] по умолчанию = без ограничений
  return allowed.includes(type)
}

// Приём входящих сообщений и нажатий inline-кнопок от Telegram.
//
// Consent-first: пока клиент не нажал единственную кнопку «Согласиться», бот
// не задаёт никаких вопросов о заявке — только присылает запрос согласия
// (один раз на версию текста). После согласия бот отправляет ровно одну
// фразу про менеджера и дальше молчит — переписку продолжает только
// администратор из платформы. Никакого ИИ здесь и нигде в этом модуле нет.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-telegram-bot-api-secret-token')
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  let update: TelegramUpdate
  try {
    update = await req.json()
  } catch {
    return NextResponse.json({ ok: true }) // не наш формат — просто игнорируем
  }

  try {
    // Идемпотентность на уровне всего update — Telegram может повторно
    // доставить тот же update (сеть/таймаут), не должно быть дублей эффектов.
    const already = await prisma.telegramMessage.findFirst({
      where: { telegramUpdateId: String(update.update_id) },
      select: { id: true },
    })
    if (already) return NextResponse.json({ ok: true })

    if (update.callback_query) {
      await handleCallbackQuery(update)
    } else if (update.message) {
      await handleMessage(update)
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[telegram/webhook]', e)
    // Отвечаем 200 даже при внутренней ошибке — иначе Telegram будет
    // бесконечно ретраить один и тот же сломанный update; ошибка уже
    // залогирована выше для расследования.
    return NextResponse.json({ ok: false })
  }
}

async function getSettings() {
  return prisma.telegramSettings.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      consentText: DEFAULT_CONSENT_TEXT,
      managerHandoffMessage: DEFAULT_MANAGER_HANDOFF_MESSAGE,
    },
    update: {},
  })
}

function renderConsentText(template: string, policyUrl: string | null): string {
  return template.replace('{{privacy_policy_url}}', policyUrl || '(уточните у менеджера)')
}

// Подпись для сообщений без собственного текста (просто фото/голосовое и
// т.п.) — видна в превью списка диалогов и как fallback в ленте сообщений.
const ATTACHMENT_FALLBACK_LABEL: Record<TelegramMessageType, string> = {
  TEXT: '', SYSTEM: '',
  PHOTO: '📷 Фото', DOCUMENT: '📄 Документ', VOICE: '🎤 Голосовое сообщение', VIDEO: '🎬 Видео', STICKER: '🎭 Стикер',
  VIDEO_NOTE: '⭕ Видео-кружок', AUDIO: '🎵 Аудио',
}

async function handleMessage(update: TelegramUpdate) {
  const message = update.message!
  if (message.chat.type !== 'private') {
    // Групповые рабочие чаты — отдельный, более поздний этап.
    return
  }

  const telegramChatId = String(message.chat.id)
  const from = message.from
  const attachment = detectAttachment(message)
  const text = message.text ?? message.caption ?? (attachment ? ATTACHMENT_FALLBACK_LABEL[attachment.messageType] : null)

  // Проверяем ДО upsert-а, был ли диалог уже — нужно, чтобы понять, действительно
  // ли это первое сообщение нового чата (и тогда сразу завести заявку в «Заказы»),
  // а не просто n-е сообщение существующего.
  const existedBefore = !!(await prisma.telegramConversation.findUnique({ where: { telegramChatId }, select: { id: true } }))

  const conversation = await prisma.telegramConversation.upsert({
    where: { telegramChatId },
    create: {
      telegramChatId,
      chatType: 'PRIVATE',
      telegramUserId: from ? String(from.id) : null,
      telegramUsername: from?.username ?? null,
      clientNameGuess: from ? [from.first_name, from.last_name].filter(Boolean).join(' ') || null : null,
      telegramFirstName: from?.first_name ?? null,
      telegramLastName: from?.last_name ?? null,
      lastMessageAt: new Date(message.date * 1000),
      firstMessageText: text,
    },
    update: {
      telegramUsername: from?.username ?? undefined,
      lastMessageAt: new Date(message.date * 1000),
    },
  })

  // Новый диалог — сразу заявка (LEAD) в «Заказы», ещё без карточки клиента.
  // Раньше это происходило только после ручного нажатия «Создать заказ».
  if (!existedBefore) {
    await createLeadOrderFromTelegramConversation({
      id: conversation.id,
      clientNameGuess: conversation.clientNameGuess,
      telegramUsername: conversation.telegramUsername,
      phone: conversation.phone,
    })
  }

  // Лёгкий guard от потока сообщений одного чата — не настоящий rate limit
  // уровня инфраструктуры (для этого нет общей памяти между serverless-
  // вызовами), а защита от одного взбесившегося/спамящего чата.
  const recentCount = await prisma.telegramMessage.count({
    where: { conversationId: conversation.id, direction: 'INBOUND', createdAt: { gt: new Date(Date.now() - 10_000) } },
  })
  if (recentCount >= 10) return

  const settings = await getSettings()
  const isRevokePhrase = !!message.text && REVOKE_CONSENT_PHRASES.includes(message.text.trim().toLowerCase())
  const attachmentAllowed = attachment ? isAttachmentTypeAllowed(settings, attachment.messageType) : true

  const savedMessage = await prisma.telegramMessage.upsert({
    where: { conversationId_telegramMessageId: { conversationId: conversation.id, telegramMessageId: String(message.message_id) } },
    create: {
      conversationId: conversation.id,
      telegramUpdateId: String(update.update_id),
      telegramMessageId: String(message.message_id),
      direction: 'INBOUND',
      senderType: 'CLIENT',
      senderTelegramId: from ? String(from.id) : null,
      senderUsername: from?.username ?? null,
      senderName: from ? [from.first_name, from.last_name].filter(Boolean).join(' ') || null : null,
      text,
      messageType: attachment && attachmentAllowed ? attachment.messageType : 'TEXT',
      status: 'RECEIVED',
      rawPayload: update as object,
    },
    update: {},
  })

  if (attachment && attachmentAllowed) {
    await prisma.telegramMessageAttachment.upsert({
      where: { messageId: savedMessage.id },
      create: {
        messageId: savedMessage.id,
        telegramFileId: attachment.telegramFileId,
        telegramFileUniqueId: attachment.telegramFileUniqueId,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
        duration: attachment.duration,
        width: attachment.width,
        height: attachment.height,
        isAnimatedSticker: attachment.isAnimatedSticker,
      },
      update: {},
    })
  }

  await prisma.telegramConversation.update({
    where: { id: conversation.id },
    data: { unreadCount: { increment: 1 } },
  })

  if (isRevokePhrase && conversation.consentStatus === 'GIVEN') {
    await revokeConsent(conversation.id, telegramChatId)
    return
  }

  if (conversation.consentStatus !== 'GIVEN') {
    await ensureConsentRequested(conversation.id, telegramChatId, settings)
    return
  }

  // Согласие уже есть — выводим диалог в очередь на администратора, не
  // понижая уже более продвинутые статусы (архив при этом реанимируется —
  // новое сообщение клиента возвращает диалог в активную работу).
  if (!['IN_PROGRESS', 'ORDER_CREATED'].includes(conversation.status)) {
    await prisma.telegramConversation.update({
      where: { id: conversation.id },
      data: { status: 'WAITING_MANAGER', archivedAt: null },
    })
  }
}

async function ensureConsentRequested(conversationId: string, telegramChatId: string, settings: TelegramSettings) {
  const conversation = await prisma.telegramConversation.findUniqueOrThrow({ where: { id: conversationId } })

  await prisma.telegramConversation.update({
    where: { id: conversationId },
    data: { status: 'CONSENT_REQUIRED' },
  })

  // Не спамим запросом согласия на каждое новое сообщение — только один раз
  // на версию текста согласия.
  if (conversation.consentRequestSentAt && conversation.consentRequestVersion === settings.consentVersion) {
    return
  }

  const text = renderConsentText(settings.consentText, settings.privacyPolicyUrl)
  // Единственная кнопка — «Согласиться». Ссылка на согласие уже встроена в
  // текст сообщения (не отдельной url-кнопкой), поэтому предпросмотр этой
  // ссылки отключаем через disableLinkPreview — иначе Telegram разворачивает
  // под текстом большую карточку документа.
  const result = await sendTelegramMessageWithButtons(
    telegramChatId, text,
    [[{ text: 'Согласиться', callback_data: 'consent_given' }]],
    { disableLinkPreview: true },
  )

  if (result.ok) {
    await prisma.$transaction([
      prisma.telegramConversation.update({
        where: { id: conversationId },
        data: {
          consentRequestSentAt: new Date(),
          consentRequestVersion: settings.consentVersion,
          consentRequestMessageId: result.telegramMessageId,
        },
      }),
      prisma.telegramMessage.create({
        data: {
          conversationId,
          telegramMessageId: result.telegramMessageId,
          direction: 'OUTBOUND',
          senderType: 'BOT',
          text,
          messageType: 'TEXT',
          status: 'SENT',
          sentAt: new Date(),
          rawPayload: {},
        },
      }),
    ])
  }
}

async function handleCallbackQuery(update: TelegramUpdate) {
  const cq = update.callback_query!
  const chatId = cq.message?.chat?.id
  if (!chatId) {
    await answerCallbackQuery(cq.id)
    return
  }
  const telegramChatId = String(chatId)

  const conversation = await prisma.telegramConversation.findUnique({ where: { telegramChatId } })
  if (!conversation) {
    await answerCallbackQuery(cq.id)
    return
  }

  if (cq.data === 'consent_given') {
    // Атомарный guard от дублей: если конверсия уже была переведена в GIVEN
    // (повторное нажатие, гонка одновременных callback-ов от двойного тапа),
    // updateMany с условием consentStatus !== GIVEN затронет 0 строк — тогда
    // просто отвечаем клиенту нейтрально и не создаём второй TelegramConsent
    // и не шлём второй раз фразу про менеджера.
    const settings = await getSettings()
    const updateResult = await prisma.telegramConversation.updateMany({
      where: { id: conversation.id, consentStatus: { not: 'GIVEN' } },
      data: { consentStatus: 'GIVEN', status: 'WAITING_MANAGER' },
    })

    if (updateResult.count === 0) {
      await answerCallbackQuery(cq.id, 'Согласие уже получено')
      return
    }

    await prisma.telegramConsent.create({
      data: {
        conversationId: conversation.id,
        telegramUserId: String(cq.from.id),
        telegramChatId,
        username: cq.from.username ?? null,
        displayName: [cq.from.first_name, cq.from.last_name].filter(Boolean).join(' ') || null,
        consentVersion: settings.consentVersion,
        consentText: renderConsentText(settings.consentText, settings.privacyPolicyUrl),
        policyUrl: settings.privacyPolicyUrl,
        status: 'given',
        givenAt: new Date(),
        source: 'telegram_bot',
      },
    })

    // Убираем кнопку из исходного сообщения — иначе она остаётся кликабельной
    // в Telegram-клиенте у клиента и после согласия.
    if (conversation.consentRequestMessageId) {
      await removeInlineKeyboard(telegramChatId, conversation.consentRequestMessageId)
    }

    const result = await sendTelegramMessage(telegramChatId, settings.managerHandoffMessage)
    if (result.ok) {
      await prisma.telegramMessage.create({
        data: {
          conversationId: conversation.id,
          telegramUpdateId: String(update.update_id),
          telegramMessageId: result.telegramMessageId,
          direction: 'OUTBOUND',
          senderType: 'BOT',
          text: settings.managerHandoffMessage,
          messageType: 'TEXT',
          status: 'SENT',
          sentAt: new Date(),
          rawPayload: update as object,
        },
      })
    }
  }

  await answerCallbackQuery(cq.id)
}
