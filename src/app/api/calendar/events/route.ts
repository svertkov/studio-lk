import { NextRequest, NextResponse } from 'next/server'
import { fetchCalendarEvents } from '@/lib/google-calendar'

export async function GET(req: NextRequest) {
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
