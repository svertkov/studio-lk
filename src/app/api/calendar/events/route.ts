import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { fetchCalendarEvents } from '@/lib/google-calendar'

// Отдаёт живые события Google Calendar — включая заголовки/описания, где по
// факту лежат имена клиентов, телефоны и суммы (см. parseEventTitle). Тот же
// паттерн проверки сессии, что и в api/telegram/file/[attachmentId]/route.ts:
// один и тот же статус 401 и форма ответа для "нет сессии" и "не та роль", не
// новый механизм авторизации. Роль CLIENT — единственная, кому не разрешён
// админ-раздел вообще (см. (admin)/layout.tsx: `if (session.user.role ===
// 'CLIENT') redirect('/dashboard')`) — календарь входит в тот же
// административный интерфейс, поэтому проверка ровно та же, а не более узкий
// список ролей (OWNER/ADMIN и т.п.), который бы неверно заблокировал
// OPERATOR/EDITOR, которым сам админ-раздел уже разрешён.
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user || session.user.role === 'CLIENT') {
    return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const filter = (searchParams.get('calendar') ?? 'all') as 'all' | 'studio' | 'smm'
    const timeMin = searchParams.get('timeMin') ?? new Date(Date.now() - 7 * 86400000).toISOString()
    const timeMax = searchParams.get('timeMax') ?? new Date(Date.now() + 30 * 86400000).toISOString()

    const events = await fetchCalendarEvents(filter, timeMin, timeMax)

    return NextResponse.json({ events })
  } catch (err) {
    console.error('Calendar API error:', err)
    return NextResponse.json({ error: 'Ошибка загрузки календаря' }, { status: 500 })
  }
}
