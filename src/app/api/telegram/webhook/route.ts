import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { TelegramUpdate } from '@/lib/telegram'

// Приём входящих сообщений Telegram. Защищён секретом, который Telegram сам
// присылает в заголовке на каждый запрос — если он задан при setWebhook
// (см. инструкцию по настройке бота). Токен бота здесь не участвует и не
// нужен — это отдельный секрет специально для проверки, что запрос
// действительно от Telegram, а не с интернета наугад.
//
// Пока (Этап 1) обрабатываются только личные диалоги (chat.type === 'private')
// — групповые чаты сохраняются в задел на будущее, не как ошибка.
// AI-анализ переписки подключается отдельным этапом (Этап 2), здесь его пока
// нет — только приём и сохранение сообщений.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-telegram-bot-api-secret-token')
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  let update: TelegramUpdate
  try {
    update = await req.json()
  } catch {
    return NextResponse.json({ ok: true }) // не наш формат — просто игнорируем, Telegram не должен получать 4xx/5xx на мусор
  }

  const message = update.message
  if (!message) return NextResponse.json({ ok: true }) // edited_message / callback_query и т.п. — вне MVP

  try {
    if (message.chat.type !== 'private') {
      // Групповые чаты — задел на будущий этап, сейчас не сохраняем.
      return NextResponse.json({ ok: true })
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
      },
      update: {
        // Username/имя в Telegram могут поменяться — держим их свежими.
        telegramUsername: from?.username ?? undefined,
        lastMessageAt: new Date(message.date * 1000),
      },
    })

    // upsert по уникальной паре (conversationId, telegramMessageId) — если
    // Telegram повторно доставит тот же update, дубль не создастся.
    await prisma.telegramMessage.upsert({
      where: {
        conversationId_telegramMessageId: {
          conversationId: conversation.id,
          telegramMessageId: String(message.message_id),
        },
      },
      create: {
        conversationId: conversation.id,
        telegramMessageId: String(message.message_id),
        direction: 'INBOUND',
        senderTelegramId: from ? String(from.id) : null,
        senderUsername: from?.username ?? null,
        senderName: from ? [from.first_name, from.last_name].filter(Boolean).join(' ') || null : null,
        senderRole: 'CLIENT', // однозначно в личном чате — второй участник всегда клиент
        text: message.text ?? null,
        rawPayload: update as object,
      },
      update: {}, // сообщение уже сохранено — ничего не меняем при повторной доставке
    })

    // TODO(Этап 2): здесь будет вызов analyzeConversation(conversation.id)
    // из src/lib/telegram-ai.ts — обновление AiOrderDraft после каждого
    // нового текстового сообщения.

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[telegram/webhook]', e)
    // Telegram будет повторять доставку на не-2xx — отвечаем 200, чтобы не
    // получить бесконечные ретраи одного и того же сломанного update; ошибка
    // уже залогирована выше для расследования.
    return NextResponse.json({ ok: false })
  }
}
