import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendTelegramMessage, sendTelegramMessageWithButtons, answerCallbackQuery, type TelegramUpdate } from '@/lib/telegram'
import { REVOKE_CONSENT_PHRASES } from '@/lib/telegram-model'
import { revokeConsent } from '@/lib/telegram-consent'

// Приём входящих сообщений и нажатий inline-кнопок от Telegram.
//
// Consent-first: пока клиент не нажал «Согласен», бот не задаёт никаких
// вопросов о заявке — только присылает запрос согласия (один раз на версию
// текста). После согласия бот отправляет ровно одну фразу про менеджера и
// дальше молчит — переписку продолжает только администратор из платформы.
// Никакого ИИ здесь и нигде в этом модуле нет.
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
      consentText:
        'Здравствуйте! Это бот студии контента 2470. Мы поможем принять вашу заявку и передать её менеджеру. ' +
        'Для этого студии нужно обработать ваши персональные данные: имя или ник в Telegram, контакт, текст сообщения, ' +
        'параметры заявки, желаемые дату и время записи. Данные используются только для консультации, связи с вами и ' +
        'организации записи в студию. Нажимая «Согласен», вы подтверждаете согласие на обработку персональных данных. ' +
        'Политика обработки персональных данных: {{privacy_policy_url}}. Вы можете отозвать согласие сообщением «Отозвать согласие».',
    },
    update: {},
  })
}

function renderConsentText(template: string, policyUrl: string | null): string {
  return template.replace('{{privacy_policy_url}}', policyUrl || '(уточните у менеджера)')
}

async function handleMessage(update: TelegramUpdate) {
  const message = update.message!
  if (message.chat.type !== 'private') {
    // Групповые рабочие чаты — отдельный, более поздний этап.
    return
  }

  const telegramChatId = String(message.chat.id)
  const from = message.from

  const conversation = await prisma.telegramConversation.upsert({
    where: { telegramChatId },
    create: {
      telegramChatId,
      chatType: 'PRIVATE',
      telegramUserId: from ? String(from.id) : null,
      telegramUsername: from?.username ?? null,
      clientNameGuess: from ? [from.first_name, from.last_name].filter(Boolean).join(' ') || null : null,
      lastMessageAt: new Date(message.date * 1000),
      firstMessageText: message.text ?? null,
    },
    update: {
      telegramUsername: from?.username ?? undefined,
      lastMessageAt: new Date(message.date * 1000),
    },
  })

  // Лёгкий guard от потока сообщений одного чата — не настоящий rate limit
  // уровня инфраструктуры (для этого нет общей памяти между serverless-
  // вызовами), а защита от одного взбесившегося/спамящего чата.
  const recentCount = await prisma.telegramMessage.count({
    where: { conversationId: conversation.id, direction: 'INBOUND', createdAt: { gt: new Date(Date.now() - 10_000) } },
  })
  if (recentCount >= 10) return

  const text = message.text ?? null
  const isRevokePhrase = !!text && REVOKE_CONSENT_PHRASES.includes(text.trim().toLowerCase())

  await prisma.telegramMessage.upsert({
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
      messageType: 'TEXT',
      status: 'RECEIVED',
      rawPayload: update as object,
    },
    update: {},
  })

  await prisma.telegramConversation.update({
    where: { id: conversation.id },
    data: { unreadCount: { increment: 1 } },
  })

  if (isRevokePhrase && conversation.consentStatus === 'GIVEN') {
    await revokeConsent(conversation.id, telegramChatId)
    return
  }

  if (conversation.consentStatus !== 'GIVEN') {
    await ensureConsentRequested(conversation.id, telegramChatId)
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

async function ensureConsentRequested(conversationId: string, telegramChatId: string) {
  const [conversation, settings] = await Promise.all([
    prisma.telegramConversation.findUniqueOrThrow({ where: { id: conversationId } }),
    getSettings(),
  ])

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
  const result = await sendTelegramMessageWithButtons(telegramChatId, text, [
    [{ text: 'Согласен', callback_data: 'consent_given' }],
    [{ text: 'Позвать менеджера', callback_data: 'call_manager' }],
    ...(settings.privacyPolicyUrl ? [[{ text: 'Политика обработки ПДн', url: settings.privacyPolicyUrl }]] : []),
  ])

  if (result.ok) {
    await prisma.$transaction([
      prisma.telegramConversation.update({
        where: { id: conversationId },
        data: { consentRequestSentAt: new Date(), consentRequestVersion: settings.consentVersion },
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
    const settings = await getSettings()
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
    await prisma.telegramConversation.update({
      where: { id: conversation.id },
      data: { consentStatus: 'GIVEN', status: 'WAITING_MANAGER' },
    })

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
  } else if (cq.data === 'call_manager') {
    await prisma.telegramConversation.update({
      where: { id: conversation.id },
      data: { status: 'WAITING_MANAGER' },
    })
    const text = 'Передали диалог менеджеру. Он подключится в ближайшее время.'
    const result = await sendTelegramMessage(telegramChatId, text)
    if (result.ok) {
      await prisma.telegramMessage.create({
        data: {
          conversationId: conversation.id,
          telegramUpdateId: String(update.update_id),
          telegramMessageId: result.telegramMessageId,
          direction: 'OUTBOUND',
          senderType: 'BOT',
          text,
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
