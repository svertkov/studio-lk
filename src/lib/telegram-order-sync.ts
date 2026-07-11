// Автосоздание заявки (Order) в «Заказы» на первое сообщение нового
// Telegram-диалога. Не сервер-экшн (без 'use server') — намеренно: вызывается
// только из вебхука Telegram (src/app/api/telegram/webhook/route.ts), у
// которого нет пользовательской сессии. Если бы эта функция жила в
// src/lib/actions/orders.ts (там стоит 'use server'), Next.js сделал бы её
// вызываемой как server action откуда угодно, без всякой проверки — тот же
// принцип защиты, что и у автосинхронизации выручки, см. revenue-sync.ts.
//
// Раньше "Заказ" появлялся только после того, как сотрудник вручную нажимал
// «Создать заказ» в диалоге — до этого момента переписка в Telegram и
// воронка «Заказы» не были связаны вообще. Теперь заявка (статус LEAD)
// появляется сама, в момент первого сообщения, ещё без карточки клиента.
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'

export async function createLeadOrderFromTelegramConversation(conversation: {
  id: string
  clientNameGuess: string | null
  telegramUsername: string | null
  phone: string | null
}) {
  try {
    await prisma.order.create({
      data: {
        status: 'LEAD',
        source: 'TELEGRAM_BOT',
        telegramConversationId: conversation.id,
        title: conversation.clientNameGuess || null,
        clientName: conversation.clientNameGuess || null,
        clientPhone: conversation.phone || null,
        clientTelegram: conversation.telegramUsername ? `@${conversation.telegramUsername}` : null,
      },
    })
    revalidatePath('/admin/crm')
    revalidatePath('/admin/orders')
  } catch (e) {
    // P2002 = telegramConversationId уже занят — заказ для этого диалога уже
    // есть (гонка двух вебхуков одного апдейта, или его создали вручную между
    // upsert-ом диалога и этим вызовом) — это не ошибка, просто не дублируем.
    if (!(e && typeof e === 'object' && 'code' in e && e.code === 'P2002')) {
      console.error('[createLeadOrderFromTelegramConversation]', e)
    }
  }
}
