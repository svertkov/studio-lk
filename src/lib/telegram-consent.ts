// Общая логика отзыва согласия — используется и автоматически (клиент написал
// "Отозвать согласие" в вебхуке), и вручную (администратор нажал кнопку в
// интерфейсе диалога, см. src/lib/actions/telegram.ts). Вынесено отдельно,
// чтобы не дублировать между route-хендлером (не 'use server') и server
// actions ('use server') — оба импортируют один и тот же обычный модуль.
import { prisma } from '@/lib/prisma'
import { sendTelegramMessage } from '@/lib/telegram'

export async function revokeConsent(conversationId: string, telegramChatId: string): Promise<void> {
  await prisma.$transaction([
    prisma.telegramConsent.updateMany({
      where: { conversationId, status: 'given' },
      data: { status: 'revoked', revokedAt: new Date() },
    }),
    prisma.telegramConversation.update({
      where: { id: conversationId },
      data: { consentStatus: 'REVOKED', status: 'CONSENT_REVOKED' },
    }),
  ])

  const text = 'Согласие на обработку персональных данных отозвано. Менеджер увидит ваш запрос.'
  const result = await sendTelegramMessage(telegramChatId, text)
  if (result.ok) {
    await prisma.telegramMessage.create({
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
    })
  }
}
