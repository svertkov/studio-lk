import { NextRequest, NextResponse } from 'next/server'
import { sendConversationAttachment } from '@/lib/actions/telegram'

// Server Actions недоступны для XMLHttpRequest/upload-progress событий —
// браузер не даёт подключиться к прогрессу отправки тела запроса при вызове
// server action напрямую из клиента. Поэтому вложение шлётся сюда обычным
// POST через XHR (см. ConversationView.tsx), а вся бизнес-логика — та же
// самая sendConversationAttachment (авторизация, отправка в Telegram,
// сохранение сообщения/вложения) — переиспользуется без дублирования.
export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const conversationId = formData.get('conversationId')
  if (typeof conversationId !== 'string' || !conversationId) {
    return NextResponse.json({ ok: false, error: 'Не указан диалог' }, { status: 400 })
  }

  const result = await sendConversationAttachment(conversationId, formData)
  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
}
